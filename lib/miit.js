/**
 * Native client for the MIIT ICP filing service (工信部政务服务平台).
 *
 * This is a Node port of the query flow in HG-ha/ICP_Query
 * (`src/python/ymicp.py` / `src/rust/src/beian.rs`): instead of proxying to an
 * ICP_Query instance over MCP or HTTP, the plugin speaks the upstream protocol
 * itself, with no external service and no API key.
 *
 * The protocol, per query:
 *
 *   1. `POST /auth` with `authKey = md5("testtest" + timestamp)` and
 *      `timestamp` → a short-lived business token (`params.bussiness`).
 *   2. `POST /image/getCheckImagePoint` with that token → `uuid` plus the
 *      slider piece and background PNGs (base64).
 *   3. Solve the slider locally: decode both PNGs and locate the notch
 *      (`lib/slider.js`).
 *   4. `POST /image/checkImage` with `{key: uuid, value: offset}` → a `sign`
 *      token bound to that captcha session.
 *   5. `POST /icpAbbreviateInfo/queryByCondition` with `token`, `uuid` and
 *      `sign` headers and a `{pageNum, pageSize, unitName, serviceType}` body.
 *   6. For APP / 小程序 / 快应用 rows, `POST
 *      /icpAbbreviateInfo/queryDetailByAppAndMiniId` with the same headers to
 *      fill in the service name and other detail fields.
 *
 * Violation blacklists use `blackListDomain/queryByCondition` (websites) or
 * `blackListDomain/queryByCondition_appAndMini` (APP / 小程序 / 快应用) with
 * the same captcha headers and no pagination.
 *
 * The service is fronted by 创宇盾, which may answer `当前访问疑似黑客攻击` when
 * the egress IP is suspected of abuse; that is surfaced as `IcpBlockedError`
 * and the caller should retry later rather than hammering the service.
 *
 * @module dsh-icp/lib/miit
 */

import { createHash, randomUUID } from 'node:crypto';
import { decodePng } from './png.js';
import { findSliderOffset } from './slider.js';

/** Base URL of the MIIT project-query API. */
export const ICP_ENDPOINT = 'https://hlwicpfwc.miit.gov.cn/icpproject_query/api';
/** Browser UA string the upstream services expect. */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.41 Safari/537.36 Edg/101.0.1210.32';
/** Refresh a token this long before the server says it expires. */
const TOKEN_SAFETY_MS = 5000;
/** Anti-abuse marker returned instead of JSON by 创宇盾. */
const BLOCKED_MARKER = '当前访问疑似黑客攻击';
/** Hard cap on one response body, so a broken upstream cannot exhaust memory. */
const MAX_RESPONSE_CHARS = 4 * 1024 * 1024;

/**
 * Query types exposed by the plugin, mirroring the eight types of the
 * upstream API (`config.yml` → `risk_avoidance.allow_type`).
 *
 * `serviceType` is the upstream `serviceType` field: 1 website, 6 APP,
 * 7 小程序, 8 快应用. Blacklist entries reuse the same numbering but call the
 * blacklist endpoints and use `payloadKey` for their search field.
 */
export const ICP_TYPES = {
  web: {
    label: '网站备案',
    serviceType: 1,
    blacklist: false,
    detailed: false,
    searchHint: '域名、主办单位名称或备案号',
  },
  app: {
    label: 'APP 备案',
    serviceType: 6,
    blacklist: false,
    detailed: true,
    searchHint: 'APP 名称、主办单位名称或备案号',
  },
  mapp: {
    label: '小程序备案',
    serviceType: 7,
    blacklist: false,
    detailed: true,
    searchHint: '小程序名称、主办单位名称或备案号',
  },
  kapp: {
    label: '快应用备案',
    serviceType: 8,
    blacklist: false,
    detailed: true,
    searchHint: '快应用名称、主办单位名称或备案号',
  },
  bweb: {
    label: '违法违规网站',
    serviceType: null,
    blacklist: true,
    detailed: false,
    endpoint: '/blackListDomain/queryByCondition',
    payloadKey: 'domainName',
    searchHint: '域名',
  },
  bapp: {
    label: '违法违规 APP',
    serviceType: 6,
    blacklist: true,
    detailed: false,
    endpoint: '/blackListDomain/queryByCondition_appAndMini',
    payloadKey: 'serviceName',
    searchHint: 'APP 名称',
  },
  bmapp: {
    label: '违法违规小程序',
    serviceType: 7,
    blacklist: true,
    detailed: false,
    endpoint: '/blackListDomain/queryByCondition_appAndMini',
    payloadKey: 'serviceName',
    searchHint: '小程序名称',
  },
  bkapp: {
    label: '违法违规快应用',
    serviceType: 8,
    blacklist: true,
    detailed: false,
    endpoint: '/blackListDomain/queryByCondition_appAndMini',
    payloadKey: 'serviceName',
    searchHint: '快应用名称',
  },
};

