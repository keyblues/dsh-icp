// Manual contract test for the dsh-icp plugin — no network, no DSH required.
//
// Runs the real Cordis entry point against a stub context, then exercises both
// tool definitions: registration, argument validation and text rendering.
//
//   node dsh-icp/test/contract.mjs
import { apply, inject, name } from '../index.js';

const registered = [];
const effects = [];
const ctx = {
  tools: {
    register(definition) {
      registered.push(definition);
      return () => {
        const index = registered.indexOf(definition);
        if (index >= 0) registered.splice(index, 1);
      };
    },
  },
  effect(factory, label) {
    const dispose = factory();
    effects.push({ label, dispose });
    return dispose;
  },
};

const failures = [];
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`PASS ${label}`);
  } else {
    failures.push(`${label}${detail === '' ? '' : ` (${detail})`}`);
    console.log(`FAIL ${label}${detail === '' ? '' : ` (${detail})`}`);
  }
}

console.log(`plugin name=${name} inject=${JSON.stringify(inject)}`);
apply(ctx, { captchaMaxAttempts: 3, timeoutMs: 30000, maxPageSize: 5, detailConcurrency: 2, includeDetails: true });

const queryTool = registered.find((tool) => tool.name === 'icp_query');
const typesTool = registered.find((tool) => tool.name === 'icp_query_types');
check('registers icp_query', queryTool !== undefined);
check('registers icp_query_types', typesTool !== undefined);
check('icp_query is not concurrency safe', queryTool?.isConcurrencySafe?.() === false);
check('icp_query_types is concurrency safe', typesTool?.isConcurrencySafe?.() === true);
check('icp_query requires type+search', JSON.stringify(queryTool?.parameters?.required) === '["type","search"]');
check(
  'icp_query enum has 8 types',
  queryTool?.parameters?.properties?.type?.enum?.length === 8,
  String(queryTool?.parameters?.properties?.type?.enum?.length),
);
check(
  'page_num is 1-based',
  String(queryTool?.parameters?.properties?.page_num?.description ?? '').includes('从 1 开始'),
);
check(
  'page_size documents the default',
  String(queryTool?.parameters?.properties?.page_size?.description ?? '').includes('默认 10'),
);

const types = await typesTool.execute({}, { signal: new AbortController().signal });
check('types count is 8', types.count === 8, String(types.count));
const typesText = typesTool.output.render({}, types)[0].text;
check('types text lists every type', types.types.every((item) => typesText.includes(item.type)));
check('types text shows effective config', typesText.includes('当前生效配置') && typesText.includes('验证码最多尝试'));
check('types note states no API key', typeof types.note === 'string' && types.note.includes('API Key'));
check(
  'query description states the purpose',
  ['工信部', 'ICP', '备案'].every((word) => String(queryTool.description).includes(word)),
);
check('query description stays short', String(queryTool.description).length < 400, `${String(queryTool.description).length} chars`);

for (const [args, expected] of [
  [{ type: 'nope', search: 'x' }, '不支持的 type'],
  [{ type: 'web', search: '  ' }, 'search 不能为空'],
]) {
  try {
    await queryTool.execute(args, { signal: new AbortController().signal });
    check(`rejects ${JSON.stringify(args)}`, false, 'no error thrown');
  } catch (error) {
    check(`rejects ${JSON.stringify(args)}`, String(error.message).includes(expected), error.message);
  }
}

// Render a synthetic paginated result through the real renderer.
const sample = {
  type: 'web',
  label: '网站备案',
  search: 'baidu.com',
  pageNum: 2,
  pageSize: 3,
  total: 1702,
  pages: 568,
  hasNextPage: true,
  rowCount: 1,
  rows: [{ domain: 'baidu.com', unitName: '北京百度网讯科技有限公司', mainLicence: '京ICP证030173号' }],
  detailsFetched: false,
  elapsedMs: 372,
};
const sampleText = queryTool.output.render({}, sample)[0].text;
check('render shows pagination', sampleText.includes('568 页') && sampleText.includes('下一页：page_num=3'));
check('render shows row fields', sampleText.includes('北京百度网讯科技有限公司'));

const meta = queryTool.output.presentationMeta({}, sample);
check('meta carries the card facts', meta.kind === 'icp' && meta.type === 'web' && meta.total === 1702);
check('meta keeps compact rows', Array.isArray(meta.rows) && meta.rows.length === 1 && meta.rows[0].unitName === '北京百度网讯科技有限公司');
check('meta drops verbose ids', meta.rows[0].domainId === undefined);

const typesMeta = typesTool.output.presentationMeta({}, types);
check('types meta carries the catalog', typesMeta.kind === 'icp-types' && typesMeta.count === 8 && Array.isArray(typesMeta.types));

for (const effect of effects.reverse()) effect.dispose();
check('dispose unregisters tools', registered.length === 0, String(registered.length));

if (failures.length > 0) {
  console.log(`\n${failures.length} contract check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\nall contract checks passed');
}
