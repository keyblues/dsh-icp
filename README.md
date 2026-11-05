# ICP 备案查询 · DSH 插件

[![npm version](https://img.shields.io/npm/v/dsh-icp-query?style=flat-square)](https://www.npmjs.com/package/dsh-icp-query)
[![npm downloads](https://img.shields.io/npm/dw/dsh-icp-query?style=flat-square)](https://www.npmjs.com/package/dsh-icp-query)
[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-4c6ef5?style=flat-square)](#)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek-Harness-5b6bff?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square)](package.json)
[![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.3%2B-4D6BFE?style=flat-square)](#兼容性)
[![GitHub stars](https://img.shields.io/github/stars/keyblues/dsh-icp?style=flat-square)](https://github.com/keyblues/dsh-icp/stargazers)

> **English** — MIIT ICP filing lookup for DeepSeek Harness (DSH). The plugin queries the official MIIT filing service directly: it obtains an anonymous auth token and solves the slider captcha locally, with no API key, no external service and zero npm dependencies. It registers two agent tools, `icp_query` (websites, apps, mini programs, quick apps and the four violation blacklists) and `icp_query_types`; results render as official-style conversation cards.

工信部 ICP 备案查询的 DSH 插件。Agent 可直接调用 `icp_query` 查询网站、APP、小程序、快应用的备案记录及四类违法违规黑名单，用 `icp_query_types` 查看类型目录与当前生效配置。插件直接完成认证与本地滑块求解，不需要 API Key、外部服务或第三方数据商。

- 数据来源：工信部政务服务平台官方查询接口 `https://hlwicpfwc.miit.gov.cn/icpproject_query/api`
- 平台：macOS / Windows / Linux（纯 JS）
- 仓库：<https://github.com/keyblues/dsh-icp> · npm：<https://www.npmjs.com/package/dsh-icp-query> · 关键词：`dsh-plugin` `deepseek-harness` `icp` `miit` `备案查询`

## 特性

- **直连官方接口**：`https://hlwicpfwc.miit.gov.cn/icpproject_query/api`，实时查询，无中转、无第三方数据商。
- **一个 `search` 字段**：域名、主办单位名称、备案号、应用名称都可以直接填。
- **四类备案 + 四类黑名单**：网站 / APP / 小程序 / 快应用，以及对应的违法违规名单。
- **分页查询**：`web` / `app` / `mapp` / `kapp` 支持 `page_num` / `page_size`；黑名单不分页。
- **应用详情补全**：APP / 小程序 / 快应用逐条调用官方详情接口；可用 `includeDetails: false` 关闭。
- **本地求解滑块**：解码 PNG 并定位缺口，无需人工；验证码会话在有效期内复用，实测首查约 1 秒、后续约 0.2–0.4 秒。
- **精简的模型输出**：一行一条记录、字段截断，并提示下一页，避免大结果占满上下文。
- **对话工具卡片**：官方样式卡片。`icp_query` 折叠头显示类型 / 关键词 / 条数 / 耗时，展开显示分页与备案记录；`icp_query_types` 折叠头显示类型数量，展开显示类型目录与当前生效配置。
- **零依赖、零构建**：Host 侧只用 Node 内置模块，无 npm 依赖、无构建步骤；Client 半复用宿主提供的 React。

## 安装

### 从 npm 安装（推荐）

已发布到 npm：[`dsh-icp-query`](https://www.npmjs.com/package/dsh-icp-query)。

```text
plugin_manager(action: "install_bundle", target: "dsh-icp-query")
```

### 从 GitHub 安装

打开 DSH 侧边栏「插件」页，依次点「添加插件」→「安装第三方插件」，在「包名或地址」填 `https://github.com/keyblues/dsh-icp`；安装完成后 `icp_query` / `icp_query_types` 自动注册。也可以让 Agent 代劳：

```text
plugin_manager(action: "install_bundle", target: "github:keyblues/dsh-icp")
```

### 本地 clone / 离线安装

```bash
git clone https://github.com/keyblues/dsh-icp.git
```

然后用绝对路径安装本地目录（`link:` 方式，不打包、不下载）：

```text
plugin_manager(action: "install_bundle", target: "<clone 目录的绝对路径>")
```

`git pull` 会更新代码，但已加载的 Host 模块需要重新加载。

### 安装后、更新与卸载

- bundle 行 id 为 `dsh-icp`；npm 包名、Host 模块名与 Client 模块 id 为 `dsh-icp-query`；版本 `2.0.1`。
- 首次安装、升级或修改 `client.js` 后，对话卡片需要刷新一次浏览器页面；Host 工具无需刷新。
- 修改 `index.js` / `lib/**` 后不会自动重载：在「插件」页把 bundle 行 `dsh-icp` **禁用再启用**，或重启 DSH。
- 卸载：在「插件」页移除，或 `plugin_manager(action: "remove_bundle", target: "dsh-icp-query")`；本地 clone 目录不会被删除。

## 兼容性

| 项 | 要求 |
|---|---|
| Node.js | `>= 20` |
| DSH | `>= 0.2.1-rc.3 < 0.3.0-0`（见 `package.json` 的 `engines.dsh`） |
| 平台 | macOS / Windows / Linux（纯 JS，无编译产物） |
| 网络 | 需能直连 `hlwicpfwc.miit.gov.cn`（HTTPS） |
| 凭据 | 无（匿名令牌仅保存在进程内存中） |

## 工具参考

### `icp_query`

查询工信部 ICP 备案。支持网站、APP、小程序、快应用四类备案，以及对应的四类违法违规黑名单；返回备案主体、备案号、审核时间与应用详情等记录。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | string（枚举） | 是 | 查询类型：web 网站备案、app APP 备案、mapp 小程序备案、kapp 快应用备案、bweb 违法违规网站、bapp 违法违规 APP、bmapp 违法违规小程序、bkapp 违法违规快应用。 |
| `search` | string | 是 | 域名、主办单位名称、备案号或应用名称。 |
| `page_num` | integer | 否 | 页码，从 1 开始，最大 10000；黑名单类型忽略。 |
| `page_size` | integer | 否 | 每页条数，默认 10，上限为插件配置的 `maxPageSize`（默认 10，最大 26）；黑名单类型忽略。 |

返回字段（工具输出 schema）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` / `label` | string | 查询类型 key 与中文名 |
| `search` | string | 实际使用的关键词（已 trim） |
| `pageNum` / `pageSize` | integer | 实际生效的页码与每页条数；黑名单类型 `pageSize=0` |
| `total` / `pages` | integer | 总条数 / 总页数（黑名单为 1 或 0） |
| `hasNextPage` | boolean | 是否还有下一页；由官方返回的 `pageNum` / `pages` 推导（官方原字段恒为 `false`，不可直接用） |
| `rowCount` | integer | 本页记录数（黑名单为 0 或 1） |
| `rows` | array | 备案记录。常见字段：`domain` / `domainName` 域名、`unitName` 主办单位、`mainLicence` 主体备案号、`serviceLicence` 服务备案号、`updateRecordTime` 审核时间、`serviceName` 服务名称、`natureName` 单位性质、`title` 标题、`blackListLevel` 黑名单等级 |
| `detailsFetched` | boolean | 是否成功补全 APP / 小程序 / 快应用详情 |
| `elapsedMs` | integer | 本次查询耗时（毫秒） |
| `message` | string（可选） | 说明信息，如无记录提示或黑名单等级解释 |

### `icp_query_types`

无参数（`{}`）。列出 ICP 备案查询支持的类型、各类型 search 可填内容与当前生效配置；不确定该用哪种类型时先调用本工具。

| 字段 | 类型 | 说明 |
|---|---|---|
| `count` | integer | 类型数量（固定 8） |
| `types` | array | 每项含 `type`、`label`、`blacklist`、`paginated`、`service_type`、`search_hint` |
| `endpoint` | string | 官方接口基地址 |
| `note` | string | 使用提示，当前为“直连工信部官方接口，无需 API Key。官方限制访问频率，请勿并发或高频调用。” |
| `config` | object | 当前生效配置（`captcha_max_attempts`、`timeout_ms`、`max_page_size`、`detail_concurrency`、`include_details`） |

## 查询类型

| `type` | 中文 | 上游 `serviceType` | `search` 可填 | 分页 |
|---|---|---|---|---|
| `web` | 网站备案 | 1 | 域名 / 主办单位名称 / 备案号 | 支持 |
| `app` | APP 备案 | 6 | APP 名称 / 主办单位名称 / 备案号 | 支持（自动补详情） |
| `mapp` | 小程序备案 | 7 | 小程序名称 / 主办单位名称 / 备案号 | 支持（自动补详情） |
| `kapp` | 快应用备案 | 8 | 快应用名称 / 主办单位名称 / 备案号 | 支持（自动补详情） |
| `bweb` | 违法违规网站 | — | 域名 | 不支持（单条记录） |
| `bapp` | 违法违规 APP | 6 | APP 名称 | 不支持（单条记录） |
| `bmapp` | 违法违规小程序 | 7 | 小程序名称 | 不支持（单条记录） |
| `bkapp` | 违法违规快应用 | 8 | 快应用名称 | 不支持（单条记录） |

四类黑名单分别请求 `blackListDomain/queryByCondition`（网站）与 `blackListDomain/queryByCondition_appAndMini`（APP / 小程序 / 快应用），均不分页、返回单条记录。`blackListLevel=2` 表示暂无违法违规信息；其它等级的含义以官方返回为准。

## 配置项

配置来自 bundle 的 `cordis.patch.yml` 中 `- id: dsh-icp` 行；也可以在本 profile 的 `cordis.patch.yml` 里按同名 id 覆盖 `config`，例如 `timeoutMs: 45000`、`includeDetails: false`。本插件没有设置页，修改后需重载 bundle 行或重启 DSH。

| 配置项 | 类型 | 默认 | 范围 | 作用 |
|---|---|---|---|---|
| `captchaMaxAttempts` | integer | `5` | 1–10 | 单次查询内滑块验证码的最大尝试次数（每次尝试重新取图） |
| `timeoutMs` | integer | `30000` | 5000–120000 | 单次上游 HTTP 请求超时（毫秒） |
| `maxPageSize` | integer | `10` | 1–26 | 每页条数上限；`page_size` 超过该值会被截断（官方上限 26） |
| `detailConcurrency` | integer | `5` | 1–10 | 并发拉取 APP / 小程序 / 快应用详情的数量 |
| `includeDetails` | boolean | `true` | `true` / `false` | 是否补全 APP / 小程序 / 快应用详情；关闭后更快，只返回列表字段 |

非法值会回退默认值或截断到范围内。

## 对话卡片

`client.js` 是 bundle 的 Client 半，向 `tool.call.toolview` 槽位注册两个按工具名分发的官方样式卡片：`icp_query` 的折叠头显示类型 / 关键词 / 条数与耗时，展开体显示分页与备案记录；`icp_query_types` 的折叠头只显示类型数量，展开体显示类型目录与当前生效配置。运行中、失败、被用户停止各有对应状态。卡片从 Host 写入的 `output.presentationMeta` 重绘，结果被 spill 或会话 fork 后仍能显示；旧结果没有卡片元数据时回退到文本输出。

> 修改 `client.js` 后需要刷新一次浏览器页面；卡片没有设置页，配置仍来自 profile 的 `cordis.patch.yml`。

## 实现与上游协议

一次 `icp_query` 的流程（与公开项目 HG-ha/ICP_Query 一致）：

1. **认证** —— `POST /auth`，请求体为 `authKey = md5("testtest" + timeStamp)` 与 `timeStamp`；响应 `params.bussiness` 为业务令牌，`params.expire` 为有效期。
2. **取验证码** —— `POST /image/getCheckImagePoint`，携带业务令牌；返回 `uuid`、背景图 `bigImage` 与拼图块 `smallImage`（base64 PNG）。
3. **本地求解** —— `lib/png.js` 解码图片，`lib/slider.js` 在背景图中定位缺口，得到水平偏移量 `offsetX`。
4. **校验滑块** —— `POST /image/checkImage`，提交 `{ key: uuid, value: offsetX }`；通过后返回该验证码会话的 `sign`。
5. **查询** —— `POST /icpAbbreviateInfo/queryByCondition`，请求头带 `token` / `uuid` / `sign`，请求体 `{ pageNum, pageSize, unitName: search, serviceType }`；响应 `params.list` 为记录，`params.total` / `pages` 为分页信息。
6. **补详情** —— APP / 小程序 / 快应用逐条调用 `POST /icpAbbreviateInfo/queryDetailByAppAndMiniId`（`{ dataId, serviceType }`），并发受 `detailConcurrency` 限制；非阻断性的单条详情失败只降级为缺少详情，WAF 拦截或取消会中止。

违法违规黑名单走同样的认证与验证码流程，然后请求 `blackListDomain/queryByCondition`（`{ domainName }`）或 `blackListDomain/queryByCondition_appAndMini`（`{ serviceName, serviceType }`），不分页。

重试与会话复用：

- 业务令牌缓存在进程内，过期前 5 秒刷新；并发查询共用同一次 `/auth`；滑块定位或校验失败会重新取图，单次查询最多 `captchaMaxAttempts` 次。
- `sign` 验证码会话在有效期内复用（最多 3 分钟）；被 401 拒绝时作废并重解一次。
- 因此首次查询约 1 秒，后续查询约 0.2–0.4 秒（实测）。

本项目参考公开项目 [HG-ha/ICP_Query](https://github.com/HG-ha/ICP_Query) 的查询流程，用 Node 独立实现，不依赖其运行实例。上游接口未公开文档，协议来自对该项目的参考与实测。

> 本项目是非官方实现，与工信部及备案系统运营方无关联。官方调整接口、验证码或风控策略时，插件可能失效。

## 风险与限制

- **创宇盾 WAF 拦截**：出口 IP 被判定异常时，官方接口会返回“当前访问疑似黑客攻击”页面，插件抛出 `BLOCKED`。请等待一段时间或更换网络出口，不要连续重试。
- **关键词可能触发 WAF**：搜索词包含 `<script>` 等 HTML / 危险片段时可能被直接拦截，与查询内容本身无关；插件按错误返回，不自动重试。
- **大页码会被截断**：`page_num` 超过 10000 会截断为 10000；超出实际页数时返回 0 行（`total` 仍为真实总数），不会报错。
- **官方限频未知**：工信部未公布该匿名接口的频率配额；高频或并发查询可能被限流、拦截甚至临时封 IP。请保持低频、按需查询，不要批量扫描。
- **非官方协议**：接口文档未公开，协议参考公开项目并经过实测；官方调整接口、验证码或风控策略时插件可能失效，需要跟进修改。
- **数据仅供参考**：结果以工信部备案系统（<https://beian.miit.gov.cn/>）与官方解释为准；`rowCount=0` 只代表该关键词在官方接口下未命中，不代表主体一定未备案。
- **无担保**：项目按 MIT 许可“as is”提供，作者不对查询结果的正确性、完整性、可用性及使用后果负责。
- **合规与隐私**：仅用于查询公开备案信息，请遵守法律法规与官方服务条款；插件不收集、不上传用户数据，业务令牌与验证码会话只保存在进程内存中。

## 本地开发与测试

仓库零依赖、无构建步骤，测试直接用 Node 运行，不需要安装依赖或启动 DSH。

```bash
npm test                        # 离线：contract + client + stability
node test/contract.mjs
node test/client.mjs
node --unhandled-rejections=strict test/stability.mjs
node test/smoke.mjs             # 实网：八类查询 + 分页
node test/live-stability.mjs    # 实网：约 9 次边界探测
```

三个离线套件不触网，可随时运行。两个实网脚本会真实调用工信部接口并求解滑块，受创宇盾限频影响，请低频运行；遇到 `BLOCKED` 会停止或提示稍后重试。

## 项目结构

| 文件 | 作用 |
|---|---|
| `package.json` | bundle 清单：npm 包名 `dsh-icp-query`、版本 2.0.1、`engines.dsh` 与客户端声明 |
| `index.js` | Host 半：注册两个工具、归一化配置、精简输出、写入卡片元数据 |
| `client.js` | Client 半：向 `tool.call.toolview` 注册两张官方样式卡片 |
| `cordis.patch.yml` | 插入 `- id: dsh-icp` 的 Host 行及默认 `config` |
| `locale/en.json` / `locale/zh.json` | 插件管理器显示的英文 / 中文标题与描述 |
| `icon.svg` | 插件图标（备案文件 + 放大镜，64×64 SVG） |
| `lib/miit.js` | 工信部协议客户端：认证、验证码、查询、详情与黑名单 |
| `lib/png.js` / `lib/slider.js` | 纯 JS PNG 解码与滑块缺口定位 |
| `test/contract.mjs` / `test/client.mjs` / `test/stability.mjs` | 离线契约、卡片渲染与故障注入套件 |
| `test/smoke.mjs` / `test/live-stability.mjs` | 实网冒烟与稳定性探测（低频） |
| `docs/verification.md` | 审查、离线测试与实网验证记录 |
| `README.md` | 本文档 |

## 常见问题

- **更新代码后没有生效？** Host 模块不会热重载；在「插件」页把 bundle 行 `dsh-icp` 禁用再启用，或重启 DSH。修改了 `client.js` 还需要刷新一次页面。
- **查询返回 `BLOCKED`？** 出口 IP 被创宇盾拦截；等待一段时间或更换网络出口，不要连续重试。

## 发布

发布由 GitHub Actions 在推送 `v*` tag 时执行（npm Trusted Publishing / provenance，仓库里不保存 npm token）。**确认发版后才打 tag**：

1. 按确认的版本更新 `package.json`（例如 `npm version patch`）；
2. 提交并推送：`git add -A && git commit -m "release: vX.Y.Z" && git push`；
3. 打并推送 tag：`git tag vX.Y.Z && git push origin vX.Y.Z`；
4. `.github/workflows/publish.yml` 会校验 tag 与 `package.json` 版本一致、运行测试、发布 npm（带 provenance），并创建 GitHub Release、附上 `.tgz`。

首次使用前，在 npm 包设置 → Trusted Publishing 中配置：仓库 `keyblues/dsh-icp`、workflow `publish.yml`。

## 许可

[MIT](LICENSE) © 2026 keyblues

- 查询流程参考公开项目 [HG-ha/ICP_Query](https://github.com/HG-ha/ICP_Query)，本项目为独立的 Node 实现，不依赖其运行实例。
- 本项目是非官方实现，与工信部及备案系统运营方无关联；接口与验证码可能随时变化。
- 仅用于查询公开备案信息，请遵守法律法规与官方服务条款，勿用于批量采集或攻击性用途。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
