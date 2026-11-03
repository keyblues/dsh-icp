/**
 * dsh-icp — native MIIT ICP filing query (工信部 ICP 备案查询) for DSH.
 *
 * Registers two model-facing tools that talk straight to the MIIT project
 * query service (`https://hlwicpfwc.miit.gov.cn/icpproject_query/api`):
 *
 *   - `icp_query`       — query one of the eight filing types, with pagination
 *                         for the four normal types and the locally solved
 *                         slider captcha handled transparently.
 *   - `icp_query_types` — list the supported types, their search fields and
 *                         the effective plugin configuration.
 *
 * This is a native implementation of the flow in HG-ha/ICP_Query: no MCP
 * server, no external relay, no API key. The network work lives in
 * `lib/miit.js`, the captcha image work in `lib/png.js` + `lib/slider.js`.
 *
 * Configuration comes from the bundle's `cordis.patch.yml` row and is
 * normalized here, so the plugin has no runtime dependencies at all.
 *
 * @module dsh-icp
 */

import { ICP_ENDPOINT, ICP_TYPES, IcpClient } from './lib/miit.js';

const TAG = '[dsh-icp]';

/** Effective defaults for every configurable value. */
const DEFAULTS = {
  captchaMaxAttempts: 5,
  timeoutMs: 30000,
  maxPageSize: 10,
  detailConcurrency: 5,
  includeDetails: true,
};

/** Compact per-record fields for the model-facing result, in display order. */
const RECORD_FIELDS = [
  ['domain', '域名'],
  ['domainName', '域名'],
  ['serviceName', '服务名称'],
  ['unitName', '主办单位'],
  ['natureName', '性质'],
  ['mainLicence', '主体备案号'],
  ['serviceLicence', '服务备案号'],
  ['updateRecordTime', '审核时间'],
  ['title', '标题'],
  ['blackListLevel', '威胁等级'],
];

/**
 * Clamp an unknown value into an integer range.
 * @param {unknown} value - candidate (number or numeric string).
 * @param {number} fallback - value used when the candidate is not numeric.
 * @param {number} min - inclusive lower bound.
 * @param {number} max - inclusive upper bound.
 * @returns {number} the clamped integer.
 */
