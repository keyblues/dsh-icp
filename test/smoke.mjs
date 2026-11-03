// Manual live smoke test for the dsh-icp plugin — talks to the real MIIT
// service and solves one slider captcha per query. Run it sparingly: the
// upstream service is rate-limited by 创宇盾 and every call costs one captcha.
//
//   node dsh-icp/test/smoke.mjs            # all 8 types + pagination
//   node dsh-icp/test/smoke.mjs web app    # only the listed types
import { IcpClient, IcpError } from '../lib/miit.js';
import { normalizeConfig, renderQuery, renderTypes, typesSnapshot } from '../index.js';

const config = normalizeConfig({});
const client = new IcpClient(config);

/** One realistic query per type. */
const CASES = [
  ['web', 'baidu.com', 1, 3],
  ['app', '微信', 1, 3],
  ['mapp', '美团', 1, 3],
  ['kapp', '支付宝', 1, 3],
  ['bweb', 'tencent.com', 1, 0],
  ['bapp', '微信', 1, 0],
  ['bmapp', '微信', 1, 0],
  ['bkapp', '微信', 1, 0],
  ['web', '深圳市腾讯计算机系统有限公司', 2, 3],
];

const selected = new Set(process.argv.slice(2));
const cases = selected.size === 0 ? CASES : CASES.filter(([type]) => selected.has(type));

console.log('ICP 类型目录：');
console.log(renderTypes(typesSnapshot(config)));
console.log('');

let failed = 0;
for (const [type, search, pageNum, pageSize] of cases) {
  try {
    const value = await client.query({ type, search, pageNum, pageSize });
    console.log(`OK   ${type}/${search} rows=${value.rowCount} total=${value.total} ${value.elapsedMs}ms`);
    if (value.hasNextPage) console.log('     还有下一页');
    if (type === 'web' && search === 'baidu.com') console.log(renderQuery(value));
    // Space the calls out to stay well clear of the upstream rate limit.
    await new Promise((resolve) => setTimeout(resolve, 1200));
  } catch (error) {
    failed += 1;
    const message = error instanceof IcpError ? `${error.code}: ${error.message}` : String(error);
    console.log(`FAIL ${type}/${search}: ${message}`);
    if (error instanceof IcpError && error.code === 'BLOCKED') {
      console.log('出口 IP 被创宇盾拦截，停止测试。');
      break;
    }
  }
}

console.log(`\n${cases.length - failed}/${cases.length} 次实查通过`);
process.exitCode = failed === 0 ? 0 : 1;