/** Error raised for any expected upstream failure (bad response, auth, captcha, …). */
export class IcpError extends Error {
  /**
   * @param {string} message - human-readable, user-facing reason.
   * @param {string} code - stable machine-readable code.
   */
  constructor(message, code) {
    super(message);
    this.name = 'IcpError';
    this.code = code;
  }
}

/** Error raised when the official service's anti-abuse shield blocks the egress IP. */
export class IcpBlockedError extends IcpError {
  /**
   * @param {string} message - human-readable, user-facing reason.
   */
  constructor(message) {
    super(message, 'BLOCKED');
    this.name = 'IcpBlockedError';
  }
}

/**
 * Reduce an unknown value to a number, or return the fallback.
 * @param {unknown} value - candidate.
 * @param {number} fallback - value used when `value` is not finite.
 * @returns {number} the resolved number.
 */
function numberOr(value, fallback) {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Copy a record without empty strings, nulls or undefined values.
 * @param {Record<string, unknown>} record - upstream row.
 * @returns {Record<string, unknown>} the non-empty subset.
 */
function withoutEmpty(record) {
  const result = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    result[key] = value;
  }
  return result;
}

/**
 * Request headers shared by every call: the MIIT service expects the filing
 * portal as origin/referer and an anti-bot `__jsluid_s` cookie. The cookie is
 * generated once per client instance and reused for the whole session, like a
 * browser tab would, instead of rotating on every leg of one logical query.
 * @param {string} cookie - 32-char hex cookie value.
 * @param {Record<string, string>} headers - headers to add.
 * @returns {Record<string, string>} the merged header set.
 */
function buildHeaders(cookie, headers) {
  return {
    'user-agent': USER_AGENT,
    origin: 'https://beian.miit.gov.cn',
    referer: 'https://beian.miit.gov.cn/',
    cookie: `__jsluid_s=${cookie}`,
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9',
    ...headers,
  };
}

/**
 * Read the expiry (epoch ms) embedded in a captcha `sign` JWT so a solved
 * session can be reused for a short while instead of re-solving the slider for
 * every query. Returns `null` when the token cannot be parsed or is expired.
 * @param {string} sign - the `sign` string returned by `checkImage`.
 * @returns {number | null} a safe reuse deadline in epoch milliseconds.
 */
function signExpiry(sign) {
  if (typeof sign !== 'string') return null;
  const parts = sign.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const expiry = Number(payload?.e);
    if (!Number.isFinite(expiry)) return null;
    const ttl = expiry - Date.now() - 5000;
    if (ttl <= 0) return null;
    // Never hold a session longer than three minutes, whatever the token says.
    return Date.now() + Math.min(ttl, 180000);
  } catch {
    return null;
  }
}

/**
 * Native ICP filing client. One instance is created per plugin activation; it
 * caches the business token between queries and never touches the network
 * outside `query()`.
 */
