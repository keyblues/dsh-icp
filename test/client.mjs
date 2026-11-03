// Offline card test for the dsh-icp Client half — no browser, no DSH.
//
// Loads client.js in a VM with a tiny React stub, runs `apply()` against a
// stub slot registry, then shallow-renders both cards in the settled state and
// asserts the visible text. Catches syntax/runtime regressions in the card
// before a page refresh is needed.
//
//   node dsh-icp/test/client.mjs
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const failures = [];
function check(label, condition, detail = '') {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures.push(label);
    console.log(`FAIL ${label}${detail === '' ? '' : ` (${detail})`}`);
  }
}

/* ---------------------------------------------------------------- */
/* Tiny React stub: enough to run the component as a shallow render. */
/* ---------------------------------------------------------------- */

let forceExpanded = true;
const ReactStub = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.filter((child) => child !== null && child !== undefined) };
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}];
  },
  useMemo(factory) {
    return factory();
  },
  useRef(value) {
    return { current: value ?? null };
  },
  useEffect() {},
  useCallback(fn) {
    return fn;
  },
  Fragment: 'Fragment',
};

/** Collect all visible text out of a shallow element tree. */
function textOf(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((child) => textOf(child)).join('');
  if (typeof node !== 'object') return '';
  if (typeof node.type === 'function') return textOf(node.type(node.props));
  return textOf(node.children);
}

/* ---------------------------------------------------------------- */
/* Load the module factory and apply it to a stub Client context.     */
/* ---------------------------------------------------------------- */

const registered = [];
const effects = [];
const dictionaries = [];
const styles = [];
let loaded = null;

const documentStub = {
  documentElement: { lang: 'zh-CN' },
  createElement(tag) {
    const node = { tag, dataset: {}, textContent: '', removed: false, remove() { node.removed = true; } };
    return node;
  },
  head: {
    appendChild(node) {
      styles.push(node);
    },
  },
};

const ctx = {
  locale: {
    bind: () => () => undefined,
    register(namespace, dicts) {
      dictionaries.push({ namespace, dicts });
      return () => {};
    },
  },
  slots: {
    inject(key, callback) {
      callback();
      return () => {};
    },
    register(options, component) {
      registered.push({ options, component });
      return () => {};
    },
  },
  effect(factory, label) {
    const dispose = factory();
    effects.push({ label, dispose });
    return dispose;
  },
};

runInNewContext(source, {
  window: {
    __ModuleLoader__: {
      load(module) {
        loaded = module;
      },
    },
  },
  document: documentStub,
  navigator: { language: 'zh-CN' },
});

check('client module registers itself', loaded !== null && loaded.id === '@local/dsh-icp');
const plugin = loaded === null ? null : loaded.factory((name) => {
  if (name === 'react') return ReactStub;
  throw new Error(`unexpected module: ${name}`);
});
check('client exports inject/apply', plugin !== null && typeof plugin.apply === 'function' && plugin.inject.includes('slots'));
plugin?.apply(ctx);

const keys = registered.map((entry) => entry.options.key).sort();
check('registers both tool cards', JSON.stringify(keys) === JSON.stringify(['icp_query', 'icp_query_types']), JSON.stringify(keys));
check('registers dictionaries and stylesheet', dictionaries.length === 1 && styles.length === 1);
check('card is a component function', registered.every((entry) => typeof entry.component === 'function'));

/* ---------------------------------------------------------------- */
/* Shallow-render the settled query card.                             */
/* ---------------------------------------------------------------- */

const queryCard = registered.find((entry) => entry.options.key === 'icp_query');
const typesCard = registered.find((entry) => entry.options.key === 'icp_query_types');