function clampInteger(value, fallback, min, max) {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/**
 * Normalize the raw Cordis config of this bundle's row into resolved values.
 * @param {unknown} raw - config object provided by the Loader.
 * @returns {{captchaMaxAttempts: number, timeoutMs: number, maxPageSize: number, detailConcurrency: number, includeDetails: boolean}} resolved config.
 */
function normalizeConfig(raw) {
  const config = raw !== null && typeof raw === 'object' ? raw : {};
  return {
    captchaMaxAttempts: clampInteger(config.captchaMaxAttempts, DEFAULTS.captchaMaxAttempts, 1, 10),
    timeoutMs: clampInteger(config.timeoutMs, DEFAULTS.timeoutMs, 5000, 120000),
    maxPageSize: clampInteger(config.maxPageSize, DEFAULTS.maxPageSize, 1, 26),
    detailConcurrency: clampInteger(config.detailConcurrency, DEFAULTS.detailConcurrency, 1, 10),
    includeDetails: config.includeDetails !== false,
  };
}

/**
 * Format one upstream value for text rendering.
 * @param {unknown} value - field value.
 * @returns {string} printable text.
 */
function printable(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Shorten one value for the durable card metadata.
 * @param {unknown} value - field value.
 * @param {number} max - maximum code points.
 * @returns {string} clipped text, or '' for empty values.
 */
function clipText(value, max = 200) {
  const text = printable(value).trim();
  if (text === '') return '';
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

/**
 * Primary display name of one filing record.
 * @param {Record<string, any>} row - upstream record.
 * @returns {string} domain / service name / unit name, or ''.
 */
function recordHead(row) {
  for (const key of ['domain', 'domainName', 'serviceName', 'unitName', 'title']) {
    const text = printable(row[key]).trim();
    if (text !== '') return text;
  }
  return '';
}

/**
 * One compact single-line record for the model-facing render: the primary name
 * followed by `label=value` pairs, with duplicates and empty fields dropped.
 * @param {Record<string, any>} row - upstream record.
 * @returns {string} one line.
 */
function recordLine(row) {
  if (row === null || typeof row !== 'object') return '';
  const head = clipText(recordHead(row), 300);
  const seen = new Set(head === '' ? [] : [head]);
  const seenLabels = new Set();
  const parts = [];
  for (const [key, label] of RECORD_FIELDS) {
    // Clamp every field: upstream values are normally short, but a broken or
    // hostile response must not be able to flood the model-facing text.
    const text = clipText(row[key], 300);
    if (text === '' || seen.has(text) || seenLabels.has(label)) continue;
    seen.add(text);
    seenLabels.add(label);
    parts.push(`${label}=${text}`);
  }
  return [head, ...parts].filter((part) => part !== '').join(' | ');
}

/**
 * Render a query result as a compact, token-friendly model-facing text.
 * @param {Record<string, any>} value - tool result.
 * @returns {string} the rendered text.
 */
function renderQuery(value) {
  const lines = [
    `ICP 备案 · ${clipText(value.label, 40)}（${clipText(value.type, 20)}）· ${clipText(value.search, 200)}`,
  ];
  if (value.pageSize > 0) {
    lines.push(
      `共 ${value.total} 条 / ${value.pages} 页 · 第 ${value.pageNum} 页（每页 ${value.pageSize} 条） · ${value.elapsedMs} ms`,
    );
  } else {
    lines.push(`违法违规名单接口（不分页） · ${value.elapsedMs} ms`);
  }
  if (typeof value.message === 'string' && value.message !== '') lines.push(value.message);
  if (value.rowCount === 0) {
    // `message` already explains an empty blacklist; only add the generic line
    // when the result carries no explanation of its own.
    if (!(typeof value.message === 'string' && value.message !== '')) lines.push('未查询到备案记录。');
    return lines.join('\n');
  }
  const rows = Array.isArray(value.rows) ? value.rows : [];
  rows.forEach((row, index) => {
    const line = recordLine(row);
    if (line !== '') lines.push(`${index + 1}. ${line}`);
  });
  if (value.detailsFetched === true) lines.push('（已按官方详情接口补全 APP / 小程序 / 快应用详情。）');
  if (value.hasNextPage === true && value.pageSize > 0) lines.push(`下一页：page_num=${value.pageNum + 1}`);
  return lines.join('\n');
}

/**
 * Render the type catalog.
 * @param {Record<string, any>} value - tool result.
 * @returns {string} the rendered text.
 */
function renderTypes(value) {
  const lines = [`工信部 ICP 备案查询 · 支持类型（共 ${value.count} 类）`, ''];
  for (const item of value.types) {
    const pagination = item.paginated ? '可分页' : '黑名单，不分页';
    lines.push(`- ${item.type}（${item.label}）：${pagination}；search 可填 ${item.search_hint}`);
  }
  lines.push('', `官方接口：${value.endpoint}`, value.note);
  const config = value.config ?? {};
  lines.push(
    `当前生效配置：验证码最多尝试 ${config.captcha_max_attempts} 次；单请求超时 ${config.timeout_ms} ms；单页上限 ${config.max_page_size} 条；详情并发 ${config.detail_concurrency}；补全应用详情 ${config.include_details ? '开启' : '关闭'}。`,
  );
  return lines.join('\n');
}

/**
 * Build the catalog payload returned by `icp_query_types`.
 * @param {{captchaMaxAttempts: number, timeoutMs: number, maxPageSize: number, detailConcurrency: number, includeDetails: boolean}} config - resolved config.
 * @returns {Record<string, any>} the catalog.
 */
function typesSnapshot(config) {
  const types = Object.entries(ICP_TYPES).map(([type, spec]) => ({
    type,
    label: spec.label,
    blacklist: spec.blacklist === true,
    paginated: spec.blacklist !== true,
    service_type: spec.serviceType,
    search_hint: spec.searchHint,
  }));
  return {
    count: types.length,
    types,
    endpoint: ICP_ENDPOINT,
    note: '官方接口无 API Key；滑块验证码会话在有效期内复用，仅会话过期后的首次查询需要解滑块（约 1 秒，其后约 0.2–0.4 秒）。受创宇盾反爬与访问频率限制，请勿并发或高频调用。',
    config: {
      captcha_max_attempts: config.captchaMaxAttempts,
      timeout_ms: config.timeoutMs,
      max_page_size: config.maxPageSize,
      detail_concurrency: config.detailConcurrency,
      include_details: config.includeDetails,
    },
  };
}

/**
 * One record reduced to the compact field subset used by the tool card.
 * @param {Record<string, any>} row - upstream record.
 * @returns {Record<string, string>} clipped non-empty fields.
 */
function cardRow(row) {
  const out = {};
  if (row === null || typeof row !== 'object') return out;
  for (const [key] of RECORD_FIELDS) {
    const text = clipText(row[key], 120);
    if (text !== '') out[key] = text;
  }
  return out;
}

/**
 * Durable card facts for one `icp_query` result: small enough to stay in the
 * session log, detailed enough to redraw the card after a spill or a fork.
 * @param {Record<string, any>} value - tool result.
 * @returns {Record<string, any>} the card metadata.
 */
function queryCardMeta(value) {
  const rows = Array.isArray(value.rows) ? value.rows : [];
  const meta = {
    kind: 'icp',
    type: value.type,
    label: value.label,
    search: clipText(value.search),
    pageNum: value.pageNum,
    pageSize: value.pageSize,
    total: value.total,
    pages: value.pages,
    hasNextPage: value.hasNextPage === true,
    rowCount: value.rowCount,
    detailsFetched: value.detailsFetched === true,
    elapsedMs: value.elapsedMs,
    blacklist: !(value.pageSize > 0),
    rows: rows.slice(0, 10).map(cardRow),
    rowsTruncated: rows.length > 10,
  };
  const message = clipText(value.message, 300);
  if (message !== '') meta.message = message;
  // Hard cap the durable payload: a hostile 26-row page must not grow the
  // session log without bound (typical meta is ~1 KB, this cap is ~8 KB).
  while (meta.rows.length > 0 && JSON.stringify(meta).length > 8000) {
    meta.rows.pop();
    meta.rowsTruncated = true;
  }
  return meta;
}

/**
 * Durable card facts for one `icp_query_types` result.
 * @param {Record<string, any>} value - tool result.
 * @returns {Record<string, any>} the card metadata.
 */
function typesCardMeta(value) {
  return {
    kind: 'icp-types',
    count: value.count,
    endpoint: value.endpoint,
    note: clipText(value.note, 400),
    config: value.config,
    types: Array.isArray(value.types) ? value.types : [],
  };
}

/**
 * Build the two tool definitions bound to one resolved config.
 * @param {{captchaMaxAttempts: number, timeoutMs: number, maxPageSize: number, detailConcurrency: number, includeDetails: boolean}} config - resolved config.
 * @returns {{queryTool: Record<string, any>, typesTool: Record<string, any>, client: IcpClient}} tools and their shared client.
 */
function buildTools(config) {
  const client = new IcpClient(config);
  const typeKeys = Object.keys(ICP_TYPES);
  const typeSummary = typeKeys.map((key) => `${key} ${ICP_TYPES[key].label}`).join('、');

  const queryTool = {
    name: 'icp_query',
    description:
      '查询工信部 ICP 备案（网站 / APP / 小程序 / 快应用及四类违规黑名单）。' +
      'type 取 web、app、mapp、kapp（可分页）或 bweb、bapp、bmapp、bkapp（黑名单，不分页）；' +
      'search 填域名、单位名称、备案号或应用名。验证码会话在有效期内复用，请勿并发调用。page_num 上限 10000，page_size 受 maxPageSize 限制。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: {
          type: 'string',
          enum: typeKeys,
          description: `查询类型：${typeSummary}。`,
        },
        search: {
          type: 'string',
          description: '域名、单位名称、备案号或应用名。',
        },
        page_num: {
          type: 'integer',
          description: '页码，从 1 开始，上限 10000；黑名单忽略。',
        },
        page_size: {
          type: 'integer',
          description: '每页条数，默认 10，上限 max_page_size（官方 26）；黑名单忽略。',
        },
      },
      required: ['type', 'search'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string' },
          label: { type: 'string' },
          search: { type: 'string' },
          pageNum: { type: 'integer' },
          pageSize: { type: 'integer' },
          total: { type: 'integer' },
          pages: { type: 'integer' },
          hasNextPage: { type: 'boolean' },
          rowCount: { type: 'integer' },
          rows: { type: 'array', items: { type: 'object', additionalProperties: true } },
          detailsFetched: { type: 'boolean' },
          elapsedMs: { type: 'integer' },
          message: { type: 'string' },
        },
        required: [
          'type',
          'label',
          'search',
          'pageNum',
          'pageSize',
          'total',
          'pages',
          'hasNextPage',
          'rowCount',
          'rows',
          'detailsFetched',
          'elapsedMs',
        ],
      },
      render: (_args, value) => [{ type: 'text', text: renderQuery(value) }],
      // Durable card facts: the Client half redraws the card from these even
      // after the model-facing content was spilled to disk or a session fork.
      presentationMeta: (_args, value) => queryCardMeta(value),
    },
    // Worst case: captcha rounds (image + check each), the query itself and the
    // detail fan-out batches, each bounded by one request timeout.
    timeoutMs: Math.min(
      600000,
      config.timeoutMs *
        (config.captchaMaxAttempts * 2 + 2 + Math.ceil(config.maxPageSize / Math.max(1, config.detailConcurrency))),
    ),
    // Solving a captcha and querying the official service is stateful and
    // rate-limited; never run two ICP queries in parallel.
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const type = typeof args?.type === 'string' ? args.type.trim() : '';
      const spec = ICP_TYPES[type];
      if (spec === undefined) {
        throw new Error(`不支持的 type“${type}”；可取值：${typeKeys.join('、')}。`);
      }
      const search = typeof args?.search === 'string' ? args.search.trim() : '';
      if (search === '') {
        throw new Error('search 不能为空：请传域名、主办单位名称、备案号或应用名称。');
      }
      const blacklist = spec.blacklist === true;
      const pageNum = blacklist ? 1 : clampInteger(args?.page_num, 1, 1, 10000);
      const defaultPageSize = Math.min(10, config.maxPageSize);
      const pageSize = blacklist
        ? 0
        : clampInteger(args?.page_size, defaultPageSize, 1, config.maxPageSize);
      return await client.query({ type, search, pageNum, pageSize, signal: exec?.signal });
    },
  };

  const typesTool = {
    name: 'icp_query_types',
    description: '列出 ICP 查询的 8 种类型、search 填写方式与当前配置。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer' },
          types: { type: 'array', items: { type: 'object', additionalProperties: true } },
          endpoint: { type: 'string' },
          note: { type: 'string' },
          config: { type: 'object', additionalProperties: true },
        },
        required: ['count', 'types', 'endpoint', 'note', 'config'],
      },
      render: (_args, value) => [{ type: 'text', text: renderTypes(value) }],
      presentationMeta: (_args, value) => typesCardMeta(value),
    },
    timeoutMs: 10000,
    isConcurrencySafe: () => true,
    async execute() {
      return typesSnapshot(config);
    },
  };

  return { queryTool, typesTool, client };
}

/** Cordis plugin name (matches the bundle row id). */
export const name = 'dsh-icp';
/** The tool registry is a hard dependency: this plugin contributes tools only. */
export const inject = ['tools'];

/**
 * Cordis entry point: normalize config, build the client and register tools.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {unknown} rawConfig - config from the Loader row.
 * @returns {void}
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig);
  const { queryTool, typesTool } = buildTools(config);
  ctx.effect(() => ctx.tools.register(queryTool), 'dsh-icp: icp_query');
  ctx.effect(() => ctx.tools.register(typesTool), 'dsh-icp: icp_query_types');
  console.info(
    `${TAG} 已注册 icp_query / icp_query_types（captchaMaxAttempts=${config.captchaMaxAttempts}, timeoutMs=${config.timeoutMs}, maxPageSize=${config.maxPageSize}, includeDetails=${config.includeDetails}）`,
  );
}

/** Exported for local rendering checks, not part of the Cordis contract. */
export {
  normalizeConfig,
  queryCardMeta,
  recordLine,
  renderQuery,
  renderTypes,
  typesCardMeta,
  typesSnapshot,
};
