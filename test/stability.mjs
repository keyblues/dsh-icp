// Offline stability + fault-injection suite for the dsh-icp Host core.
//
// Everything here runs against a fake MIIT server (patched `globalThis.fetch`),
// so it is deterministic, fast and never touches the real API. It exercises the
// failure modes the real service can produce: auth/token expiry, captcha
// mismatch, captcha solve failures, anti-bot blocking, network errors, timeouts,
// malformed payloads, oversized responses, detail degradation, aborts,
// concurrent callers, malformed PNGs, and pathological result values.
//
//   node --unhandled-rejections=strict dsh-icp/test/stability.mjs
import { deflateSync } from 'node:zlib';
import { IcpClient, IcpBlockedError, IcpError } from '../lib/miit.js';
import { decodePng } from '../lib/png.js';
import { findSliderOffset } from '../lib/slider.js';
import { normalizeConfig, queryCardMeta, recordLine, renderQuery, renderTypes, typesSnapshot } from '../index.js';

/* ---------------------------------------------------------------- */
/* Tiny assertion / check framework                                  */
/* ---------------------------------------------------------------- */

const results = [];
const unhandled = [];
process.on('unhandledRejection', (reason) => {
  unhandled.push(reason);
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function check(label, fn) {
  try {
    await fn();
    results.push({ label, ok: true });
    console.log(`PASS ${label}`);
  } catch (error) {
    results.push({ label, ok: false, error });
    console.log(`FAIL ${label} -> ${error instanceof Error ? error.message : String(error)}`);
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------------------------------------------------------------- */
/* Synthetic PNG fixtures (encoder, so the captcha pipeline is real) */
/* ---------------------------------------------------------------- */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** Encode an 8-bit RGB PNG; `pixelAt(x, y)` returns `[r, g, b]`. */
function encodePng(width, height, pixelAt) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixelAt(x, y);
      const offset = y * (stride + 1) + 1 + x * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Build a PNG whose IHDR claims arbitrary properties (for decoder guards). */
function pngWithHeader({ width, height, bitDepth, colorType, interlace = 0, palette = true }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = bitDepth;
  header[9] = colorType;
  header[12] = interlace;
  const chunks = [PNG_SIGNATURE, pngChunk('IHDR', header)];
  if (palette && colorType === 3) chunks.push(pngChunk('PLTE', Buffer.alloc(3)));
  chunks.push(pngChunk('IDAT', deflateSync(Buffer.alloc(16))), pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

/** Encode an 8-bit palette PNG; pixel index is `x % palette.length`. */
function encodePalettePng(width, height, palette) {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    for (let x = 0; x < width; x += 1) raw[y * (width + 1) + 1 + x] = x % palette.length;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 3;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('PLTE', Buffer.from(palette.flat())),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Encode a 16-bit grayscale PNG with one constant sample value. */
function encodeGray16Png(width, height, sample) {
  const stride = width * 2;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      raw[y * (stride + 1) + 1 + x * 2] = (sample >> 8) & 0xff;
      raw[y * (stride + 1) + 2 + x * 2] = sample & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 16;
  header[9] = 0;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const SLIDER_SIZE = 40;
const NOTCH = { x: 60, y: 20, size: 20 };
const SMALL_PNG = encodePng(SLIDER_SIZE, SLIDER_SIZE, () => [128, 128, 128]);
// Textured background (many distinct quantized colours, like a photo) with one
// solid square notch: that is the shape the heuristic is designed to find.
const BIG_PNG = encodePng(200, 100, (x, y) =>
  x >= NOTCH.x && x < NOTCH.x + NOTCH.size && y >= NOTCH.y && y < NOTCH.y + NOTCH.size
    ? [255, 255, 255]
    : [(x * 37 + y * 91) % 251, (x * 17 + y * 131) % 251, (x * 71 + y * 43) % 251],
);
const SMALL_B64 = SMALL_PNG.toString('base64');
const BIG_B64 = BIG_PNG.toString('base64');
/** The heuristic works on the half-resolution image and doubles its result. */
const EXPECTED_OFFSET = NOTCH.x;

function makeSign(expiry) {
  const payload = Buffer.from(JSON.stringify({ type: 3, e: expiry }), 'utf8').toString('base64url');
  return `eyJhbGciOiJub25lIn0.${payload}.signature`;
}

/* ---------------------------------------------------------------- */
/* Fake MIIT server                                                  */
/* ---------------------------------------------------------------- */

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

const DEFAULT_QUERY = {
  success: true,
  code: 200,
  msg: '操作成功',
  params: {
    hasNextPage: false,
    pageNum: 1,
    pageSize: 3,
    pages: 1,
    total: 1,
    list: [
      {
        domain: 'baidu.com',
        unitName: '北京百度网讯科技有限公司',
        natureName: '企业',
        mainLicence: '京ICP证030173号',
        serviceLicence: '京ICP证030173号-1',
        updateRecordTime: '2019-05-16 16:06:21',
      },
    ],
  },
};

function makeEnv(options = {}) {
  const env = {
    calls: [],
    authCount: 0,
    imageCount: 0,
    checkCount: 0,
    queryCount: 0,
    detailCount: 0,
    overrides: [],
    authExpire: options.authExpire ?? 300000,
    signExpiry: options.signExpiry ?? Date.now() + 300000,
    queryDelayMs: options.queryDelayMs ?? 0,
    query: options.query ?? (() => DEFAULT_QUERY),
    detail: options.detail ?? (() => ({ success: true, code: 200, params: { dataId: 1, serviceName: '微信' } })),
  };
  env.override = (match, handler) => {
    env.overrides.push({ match, handler });
  };
  env.fetch = async (input, init = {}) => {
    // Real fetch rejects immediately when the signal is already aborted.
    if (init.signal !== undefined && init.signal.aborted) {
      throw init.signal.reason instanceof Error ? init.signal.reason : new Error('aborted');
    }
    const url = new URL(String(input));
    const path = url.pathname.replace('/icpproject_query/api', '');
    env.calls.push(path);
    const override = [...env.overrides].reverse().find((entry) => path.includes(entry.match));
    if (override !== undefined) return override.handler({ path, init, env });
    if (path === '/auth') {
      env.authCount += 1;
      return jsonResponse({ code: 200, msg: '操作成功', params: { bussiness: `TOKEN-${env.authCount}`, expire: env.authExpire } });
    }
    if (path === '/image/getCheckImagePoint') {
      env.imageCount += 1;
      return jsonResponse({
        code: 200,
        msg: '操作成功',
        params: { uuid: `uuid-${env.imageCount}`, bigImage: BIG_B64, smallImage: SMALL_B64, height: SLIDER_SIZE },
      });
    }
    if (path === '/image/checkImage') {
      env.checkCount += 1;
      const expiry = typeof env.signExpiry === 'function' ? env.signExpiry() : env.signExpiry;
      return jsonResponse({ success: true, code: 200, msg: '操作成功', params: makeSign(expiry) });
    }
    if (path === '/icpAbbreviateInfo/queryByCondition') {
      env.queryCount += 1;
      if (env.queryDelayMs > 0) await delay(env.queryDelayMs);
      return jsonResponse(env.query());
    }
    if (path === '/icpAbbreviateInfo/queryDetailByAppAndMiniId') {
      env.detailCount += 1;
      return jsonResponse(env.detail());
    }
    return jsonResponse({ code: 404, msg: `no route: ${path}` }, 404);
  };
  return env;
}

/** Run `fn` with `globalThis.fetch` replaced by the fake server. */
async function withEnv(env, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = env.fetch;
  try {
    return await fn(env);
  } finally {
    globalThis.fetch = original;
  }
}

/** A fake handler that never answers, but honours AbortSignal like fetch does. */
function hang(init) {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (signal === undefined) return;
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason instanceof Error ? signal.reason : new Error('aborted')), {
      once: true,
    });
  });
}

const FAST = { timeoutMs: 2000, captchaMaxAttempts: 2, detailConcurrency: 2, includeDetails: true };

/* ---------------------------------------------------------------- */
/* 0. Fixtures self-check: the captcha pipeline actually solves.      */
/* ---------------------------------------------------------------- */

await check('fixture: synthetic captcha is solvable by the slider heuristic', () => {
  const big = decodePng(BIG_PNG);
  const small = decodePng(SMALL_PNG);
  assert(big.width === 200 && big.height === 100, `big=${big.width}x${big.height}`);
  const match = findSliderOffset(small, big);
  assert(match.ok === true, `match failed: ${match.reason}`);
  assert(match.offsetX === EXPECTED_OFFSET, `offset=${match.offsetX}, expected ${EXPECTED_OFFSET}`);
});

/* ---------------------------------------------------------------- */
/* 1. Happy path, token cache and captcha-session reuse.              */
/* ---------------------------------------------------------------- */

await check('happy path: one query returns a normalized row and reuses the token', async () => {
  const env = makeEnv();
  await withEnv(env, async () => {
    const client = new IcpClient(FAST);
    const value = await client.query({ type: 'web', search: 'baidu.com', pageNum: 1, pageSize: 3 });
    assert(value.rowCount === 1, `rowCount=${value.rowCount}`);
    assert(value.total === 1 && value.pages === 1, `total=${value.total} pages=${value.pages}`);
    assert(value.rows[0].unitName === '北京百度网讯科技有限公司', 'row content');
    assert(env.authCount === 1 && env.imageCount === 1 && env.queryCount === 1, `calls auth=${env.authCount} image=${env.imageCount} query=${env.queryCount}`);
    const rendered = renderQuery(value);
    assert(rendered.startsWith('ICP 备案 · 网站备案（web）· baidu.com'), rendered.split('\n')[0]);
    assert(rendered.includes('主办单位=北京百度网讯科技有限公司'), 'render row');
    const meta = queryCardMeta(value);
    assert(meta.kind === 'icp' && meta.rows.length === 1 && meta.rows[0].domain === 'baidu.com', 'card meta');
  });
});

await check('session reuse: a second query skips the captcha solve', async () => {
  const env = makeEnv();
  await withEnv(env, async () => {
    const client = new IcpClient(FAST);
    await client.query({ type: 'web', search: 'baidu.com' });
    await client.query({ type: 'app', search: '微信' });
    assert(env.imageCount === 1, `captcha solves=${env.imageCount}`);
    assert(env.queryCount === 2, `queries=${env.queryCount}`);
    assert(env.authCount === 1, `auth=${env.authCount}`);
  });
});

await check('token expiry: an expiring token is refreshed on the next solve', async () => {
  const env = makeEnv({ authExpire: 1, signExpiry: () => Date.now() + 6500 });
  await withEnv(env, async () => {
    const client = new IcpClient(FAST);
    await client.query({ type: 'web', search: 'baidu.com' });
    // The client keeps a 5 s safety margin before the sign's own deadline, so
    // this sign yields ~1.5 s of reuse; wait it out together with the token.
    await delay(1800);
    await client.query({ type: 'web', search: 'baidu.com' });
    assert(env.authCount === 2, `auth=${env.authCount}`);
    assert(env.imageCount === 2, `captcha solves=${env.imageCount}`);
  });
});

/* ---------------------------------------------------------------- */
/* 2. Captcha failures, mismatch retry and anti-bot blocking.         */
/* ---------------------------------------------------------------- */

await check('401 captcha mismatch: retries once with a fresh session and token', async () => {
  const env = makeEnv();
  let first = true;
  env.override('/icpAbbreviateInfo/queryByCondition', ({ env: server }) => {
    server.queryCount += 1;
    if (first) {
      first = false;
      return jsonResponse({ success: false, code: 401, msg: '请求非法,验证码不匹配!!' });
    }
    return jsonResponse(DEFAULT_QUERY);
  });
  await withEnv(env, async () => {
    const client = new IcpClient(FAST);
    const value = await client.query({ type: 'web', search: 'baidu.com' });
    assert(value.rowCount === 1, 'recovered result');
    assert(env.queryCount === 2, `queries=${env.queryCount}`);
    assert(env.imageCount === 2, `captcha solves=${env.imageCount}`);
    assert(env.authCount === 2, `auth=${env.authCount}`);
  });
});

await check('captcha solve failure: bounded attempts, actionable CAPTCHA_FAILED', async () => {
  const env = makeEnv();
  env.override('/image/checkImage', ({ env: server }) => {
    server.checkCount += 1;
    return jsonResponse({ success: false, code: 200, msg: '验证码校验失败' });
  });
  await withEnv(env, async () => {
    const client = new IcpClient({ ...FAST, captchaMaxAttempts: 3 });
    try {
      await client.query({ type: 'web', search: 'baidu.com' });
      assert(false, 'expected CAPTCHA_FAILED');
    } catch (error) {
      assert(error instanceof IcpError, `type=${error?.name}`);
      assert(error.code === 'CAPTCHA_FAILED', `code=${error.code}`);
      assert(error.message.includes('滑块验证码连续 3 次未通过'), error.message);
      assert(env.imageCount === 3 && env.checkCount === 3, `image=${env.imageCount} check=${env.checkCount}`);
    }
  });
});

await check('in-solve token 401: the token is refreshed instead of reused stale', async () => {
  const env = makeEnv();
  let imageAttempts = 0;
  env.override('/image/getCheckImagePoint', ({ env: server }) => {
    imageAttempts += 1;
    server.imageCount += 1;
    if (imageAttempts === 1) return jsonResponse({ code: 401, msg: '登录已过期' });
    return jsonResponse({
      code: 200,
      params: { uuid: `uuid-${server.imageCount}`, bigImage: BIG_B64, smallImage: SMALL_B64, height: SLIDER_SIZE },
    });
  });
  await withEnv(env, async () => {
    const client = new IcpClient(FAST);
    const value = await client.query({ type: 'web', search: 'baidu.com' });
    assert(value.rowCount === 1, 'recovered after the token refresh');
    assert(env.authCount === 2, `auth=${env.authCount}`);
    assert(imageAttempts === 2, `image attempts=${imageAttempts}`);
    assert(env.queryCount === 1, `queries=${env.queryCount}`);
  });
});

await check('anti-bot block page: raises BLOCKED without retrying the captcha loop', async () => {
  const env = makeEnv();
  env.override('/auth', () => new Response('当前访问疑似黑客攻击，请稍后再试', { status: 200 }));
  await withEnv(env, async () => {
    const client = new IcpClient(FAST);
    try {
      await client.query({ type: 'web', search: 'baidu.com' });
      assert(false, 'expected BLOCKED');
    } catch (error) {
      assert(error instanceof IcpBlockedError, `type=${error?.name}`);
      assert(error.code === 'BLOCKED', `code=${error.code}`);
      assert(error.message.includes('创宇盾'), error.message);
      assert(env.imageCount === 0, `captcha solves=${env.imageCount}`);
    }
  });
});

/* ---------------------------------------------------------------- */
/* 3. Transport failures: network error, timeout, oversized body.     */
/* ---------------------------------------------------------------- */

await check('network error: wrapped as NETWORK with a readable message', async () => {
  const env = makeEnv();
  env.override('/auth', () => {
    throw new TypeError('fetch failed');
  });
  await withEnv(env, async () => {
    const client = new IcpClient(FAST);
    try {
      await client.query({ type: 'web', search: 'baidu.com' });
      assert(false, 'expected NETWORK');
    } catch (error) {
      assert(error instanceof IcpError, `type=${error?.name}`);
      assert(error.code === 'NETWORK', `code=${error.code}`);
      assert(error.message.includes('fetch failed'), error.message);
    }
  });
});

await check('timeout: aborts the request and reports TIMEOUT/CAPTCHA_FAILED quickly', async () => {
  const env = makeEnv();
  env.override('/auth', ({ init }) => hang(init));
  await withEnv(env, async () => {
    const client = new IcpClient({ ...FAST, timeoutMs: 30, captchaMaxAttempts: 1 });
    const startedAt = Date.now();
    try {
      await client.query({ type: 'web', search: 'baidu.com' });
      assert(false, 'expected failure');
    } catch (error) {
      const elapsed = Date.now() - startedAt;
      assert(error instanceof IcpError, `type=${error?.name}`);
      // A timeout while authenticating surfaces as TIMEOUT; one while solving the
      // captcha is retried and surfaces as CAPTCHA_FAILED. Both are actionable.
      assert(error.code === 'TIMEOUT' || error.code === 'CAPTCHA_FAILED', `code=${error.code}`);
      assert(error.message.includes('超时'), error.message);
      assert(elapsed < 2000, `elapsed=${elapsed}ms`);
    }
  });
});

await check('oversized response: rejected before it can exhaust memory', async () => {
  const env = makeEnv();
  env.override('/icpAbbreviateInfo/queryByCondition', () => new Response('x'.repeat(5 * 1024 * 1024), { status: 200 }));
  await withEnv(env, async () => {
    const client = new IcpClient(FAST);
    try {
      await client.query({ type: 'web', search: 'baidu.com' });
      assert(false, 'expected RESPONSE_TOO_LARGE');
    } catch (error) {
      assert(error instanceof IcpError, `type=${error?.name}`);
      assert(error.code === 'RESPONSE_TOO_LARGE', `code=${error.code}`);
    }
  });
});

await check('non-JSON body: BAD_RESPONSE with a short excerpt', async () => {
  const env = makeEnv();
  env.override('/icpAbbreviateInfo/queryByCondition', () => new Response('<html>oops</html>', { status: 200 }));
  await withEnv(env, async () => {
    const client = new IcpClient(FAST);
    try {
      await client.query({ type: 'web', search: 'baidu.com' });
      assert(false, 'expected BAD_RESPONSE');
    } catch (error) {
      assert(error.code === 'BAD_RESPONSE', `code=${error.code}`);
      assert(error.message.includes('<html>'), error.message);
    }
  });
});

await check('abort before the call: rejects fast with ABORTED', async () => {
  const env = makeEnv();
  await withEnv(env, async () => {
    const client = new IcpClient(FAST);
    const controller = new AbortController();
    controller.abort();
    const startedAt = Date.now();
    try {
      await client.query({ type: 'web', search: 'baidu.com', signal: controller.signal });
      assert(false, 'expected ABORTED');
    } catch (error) {
      assert(error instanceof IcpError, `type=${error?.name}`);
      assert(error.code === 'ABORTED' || error.name === 'AbortError', `code=${error.code}`);
      assert(Date.now() - startedAt < 1000, 'abort latency');
    }
  });
});

/* ---------------------------------------------------------------- */
/* 4. Degraded / malformed payloads.                                  */
/* ---------------------------------------------------------------- */

await check('empty list: normalized to zero rows without throwing', async () => {
  const env = makeEnv();
  env.query = () => ({ success: true, code: 200, params: { list: [], total: 0, pages: 0, pageNum: 1, pageSize: 3 } });
  await withEnv(env, async () => {
    const client = new IcpClient(FAST);
    const value = await client.query({ type: 'web', search: 'nothing.example' });
    assert(value.rowCount === 0 && value.total === 0 && value.hasNextPage === false, 'normalized empty');
    assert(renderQuery(value).includes('未查询到备案记录'), 'render empty');
    assert(queryCardMeta(value).rows.length === 0, 'meta empty');
  });
});

await check('missing params: tolerated as an empty result', async () => {
  const env = makeEnv();
  env.query = () => ({ success: true, code: 200, params: null });
  await withEnv(env, async () => {
    const client = new IcpClient(FAST);
    const value = await client.query({ type: 'web', search: 'x' });
    assert(value.rowCount === 0, `rowCount=${value.rowCount}`);
    renderQuery(value); // must not throw
    queryCardMeta(value);
  });
});

await check('detail failure: degrades to the list row, query still succeeds', async () => {
  const env = makeEnv();
  env.query = () => ({
    success: true,
    code: 200,
    params: { list: [{ dataId: 7459319, serviceName: '', unitName: '深圳市腾讯计算机系统有限公司' }], total: 1, pages: 1, pageNum: 1, pageSize: 3 },
  });
  env.detail = () => ({ success: false, code: 500, msg: '服务器异常' });
  await withEnv(env, async () => {
    const client = new IcpClient(FAST);
    const value = await client.query({ type: 'app', search: '微信' });
    assert(value.detailsFetched === false, `detailsFetched=${value.detailsFetched}`);
    assert(value.rowCount === 1 && value.rows[0].dataId === 7459319, 'row kept');
    assert(env.detailCount === 1, `detail calls=${env.detailCount}`);
  });
});

await check('detail endpoint blocked: BLOCKED propagates instead of being swallowed', async () => {
  const env = makeEnv();
  env.query = () => ({
    success: true,
    code: 200,
    params: { list: [{ dataId: 1, unitName: 'X' }], total: 1, pages: 1, pageNum: 1, pageSize: 3 },
  });
  env.override('/icpAbbreviateInfo/queryDetailByAppAndMiniId', () => new Response('当前访问疑似黑客攻击', { status: 200 }));
  await withEnv(env, async () => {
    const client = new IcpClient(FAST);
    try {
      await client.query({ type: 'app', search: '微信' });
      assert(false, 'expected BLOCKED');
    } catch (error) {
      assert(error.code === 'BLOCKED', `code=${error.code}`);
    }
  });
});

await check('detail fan-out: a BLOCKED answer cancels the sibling workers', async () => {
  const env = makeEnv();
  const rows = Array.from({ length: 26 }, (_, index) => ({ dataId: index + 1, unitName: `公司${index}` }));
  env.query = () => ({
    success: true,
    code: 200,
    params: { list: rows, total: 26, pages: 1, pageNum: 1, pageSize: 26 },
  });
  let detailRequests = 0;
  env.override('/icpAbbreviateInfo/queryDetailByAppAndMiniId', ({ env: server }) => {
    server.detailCount += 1;
    detailRequests += 1;
    if (detailRequests === 1) return new Response('当前访问疑似黑客攻击', { status: 200 });
    return jsonResponse({ success: true, code: 200, params: { serviceName: 'x' } });
  });
  await withEnv(env, async () => {
    const client = new IcpClient({ ...FAST, detailConcurrency: 5 });
    try {
      await client.query({ type: 'app', search: '微信', pageSize: 26 });
      assert(false, 'expected BLOCKED');
    } catch (error) {
      assert(error.code === 'BLOCKED', `code=${error.code}`);
      // Only the in-flight batch may still be dispatched; the remaining rows
      // must not keep hitting a blocked endpoint.
      assert(detailRequests <= 6, `detail requests=${detailRequests}`);
    }
  });
});

await check('pathological rows: null entries are dropped, huge values stay bounded', async () => {
  const env = makeEnv();
  const huge = 'A'.repeat(10000);
  env.query = () => ({
    success: true,
    code: 200,
    params: {
      list: [null, 'not-a-row', 42, { domain: huge, unitName: huge, mainLicence: 12345 }, { domain: 'ok.example' }],
      total: 5,
      pages: 1,
      pageNum: 1,
      pageSize: 5,
    },
  });
  await withEnv(env, async () => {
    const client = new IcpClient(FAST);
    const value = await client.query({ type: 'web', search: 'x' });
    // The output schema declares `rows.items: {type:'object'}`, so the registry
    // would reject any non-object row: normalize() must drop them.
    assert(value.rows.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row)), 'row types');
    assert(value.rowCount === 2, `rowCount=${value.rowCount}`);
    const rendered = renderQuery(value);
    assert(rendered.length < 4000, `render length=${rendered.length}`);
    assert(rendered.includes('ok.example'), 'normal row kept');
    const meta = queryCardMeta(value);
    assert(JSON.stringify(meta).length < 8000, `meta length=${JSON.stringify(meta).length}`);
    assert(recordLine({ domain: huge }).length < 1000, 'recordLine bounded');
  });
});

/* ---------------------------------------------------------------- */
/* 5. Concurrency and repetition.                                     */
/* ---------------------------------------------------------------- */

await check('concurrent first calls share one captcha solve (single-flight)', async () => {
  const env = makeEnv({ queryDelayMs: 5 });
  await withEnv(env, async () => {
    const client = new IcpClient(FAST);
    const [first, second] = await Promise.all([
      client.query({ type: 'web', search: 'baidu.com' }),
      client.query({ type: 'web', search: 'baidu.com' }),
    ]);
    assert(first.rowCount === 1 && second.rowCount === 1, 'both succeeded');
    assert(env.imageCount === 1, `captcha solves=${env.imageCount}`);
    assert(env.authCount === 1, `auth=${env.authCount}`);
    assert(env.queryCount === 2, `queries=${env.queryCount}`);
  });
});

await check('repeated queries: bounded state and stable success rate', async () => {
  const env = makeEnv();
  await withEnv(env, async () => {
    const client = new IcpClient(FAST);
    for (let index = 0; index < 10; index += 1) {
      const value = await client.query({ type: 'web', search: `domain-${index}.example` });
      assert(value.rowCount === 1, `iteration ${index}`);
    }
    assert(env.imageCount === 1, `captcha solves=${env.imageCount}`);
    assert(env.queryCount === 10, `queries=${env.queryCount}`);
    assert(JSON.stringify(client.captchaSession).length < 2000, 'session stays small');
  });
});

/* ---------------------------------------------------------------- */
/* 6. PNG decoder and slider guards.                                  */
/* ---------------------------------------------------------------- */

await check('png guards: bad signature / bit depth / interlace / palette / size', () => {
  const cases = [
    ['bad signature', Buffer.from('not a png')],
    ['unsupported bit depth', pngWithHeader({ width: 2, height: 2, bitDepth: 4, colorType: 0 })],
    ['interlaced', pngWithHeader({ width: 2, height: 2, bitDepth: 8, colorType: 0, interlace: 1 })],
    ['missing palette', pngWithHeader({ width: 2, height: 2, bitDepth: 8, colorType: 3, palette: false })],
    ['too large', pngWithHeader({ width: 5000, height: 5000, bitDepth: 8, colorType: 0 })],
  ];
  for (const [label, buffer] of cases) {
    let threw = false;
    try {
      decodePng(buffer);
    } catch {
      threw = true;
    }
    assert(threw, `${label} should throw`);
  }
});

await check('png positive: palette and 16-bit grayscale decode', () => {
  const paletteImage = decodePng(
    encodePalettePng(4, 2, [
      [255, 0, 0],
      [0, 255, 0],
    ]),
  );
  assert(paletteImage.width === 4 && paletteImage.height === 2, `palette dims=${paletteImage.width}x${paletteImage.height}`);
  assert(paletteImage.rgb[0] === 255 && paletteImage.rgb[1] === 0 && paletteImage.rgb[2] === 0, 'palette px0');
  assert(paletteImage.rgb[3] === 0 && paletteImage.rgb[4] === 255 && paletteImage.rgb[5] === 0, 'palette px1');

  const grayImage = decodePng(encodeGray16Png(2, 1, 0xabcd));
  assert(grayImage.width === 2 && grayImage.height === 1, `gray dims=${grayImage.width}x${grayImage.height}`);
  assert(grayImage.rgb[0] === 0xab && grayImage.rgb[3] === 0xab, `16-bit high byte=${grayImage.rgb[0]}`);
});

await check('slider guards: tiny/degenerate inputs return ok:false', () => {
  const tiny = { width: 1, height: 1, rgb: new Uint8Array(3) };
  assert(findSliderOffset(tiny, tiny).ok === false, '1x1');
  assert(findSliderOffset({ width: 0, height: 0, rgb: new Uint8Array(0) }, tiny).ok === false, 'zero');
  assert(findSliderOffset({ width: 40, height: 40, rgb: new Uint8Array(3) }, { width: 4, height: 4, rgb: new Uint8Array(3) }).ok === false, 'mismatched rgb');
});

/* ---------------------------------------------------------------- */
/* 7. Config normalization and catalog rendering.                     */
/* ---------------------------------------------------------------- */

await check('config: garbage values are clamped to safe defaults', () => {
  const config = normalizeConfig({
    captchaMaxAttempts: 'garbage',
    timeoutMs: -1,
    maxPageSize: 999,
    detailConcurrency: 0,
    includeDetails: 'no',
  });
  assert(config.captchaMaxAttempts === 5, `attempts=${config.captchaMaxAttempts}`);
  assert(config.timeoutMs === 5000, `timeout=${config.timeoutMs}`);
  assert(config.maxPageSize === 26, `pageSize=${config.maxPageSize}`);
  assert(config.detailConcurrency === 1, `concurrency=${config.detailConcurrency}`);
  assert(config.includeDetails === true, 'includeDetails');
});

await check('catalog: unordered/odd config still renders all eight types', () => {
  const snapshot = typesSnapshot(normalizeConfig({ maxPageSize: 1 }));
  assert(snapshot.count === 8, `count=${snapshot.count}`);
  const text = renderTypes(snapshot);
  for (const type of ['web', 'app', 'mapp', 'kapp', 'bweb', 'bapp', 'bmapp', 'bkapp']) {
    assert(text.includes(type), `missing ${type}`);
  }
});

/* ---------------------------------------------------------------- */
/* Summary                                                            */
/* ---------------------------------------------------------------- */

await delay(20);
if (unhandled.length > 0) {
  results.push({ label: 'no unhandled rejections', ok: false, error: new Error(`${unhandled.length} unhandled rejection(s)`) });
  console.log(`FAIL no unhandled rejections -> ${unhandled.map((reason) => String(reason)).join('; ')}`);
} else {
  results.push({ label: 'no unhandled rejections', ok: true });
  console.log('PASS no unhandled rejections');
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} stability checks passed`);
if (failed.length > 0) {
  for (const entry of failed) console.log(`  - ${entry.label}: ${entry.error instanceof Error ? entry.error.message : String(entry.error)}`);
  process.exitCode = 1;
}