export class IcpClient {
  /**
   * @param {{captchaMaxAttempts?: number, timeoutMs?: number, detailConcurrency?: number, includeDetails?: boolean}} [options] - resolved plugin config.
   */
  constructor(options = {}) {
    /** Milliseconds allowed per HTTP request. */
    this.timeoutMs = numberOr(options.timeoutMs, 30000);
    /** How many fresh slider captchas to try before giving up. */
    this.captchaMaxAttempts = numberOr(options.captchaMaxAttempts, 5);
    /** How many detail requests to run at once. */
    this.detailConcurrency = numberOr(options.detailConcurrency, 5);
    /** Whether APP-like rows get their detail record merged in. */
    this.includeDetails = options.includeDetails !== false;
    /** Cached `{ value, expireAt }` business token. */
    this.token = { value: '', expireAt: 0 };
    /** In-flight token request, so parallel callers share one auth round trip. */
    this.authPromise = null;
    /**
     * Last solved captcha session (`token`/`uuid`/`sign` + reuse deadline). The
     * upstream `sign` stays valid for minutes, and its HTTP headers are the
     * expensive part of a query (one slider solve), so queries reuse it until
     * the deadline or a `401 验证码不匹配` forces a fresh solve.
     * @type {{token: string, uuid: string, sign: string, attempts: number, expireAt: number} | null}
     */
    this.captchaSession = null;
    /** In-flight captcha solve, so racing callers share one slider solve. */
    this.sessionPromise = null;
    /** Anti-bot cookie for this client instance (stable across requests). */
    this.cookie = randomUUID().replace(/-/gu, '');
  }

  /**
   * Return a reusable captcha session, solving one only when the cached session
   * is gone or expired.
   * @param {AbortSignal} [signal] - caller cancellation.
   * @returns {Promise<{token: string, uuid: string, sign: string, attempts: number, expireAt: number}>} the session.
   */
  async session(signal) {
    const cached = this.captchaSession;
    if (cached !== null && cached.expireAt > Date.now()) return cached;
    // Single-flight: two callers racing on an empty cache must not each solve a
    // fresh captcha (that would burn anti-bot budget and could interleave).
    if (this.sessionPromise === null) {
      this.sessionPromise = (async () => {
        const solved = await this.solveCaptcha(signal);
        const expireAt = signExpiry(solved.sign) ?? Date.now() + 60000;
        const session = { ...solved, expireAt };
        this.captchaSession = session;
        return session;
      })().finally(() => {
        this.sessionPromise = null;
      });
    }
    return await this.sessionPromise;
  }

  /** Drop the cached captcha session so the next query solves a fresh one. */
  invalidateSession() {
    this.captchaSession = null;
  }

  /** Drop the cached business token so the next call re-authenticates. */
  invalidateToken() {
    this.token = { value: '', expireAt: 0 };
  }