const queryBlock = {
  kind: 'result',
  isError: false,
  content: [{ type: 'text', text: 'ICP 备案 · 网站备案（web）· baidu.com' }],
  meta: {
    kind: 'icp',
    type: 'web',
    label: '网站备案',
    search: 'baidu.com',
    pageNum: 1,
    pageSize: 3,
    total: 1,
    pages: 1,
    hasNextPage: false,
    rowCount: 1,
    detailsFetched: false,
    elapsedMs: 459,
    blacklist: false,
    rows: [
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
const queryProps = {
  phase: 'result',
  toolName: 'icp_query',
  block: queryBlock,
  useDisclosure: () => ({ expanded: forceExpanded, toggle() {} }),
};
const queryText = textOf(queryCard.component(queryProps));
check('query card title', queryText.includes('ICP 备案查询'));
check('query card head summary', queryText.includes('网站备案') && queryText.includes('baidu.com'));
check('query card head suffix', queryText.includes('1 条') && queryText.includes('459'));
check('query card row', queryText.includes('北京百度网讯科技有限公司') && queryText.includes('京ICP证030173号'));
check('query card paging', queryText.includes('第 1 / 1 页'));

// Collapsed: head only, no body rows.
forceExpanded = false;
const collapsedText = textOf(queryCard.component({ ...queryProps, useDisclosure: () => ({ expanded: false }) }));
check('collapsed card hides body', !collapsedText.includes('北京百度网讯科技有限公司') && collapsedText.includes('baidu.com'));
forceExpanded = true;

// Blacklist shape.
const blackBlock = {
  kind: 'result',
  isError: false,
  content: [{ type: 'text', text: 'ICP 备案 · 违法违规网站（bweb）· tencent.com' }],
  meta: {
    kind: 'icp',
    type: 'bweb',
    label: '违法违规网站',
    search: 'tencent.com',
    pageNum: 1,
    pageSize: 0,
    total: 1,
    pages: 1,
    hasNextPage: false,
    rowCount: 1,
    detailsFetched: false,
    elapsedMs: 301,
    blacklist: true,
    rows: [{ domainName: 'tencent.com', blackListLevel: 2 }],
    message: 'blackListLevel=2：该域名/应用暂无违法违规信息。',
  },
};
const blackText = textOf(queryCard.component({ phase: 'result', toolName: 'icp_query', block: blackBlock, useDisclosure: () => ({ expanded: true, toggle() {} }) }));
check('blacklist card keeps level', blackText.includes('威胁等级') && blackText.includes('tencent.com'));

// Pending state: no meta yet.
const pendingText = textOf(
  queryCard.component({
    phase: 'start',
    toolName: 'icp_query',
    block: { argsRaw: '{"type":"web","search":"baidu.com"}' },
    useDisclosure: () => ({ expanded: false, toggle() {} }),
  }),
);
check('pending card shows the request', pendingText.includes('web · baidu.com'));

// Error state.
const failedText = textOf(
  queryCard.component({
    phase: 'result',
    toolName: 'icp_query',
    block: { kind: 'result', isError: true, content: [{ type: 'text', text: 'Error: 出口 IP 已被创宇盾临时拦截' }], error: { code: 'tool_error' } },
    useDisclosure: () => ({ expanded: true, toggle() {} }),
  }),
);
check('error card shows the failure', failedText.includes('创宇盾'));

/* ---------------------------------------------------------------- */
/* Types card.                                                        */
/* ---------------------------------------------------------------- */

const typesText = textOf(
  typesCard.component({
    phase: 'result',
    toolName: 'icp_query_types',
    block: {
      kind: 'result',
      isError: false,
      content: [{ type: 'text', text: 'ICP 类型目录' }],
      meta: {
        kind: 'icp-types',
        count: 2,
        endpoint: 'https://hlwicpfwc.miit.gov.cn/icpproject_query/api',
        note: '官方接口说明',
        config: { captcha_max_attempts: 5, timeout_ms: 30000, max_page_size: 10, include_details: true },
        types: [
          { type: 'web', label: '网站备案', blacklist: false, paginated: true, search_hint: '域名' },
          { type: 'bweb', label: '违法违规网站', blacklist: true, paginated: false, search_hint: '域名' },
        ],
      },
    },
    useDisclosure: () => ({ expanded: true, toggle() {} }),
  }),
);
check('types card lists types', typesText.includes('web') && typesText.includes('网站备案') && typesText.includes('bweb'));
check('types card shows config', typesText.includes('验证码尝试') && typesText.includes('30000 ms') && typesText.includes('详情并发'));

/* ---------------------------------------------------------------- */
/* Legacy and malformed metadata must render safely.                 */
/* ---------------------------------------------------------------- */

const legacyText = textOf(
  queryCard.component({
    phase: 'result',
    toolName: 'icp_query',
    block: {
      kind: 'result',
      isError: false,
      content: [{ type: 'text', text: 'ICP 备案 · 网站备案（web）· baidu.com\n1. baidu.com | 主办单位=北京百度网讯科技有限公司' }],
      meta: { kind: 'icp', type: 'web', label: '网站备案', search: 'baidu.com', total: 1, rowCount: 1 },
    },
    useDisclosure: () => ({ expanded: true, toggle() {} }),
  }),
);
check(
  'legacy meta falls back to the text body',
  legacyText.includes('北京百度网讯科技有限公司') && !legacyText.includes('未查询到备案记录'),
);

const malformedText = textOf(
  queryCard.component({
    phase: 'result',
    toolName: 'icp_query',
    block: {
      kind: 'result',
      isError: false,
      content: [{ type: 'text', text: 'x' }],
      meta: { kind: 'icp', type: 'web', label: '网站备案', search: 'x', pageSize: 3, total: 1, rowCount: 1, rows: [null, 'x', 42] },
    },
    useDisclosure: () => ({ expanded: true, toggle() {} }),
  }),
);
check('malformed meta rows do not throw', malformedText.includes('ICP 备案查询'));

const headOnlyText = textOf(
  queryCard.component({
    phase: 'result',
    toolName: 'icp_query',
    block: queryBlock,
    useDisclosure: () => ({ expanded: false, toggle() {} }),
  }),
);
check('record count is localized through the dictionary', headOnlyText.includes('1 条'));

/* ---------------------------------------------------------------- */
/* Dispose must remove everything.                                    */
/* ---------------------------------------------------------------- */

for (const effect of effects.reverse()) effect.dispose();
check(
  'dispose removes the stylesheet',
  styles.length === 1 && styles.every((node) => node.removed === true),
  `tags=${styles.length} removed=${styles.filter((node) => node.removed === true).length}`,
);

if (failures.length > 0) {
  console.log(`\n${failures.length} client check(s) failed: ${failures.join('; ')}`);
  process.exitCode = 1;
} else {
  console.log('\nall client checks passed');
}
