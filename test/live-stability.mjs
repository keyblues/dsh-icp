// Manual live stability probe for the real MIIT endpoint. Low frequency by
// design: every call costs one official request and the service is rate-limited.
//
//   node dsh-icp/test/live-stability.mjs
//
// It covers the four normal types, the blacklist shape, pagination edges
// (page beyond the last page, page_size above the configured cap) and a
// no-result keyword, and reports elapsed times plus the session-reuse ratio.
import { IcpClient, IcpError } from '../lib/miit.js';
import { apply, normalizeConfig, renderQuery, typesSnapshot, renderTypes } from '../index.js';

const GAP_MS = 1500;
const config = normalizeConfig({});
const client = new IcpClient(config);

/** Register the real tools against a stub context so `execute()` is exercised. */
const registered = [];
apply(
  {
    tools: {
      register(definition) {
        registered.push(definition);
        return () => {};
      },
    },
    effect(factory) {
      return factory();
    },
  },
  {},
);
const queryTool = registered.find((tool) => tool.name === 'icp_query');
if (queryTool === undefined) throw new Error('icp_query was not registered');

const results = [];
function record(label, ok, detail) {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail === '' ? '' : ` — ${detail}`}`);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function live(label, request, verify) {
  try {
    const value = await client.query(request);
    const detail = `rows=${value.rowCount} total=${value.total} ${value.elapsedMs}ms pageSize=${value.pageSize}`;
    const problem = verify === undefined ? null : verify(value);
    record(label, problem === null, problem === null ? detail : `${detail} | ${problem}`);
    return value;
  } catch (error) {
    const message = error instanceof IcpError ? `${error.code}: ${error.message}` : String(error);
    record(label, false, message);
    if (error instanceof IcpError && error.code === 'BLOCKED') throw error;
    return null;
  } finally {
    await delay(GAP_MS);
  }
}

console.log('实时稳定性探测（低频；每次调用会消耗官方请求与滑块验证码）');
try {
  const catalog = typesSnapshot(config);
  const catalogText = renderTypes(catalog);
  record(
    'icp_query_types',
    catalog.count === 8 && catalogText.includes('当前生效配置'),
    `count=${catalog.count} config-line=${catalogText.includes('当前生效配置')}`,
  );

  await live('web / baidu.com', { type: 'web', search: 'baidu.com', pageNum: 1, pageSize: 3 }, (value) => {
    if (value.rowCount !== 1) return `rowCount=${value.rowCount}`;
    if (!value.rows[0].unitName) return 'missing unitName';
    return null;
  });

  await live('app / 微信（详情补全）', { type: 'app', search: '微信', pageNum: 1, pageSize: 2 }, (value) => {
    if (value.rowCount < 1) return 'no rows';
    if (value.detailsFetched !== true) return 'details not merged';
    return null;
  });

  await live('mapp / 美团', { type: 'mapp', search: '美团', pageNum: 1, pageSize: 2 }, (value) => {
    if (value.rowCount < 1) return 'no rows';
    return null;
  });

  await live('kapp / 支付宝', { type: 'kapp', search: '支付宝', pageNum: 1, pageSize: 2 }, (value) => {
    if (value.rowCount < 1) return 'no rows';
    return null;
  });

  const blacklist = await live('bweb / tencent.com（不分页）', { type: 'bweb', search: 'tencent.com' }, (value) => {
    if (value.pageSize !== 0) return `pageSize=${value.pageSize}`;
    if (value.rowCount > 1) return `rowCount=${value.rowCount}`;
    if (value.rows.length > 0 && String(value.rows[0].blackListLevel ?? '') === '') return 'missing blackListLevel';
    return null;
  });
  if (blacklist !== null) {
    const text = renderQuery(blacklist);
    record('bweb 渲染包含威胁等级说明', /威胁等级|blackListLevel/.test(text), text.split('\n')[2] ?? '');
  }

  await live(
    '分页越界：page_num=99999',
    { type: 'web', search: '深圳市腾讯计算机系统有限公司', pageNum: 99999, pageSize: 3 },
    (value) => {
      if (value.rowCount !== 0) return `expected empty page, rowCount=${value.rowCount}`;
      if (value.total < 1000) return `unexpected total=${value.total}`;
      if (value.hasNextPage !== false) return 'hasNextPage should be false';
      return null;
    },
  );

  // The cap lives in the tool layer (`execute` clamps page_size), so this one
  // goes through the registered tool rather than the raw client.
  try {
    const value = await queryTool.execute(
      { type: 'web', search: '深圳市腾讯计算机系统有限公司', page_num: 1, page_size: 99 },
      { signal: new AbortController().signal },
    );
    const problem =
      value.pageSize > config.maxPageSize
        ? `pageSize=${value.pageSize} > ${config.maxPageSize}`
        : value.rowCount > config.maxPageSize
          ? `rowCount=${value.rowCount} > ${config.maxPageSize}`
          : null;
    record('page_size 超上限：99 → 截断到 maxPageSize', problem === null, `rows=${value.rowCount} pageSize=${value.pageSize} ${value.elapsedMs}ms`);
  } catch (error) {
    const message = error instanceof IcpError ? `${error.code}: ${error.message}` : String(error);
    record('page_size 超上限：99 → 截断到 maxPageSize', false, message);
  } finally {
    await delay(GAP_MS);
  }

  await live('无结果关键词', { type: 'web', search: 'dsh-icp-stability-probe-000000.example' }, (value) => {
    if (value.rowCount !== 0) return `rowCount=${value.rowCount}`;
    if (!renderQuery(value).includes('未查询到备案记录')) return 'render missing empty-state text';
    return null;
  });
} catch (error) {
  console.log(`\n中止：${error instanceof Error ? error.message : String(error)}`);
}

const failed = results.filter((entry) => !entry.ok);
const fast = results.filter((entry) => entry.ok && /\d+ms/.test(entry.detail));
const times = fast.map((entry) => Number(/(\d+)ms/.exec(entry.detail)[1]));
console.log(`\n${results.length - failed.length}/${results.length} 实时探测通过`);
if (times.length > 0) {
  console.log(`首次(含解滑块) ≈ ${times[0]} ms；后续 ≈ ${times.slice(1).join(' / ')} ms`);
}
process.exitCode = failed.length === 0 ? 0 : 1;