  /**
   * One bounded POST to the MIIT API.
   * @param {string} path - endpoint path appended to {@link ICP_ENDPOINT}.
   * @param {string} body - request body.
   * @param {Record<string, string>} [extraHeaders] - per-call headers such as `token`.
   * @param {AbortSignal} [signal] - caller cancellation.
   * @returns {Promise<string>} the response body text.
   */
  async post(path, body, extraHeaders = {}, signal) {
    const controller = new AbortController();
    const abort = (reason) => {
      if (!controller.signal.aborted) controller.abort(reason);
    };
    const timer = setTimeout(
      () => abort(new IcpError(`请求工信部接口超时（${this.timeoutMs}ms）：${path}`, 'TIMEOUT')),
      this.timeoutMs,
    );
    const onAbort = () => abort(new IcpError('ICP 查询已取消', 'ABORTED'));
    if (signal !== undefined) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const response = await fetch(`${ICP_ENDPOINT}${path}`, {
        method: 'POST',
        headers: buildHeaders(this.cookie, { 'content-type': 'application/json', ...extraHeaders }),
        body,
        signal: controller.signal,
      });
      // Reject a declared-oversized body before buffering it. Chunked responses
      // have no content-length; the post-read guard below still bounds those.
      const declaredLength = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_CHARS) {
        throw new IcpError(`工信部接口响应过大（${declaredLength} 字节）：${path}`, 'RESPONSE_TOO_LARGE');
      }
      const text = await response.text();
      if (text.length > MAX_RESPONSE_CHARS) {
        throw new IcpError(`工信部接口响应过大（${text.length} 字符）：${path}`, 'RESPONSE_TOO_LARGE');
      }
      if (text.includes(BLOCKED_MARKER)) {
        throw new IcpBlockedError(
          '工信部接口返回“当前访问疑似黑客攻击”：出口 IP 已被创宇盾临时拦截。请稍后重试，或更换网络出口后再查。',
        );
      }
      return text;
    } catch (error) {
      if (error instanceof IcpError) throw error;
      if (controller.signal.aborted) {
        const reason = controller.signal.reason;
        if (reason instanceof IcpError) throw reason;
        throw new IcpError(`请求工信部接口失败：${path}`, 'ABORTED');
      }
      throw new IcpError(`请求工信部接口失败：${path}（${error instanceof Error ? error.message : String(error)}）`, 'NETWORK');
    } finally {
      clearTimeout(timer);
      if (signal !== undefined) signal.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Parse a JSON response body.
   * @param {string} text - raw body.
   * @param {string} label - failure label.
   * @returns {Record<string, any>} the parsed payload.
   */
  parse(text, label) {
    try {
      const payload = JSON.parse(text);
      if (payload === null || typeof payload !== 'object') throw new Error('不是 JSON 对象');
      return payload;
    } catch {
      throw new IcpError(`${label}：工信部接口返回了非 JSON 内容（${text.slice(0, 120)}）`, 'BAD_RESPONSE');
    }
  }

  /**
   * Throw unless the payload reports `success: true`.
   * @param {Record<string, any>} payload - parsed response.
   * @param {string} label - failure label.
   * @returns {void}
   */
  assertSuccess(payload, label) {
    if (payload.success === true) return;
    const message = typeof payload.msg === 'string' && payload.msg !== '' ? payload.msg : '接口未返回 success=true';
    const code = payload.code === undefined ? '?' : String(payload.code);
    throw new IcpError(`${label}失败：${message}（code=${code}）`, 'QUERY_FAILED');
  }

  /**
   * Return a cached business token, refreshing it at most once concurrently.
   * @param {AbortSignal} [signal] - caller cancellation.
   * @returns {Promise<string>} the business token.
   */
  async ensureToken(signal) {
    if (this.token.value !== '' && this.token.expireAt > Date.now()) return this.token.value;
    if (this.authPromise === null) {
      this.authPromise = this.fetchToken(signal).finally(() => {
        this.authPromise = null;
      });
    }
    return await this.authPromise;
  }

  /**
   * `POST /auth`: exchange a timestamped MD5 digest for a business token.
   * @param {AbortSignal} [signal] - caller cancellation.
   * @returns {Promise<string>} the fresh business token.
   */
  async fetchToken(signal) {
    const timeStamp = Date.now();
    const authKey = createHash('md5').update(`testtest${timeStamp}`).digest('hex');
    const body = new URLSearchParams({ authKey, timeStamp: String(timeStamp) }).toString();
    const text = await this.post('/auth', body, { 'content-type': 'application/x-www-form-urlencoded' }, signal);
    const payload = this.parse(text, '获取访问令牌');
    const token = payload?.params?.bussiness;
    if (typeof token !== 'string' || token === '') {
      throw new IcpError(
        `获取访问令牌失败：${typeof payload?.msg === 'string' && payload.msg !== '' ? payload.msg : '响应缺少 params.bussiness'}`,
        'AUTH_FAILED',
      );
    }
    const expire = numberOr(payload?.params?.expire, 0);
    this.token = { value: token, expireAt: Date.now() + Math.max(0, expire) - TOKEN_SAFETY_MS };
    return token;
  }

  /**
   * Solve one slider captcha: fetch the images, locate the notch, submit the
   * offset and return the signed captcha session. Retries with a fresh image
   * up to `captchaMaxAttempts` times.
   * @param {AbortSignal} [signal] - caller cancellation.
   * @returns {Promise<{token: string, uuid: string, sign: string, attempts: number}>} the captcha session.
   */
  async solveCaptcha(signal) {
    let lastError = '未知错误';
    for (let attempt = 1; attempt <= this.captchaMaxAttempts; attempt += 1) {
      try {
        // Re-resolve per attempt: a stale token that the server has already
        // invalidated must be refreshed, not reused until the budget is gone.
        const token = await this.ensureToken(signal);
        const imageText = await this.post(
          '/image/getCheckImagePoint',
          JSON.stringify({ clientUid: `point-${randomUUID()}` }),
          { token },
          signal,
        );
        const imagePayload = this.parse(imageText, '获取滑块验证码');
        const params = imagePayload?.params;
        if (
          params === null ||
          typeof params !== 'object' ||
          typeof params.uuid !== 'string' ||
          typeof params.bigImage !== 'string' ||
          typeof params.smallImage !== 'string'
        ) {
          // A 401 here means the business token was invalidated server-side.
          if (imagePayload?.code === 401) this.invalidateToken();
          lastError = `验证码响应缺少字段（code=${imagePayload?.code ?? '?'}, msg=${imagePayload?.msg ?? ''}）`;
          continue;
        }
        const big = decodePng(Buffer.from(params.bigImage, 'base64'));
        const small = decodePng(Buffer.from(params.smallImage, 'base64'));
        const match = findSliderOffset(small, big);
        if (!match.ok) {
          lastError = `滑块缺口定位失败：${match.reason}`;
          continue;
        }
        const value = String(match.offsetX);
        const checkText = await this.post(
          '/image/checkImage',
          JSON.stringify({ key: params.uuid, value }),
          { token },
          signal,
        );
        const checkPayload = this.parse(checkText, '提交滑块验证码');
        if (checkPayload.success === true && typeof checkPayload.params === 'string' && checkPayload.params !== '') {
          return { token, uuid: params.uuid, sign: checkPayload.params, attempts: attempt };
        }
        if (checkPayload?.code === 401) this.invalidateToken();
        lastError = `验证码校验未通过（code=${checkPayload?.code ?? '?'}, msg=${
          typeof checkPayload?.msg === 'string' && checkPayload.msg !== '' ? checkPayload.msg : '识别失败'
        }）`;
      } catch (error) {
        if (error instanceof IcpBlockedError) throw error;
        if (signal?.aborted) throw error;
        // Transport and auth failures are not captcha-recognition failures:
        // surface them instead of retrying a dead network until the budget ends.
        if (
          error instanceof IcpError &&
          ['TIMEOUT', 'NETWORK', 'RESPONSE_TOO_LARGE', 'BAD_RESPONSE', 'AUTH_FAILED', 'ABORTED'].includes(error.code)
        ) {
          throw error;
        }
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    throw new IcpError(`滑块验证码连续 ${this.captchaMaxAttempts} 次未通过：${lastError}`, 'CAPTCHA_FAILED');
  }

  /**
   * Merge the detail record into every APP / 小程序 / 快应用 row that has a
   * `dataId`, with bounded concurrency.
   * @param {Array<Record<string, any>>} rows - query rows, mutated in place.
   * @param {{token: string, uuid: string, sign: string, serviceType: number}} solved - captcha session plus detail service type.
   * @param {AbortSignal} [signal] - caller cancellation.
   * @returns {Promise<boolean>} whether at least one row was enriched.
   */
  async attachDetails(rows, solved, signal) {
    const targets = rows.filter(
      (row) => row !== null && typeof row === 'object' && row.dataId !== undefined && row.dataId !== null && row.dataId !== '',
    );
    if (targets.length === 0) return false;
    let cursor = 0;
    let merged = 0;
    // One shared controller so a blocking answer (or a caller abort) stops the
    // remaining workers instead of hammering a rate-limited endpoint.
    const controller = new AbortController();
    /** @type {IcpError | null} */
    let fatal = null;
    const cancelAll = (reason) => {
      if (fatal === null) fatal = reason;
      if (!controller.signal.aborted) controller.abort(reason);
    };
    const onAbort = () => cancelAll(new IcpError('ICP 查询已取消', 'ABORTED'));
    if (signal !== undefined) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const headers = { token: solved.token, uuid: solved.uuid, sign: solved.sign };
    const worker = async () => {
      while (cursor < targets.length && fatal === null) {
        const row = targets[cursor];
        cursor += 1;
        try {
          const text = await this.post(
            '/icpAbbreviateInfo/queryDetailByAppAndMiniId',
            JSON.stringify({ dataId: row.dataId, serviceType: solved.serviceType }),
            headers,
            controller.signal,
          );
          const payload = this.parse(text, '获取应用详情');
          if (payload.success === true && payload.params !== null && typeof payload.params === 'object') {
            Object.assign(row, payload.params);
            merged += 1;
          }
        } catch (error) {
          if (error instanceof IcpBlockedError) {
            cancelAll(error);
            return;
          }
          if (controller.signal.aborted) return;
          // Detail is enrichment only: keep the list row when it fails.
        }
      }
    };
    try {
      const workers = Math.min(Math.max(1, Math.trunc(this.detailConcurrency)), targets.length);
      await Promise.all(Array.from({ length: workers }, () => worker()));
    } finally {
      if (signal !== undefined) signal.removeEventListener('abort', onAbort);
    }
    if (fatal !== null) throw fatal;
    return merged > 0;
  }

  /**
   * Describe a blacklist record's threat level.
   * @param {Record<string, any> | null} record - blacklist payload.
   * @returns {string} one-line explanation.
   */
  blacklistMessage(record) {
    if (record === null) return '未查询到该关键词对应的违法违规名单记录。';
    const level = numberOr(record.blackListLevel, Number.NaN);
    if (!Number.isFinite(level)) return '已返回违法违规名单记录。';
    return level === 2
      ? 'blackListLevel=2：该域名/应用暂无违法违规信息。'
      : `blackListLevel=${level}：存在违法违规记录，请结合返回字段核对。`;
  }

  /**
   * Shape one query result for the model-facing tool output.
   * @param {{type: string, spec: Record<string, any>, search: string, pageNum: number, pageSize: number, params: Record<string, any> | null, rows: Array<Record<string, any>>, detailsFetched: boolean, startedAt: number, message?: string}} input - raw result parts.
   * @returns {Record<string, any>} normalized tool result.
   */
  normalize(input) {
    const { type, spec, search, pageNum, pageSize, params, rows, detailsFetched, startedAt } = input;
    // Only object rows can satisfy the declared `rows.items: {type:'object'}`
    // schema; dropping anything else keeps a hostile upstream from turning a
    // successful query into an INVALID_TOOL_OUTPUT error at the registry.
    const normalizedRows = rows
      .filter((row) => row !== null && typeof row === 'object' && !Array.isArray(row))
      .map((row) => withoutEmpty(row));
    const total = Math.max(0, Math.trunc(numberOr(params?.total, normalizedRows.length)));
    const pages = Math.max(0, Math.trunc(numberOr(params?.pages, normalizedRows.length > 0 ? 1 : 0)));
    const effectivePageNum = Math.max(1, Math.trunc(numberOr(params?.pageNum, pageNum)));
    // The upstream `hasNextPage` / `isLastPage` / `nextPage` fields are not
    // computed by this endpoint (observed: hasNextPage=false and
    // isLastPage=true even on page 2 of 568), so derive the flag from the
    // trustworthy `pageNum` and `pages` fields instead.
    const nextPageField = Math.trunc(numberOr(params?.nextPage, 0));
    const hasNextPage =
      params?.hasNextPage === true || nextPageField > effectivePageNum || effectivePageNum < pages;
    const result = {
      type,
      label: spec.label,
      search,
      pageNum: effectivePageNum,
      pageSize: Math.max(0, Math.trunc(numberOr(params?.pageSize, pageSize))),
      total,
      pages,
      hasNextPage,
      rowCount: normalizedRows.length,
      rows: normalizedRows,
      detailsFetched,
      elapsedMs: Date.now() - startedAt,
    };
    if (typeof input.message === 'string' && input.message !== '') result.message = input.message;
    return result;
  }

  /**
   * Run one ICP query through the full captcha + query + detail flow.
   * @param {{type: string, search: string, pageNum?: number, pageSize?: number, signal?: AbortSignal}} request - the query.
   * @returns {Promise<Record<string, any>>} the normalized result.
   */
  async query(request) {
    const type = typeof request?.type === 'string' ? request.type : '';
    const spec = ICP_TYPES[type];
    if (spec === undefined) {
      throw new IcpError(`不支持的查询类型“${type}”`, 'BAD_TYPE');
    }
    const search = typeof request?.search === 'string' ? request.search.trim() : '';
    if (search === '') throw new IcpError('查询关键词不能为空', 'BAD_SEARCH');
    const signal = request?.signal;
    const pageNum = Math.max(1, Math.trunc(numberOr(request?.pageNum, 1)));
    const pageSize = Math.max(1, Math.trunc(numberOr(request?.pageSize, 10)));
    const startedAt = Date.now();

    // One solved captcha session serves every call until its sign deadline; a
    // rejected sign (the official 401 “验证码不匹配”) invalidates it and one
    // fresh solve retries the same query.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const solved = await this.session(signal);
      const headers = { token: solved.token, uuid: solved.uuid, sign: solved.sign };
      if (spec.blacklist === true) {
        const body = JSON.stringify(
          spec.payloadKey === 'domainName' ? { domainName: search } : { serviceName: search, serviceType: spec.serviceType },
        );
        const text = await this.post(spec.endpoint, body, headers, signal);
        const payload = this.parse(text, `${spec.label}查询`);
        if (payload.success !== true) {
          if (isCaptchaRejection(payload) && attempt === 1) {
            this.invalidateSession();
            this.invalidateToken();
            continue;
          }
          this.assertSuccess(payload, `${spec.label}查询`);
        }
        const record = payload.params !== null && typeof payload.params === 'object' ? payload.params : null;
        return this.normalize({
          type,
          spec,
          search,
          pageNum: 1,
          pageSize: 0,
          params: null,
          rows: record === null ? [] : [record],
          detailsFetched: false,
          startedAt,
          message: this.blacklistMessage(record),
        });
      }
      const body = JSON.stringify({ pageNum, pageSize, unitName: search, serviceType: spec.serviceType });
      const text = await this.post('/icpAbbreviateInfo/queryByCondition', body, headers, signal);
      const payload = this.parse(text, 'ICP 备案查询');
      if (payload.success === true) {
        const params = payload.params !== null && typeof payload.params === 'object' ? payload.params : {};
        const rows = Array.isArray(params.list)
          ? params.list.map((row) => (row !== null && typeof row === 'object' ? { ...row } : row))
          : [];
        const detailsFetched =
          spec.detailed === true && this.includeDetails
            ? await this.attachDetails(rows, { ...solved, serviceType: spec.serviceType }, signal)
            : false;
        return this.normalize({ type, spec, search, pageNum, pageSize, params, rows, detailsFetched, startedAt });
      }
      if (isCaptchaRejection(payload) && attempt === 1) {
        this.invalidateSession();
        this.invalidateToken();
        continue;
      }
      const message = typeof payload.msg === 'string' && payload.msg !== '' ? payload.msg : '接口未返回 success=true';
      throw new IcpError(
        `ICP 备案查询失败：${message}（code=${payload.code === undefined ? '?' : payload.code}）`,
        'QUERY_FAILED',
      );
    }
    // Unreachable: every iteration above either returns a result or throws.
  }
}

/**
 * Whether a payload means the captcha session was rejected (so a retry with a
 * fresh session is worth one attempt).
 * @param {Record<string, any>} payload - parsed response.
 * @returns {boolean} true for the official 401 / 验证码 mismatch answers.
 */
function isCaptchaRejection(payload) {
  if (payload === null || typeof payload !== 'object') return false;
  if (payload.code === 401) return true;
  return typeof payload.msg === 'string' && payload.msg.includes('验证码');
}
