# ICP 备案查询 · DSH 原生插件

[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-4c6ef5?style=flat-square)](#)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek-Harness-5b6bff?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square)](package.json)
[![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.3%2B-4D6BFE?style=flat-square)](#兼容性)
[![GitHub stars](https://img.shields.io/github/stars/keyblues/dsh-icp?style=flat-square)](https://github.com/keyblues/dsh-icp/stargazers)

> **English** — MIIT ICP filing lookup for DeepSeek Harness (DSH). A native bundle that reimplements the MIIT filing query flow inside the Node process — access token, locally solved slider captcha, `queryByCondition` plus app details — and registers two agent tools: `icp_query` (websites / apps / mini programs / quick apps, plus the four violation blacklists) and `icp_query_types`. No MCP server, no external service, no API key, zero npm dependencies. Results render as official-style conversation cards.

插件在 Node 进程内**自己实现**工信部备案查询服务的完整协议：获取访问令牌、在本地求解滑块验证码、调用官方查询接口并补全应用详情。它注册两个原生工具：

- `icp_query` — 查询工信部 ICP 备案（网站 / APP / 小程序 / 快应用，以及四类违法违规黑名单），支持分页；
- `icp_query_types` — 列出支持的查询类型、各类型 `search` 的填写方式与当前生效配置。

它不是 MCP 客户端，不依赖任何外部服务，也不需要 API Key。工具在会话里以**官方样式的可展开卡片**呈现（Host 注册工具 + Client 声明 `tool.call.toolview` 卡片），折叠时显示查询类型 / 关键词与结果统计，展开后是分页信息与备案记录列表。

## 特性

- 直连工信部官方接口 `https://hlwicpfwc.miit.gov.cn/icpproject_query/api`，实时查询，无中转、无第三方数据商；
- 单入口 `search`：域名、主办单位名称、备案号、应用名称都可以直接填；
- 网站 / APP / 小程序 / 快应用的普通备案查询支持分页（`page_num` / `page_size`）；
- APP / 小程序 / 快应用的每条记录会再走官方详情接口（`queryDetailByAppAndMiniId`）补全服务名称等字段（可用 `includeDetails` 关闭）；
- 四类违法违规黑名单查询（网站 / APP / 小程序 / 快应用），结果附带威胁等级说明；
- 滑块验证码在本地解码 PNG 并定位缺口，全程无人工交互；业务令牌与验证码会话在插件生命周期内缓存复用（连续查询只需解一次验证码，实测首查约 0.9 秒、后续约 0.2–0.4 秒）；
- 模型可见结果经过精简：一行一条记录（`域名 | 主办单位=… | 主体备案号=…`），不再输出内部 ID 等冗余字段，并给出 `下一页：page_num=N` 提示；
- 会话内工具卡片：折叠态显示类型 / 关键词 / 条数与耗时，展开态显示分页、记录字段与黑名单等级；运行中有 shimmer、失败与中断各有状态；
- 零运行时依赖：仅使用 Node 内置 `fetch` / `crypto` / `zlib` 等能力，无 npm 依赖、无构建步骤、无 `schemastery`。

## 安装

> 本插件暂未发布到 npm。npm 上确实存在一个名为 `dsh-icp` 的包，但那是另一位作者的无关项目（ICP ticker），**不要**通过 npm 安装本插件。请使用下面的 GitHub 方式安装。

本 bundle 零运行时依赖、无安装脚本、无构建步骤，从 GitHub 源码安装即可使用。

### 从 GitHub 安装（推荐）

1. 打开 DSH 侧边栏「插件」页；
2. 点右上角「添加插件」→「安装第三方插件」；
3. 在「包名或地址」里填本仓库地址：

   ```text
   https://github.com/keyblues/dsh-icp
   ```

4. 安装完成后，`icp_query` / `icp_query_types` 随插件自动注册（工具名就这两个，没有 MCP 前缀）。

也可以让 Agent 代劳：

```text
plugin_manager(action: "install_bundle", target: "github:keyblues/dsh-icp")
```

### 本地 clone / 离线安装

```bash
git clone https://github.com/keyblues/dsh-icp.git
```

```text
plugin_manager(action: "install_bundle", target: "<上一步 clone 目录的绝对路径>")
```

本地目录会以 `link:` 方式安装，不打包、不下载；之后 `git pull` 更新代码无需重装（但 Host 模块需按下方说明重新加载）。

### 安装后

- 安装成功后 `application` 应为 `applied`，bundle 行 `dsh-icp` 立即激活；
- 本 bundle 没有任何依赖和安装脚本，无需 pnpm、无需构建、无需额外审批 `approvedBuilds`；
- **工具卡片**由 Client 半在页面启动时加载：首次安装、升级或修改 `client.js` 后需**刷新一次浏览器页面**（Host 工具无需刷新）；
- 若修改了本插件目录中的 `index.js` / `lib/**`，Host 进程不会自动重载模块：在「插件」页把本 bundle **禁用再启用**即可重新加载（已实测生效），或重启 DSH。仅重新安装同一路径不会刷新已缓存的模块。

### 卸载

在「插件」页找到本插件后卸载，或：

```text
plugin_manager(action: "remove_bundle", target: "@local/dsh-icp")
```

卸载会移除 profile 中的 bundle 选择与 `dsh-icp` 行；克隆到本地的目录不会被删除，随时可以重新安装。彻底清理时重启 DSH 以确保 Host 模块释放。

### 兼容性

| 项 | 要求 |
|---|---|
| Node.js | `>= 20` |
| DSH | `>= 0.2.1-rc.3 < 0.3.0-0`（见 `package.json` 的 `engines.dsh`） |
| 平台 | macOS / Windows / Linux（纯 JS，无原生依赖） |
| 网络 | 需能直连 `hlwicpfwc.miit.gov.cn` |
| 凭据 | 无（匿名令牌仅保存在进程内存中） |

## 工具参考

### `icp_query`

查询一类 ICP 备案数据。参数如下：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | string（枚举） | 是 | 查询类型，取值见下方「查询类型」表：`web` / `app` / `mapp` / `kapp` / `bweb` / `bapp` / `bmapp` / `bkapp` |
| `search` | string | 是 | 查询关键词。普通类型可填：域名（`baidu.com`）、主办单位名称（`深圳市腾讯计算机系统有限公司`）、备案号（`京ICP证030173号`）；APP / 小程序 / 快应用也可填应用名称（`微信`）；四类黑名单类型分别填域名或应用名称 |
| `page_num` | integer | 否 | 页码，从 1 开始，上限 10000（越界页返回 0 行）；**四类黑名单忽略此参数** |
| `page_size` | integer | 否 | 每页条数，默认 `min(10, maxPageSize)`，上限为插件配置的 `maxPageSize`（默认 10，最大 26）；**四类黑名单忽略此参数** |

没有单独的 `unitName` / `domain` / `appName` / 许可证号参数——一个 `search` 同时承担这些查询条件。

返回字段（工具输出 schema）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` / `label` | string | 查询类型 key 与中文名 |
| `search` | string | 实际使用的关键词（已 trim） |
| `pageNum` / `pageSize` | integer | 实际生效的页码与每页条数；黑名单类型 `pageSize=0` |
| `total` / `pages` | integer | 总条数 / 总页数（黑名单为 1 页或 0） |
| `hasNextPage` | boolean | 是否还有下一页（由官方返回的 `pageNum` / `pages` 推导；官方该字段恒为 `false`，不可直接用） |
| `rowCount` | integer | 本页记录数（黑名单为 0 或 1） |
| `rows` | array | 备案记录。常见字段：`domain` / `domainName` 域名、`unitName` 主办单位、`mainLicence` 主体备案号、`serviceLicence` 服务备案号、`updateRecordTime` 审核通过日期、`serviceName` 服务名称、`natureName` 单位性质等；APP 类补全详情后还会带官方详情字段 |
| `detailsFetched` | boolean | 是否成功补充了 APP / 小程序 / 快应用详情 |
| `elapsedMs` | integer | 本次查询耗时（毫秒） |
| `message` | string（可选） | 说明信息，例如无记录提示或黑名单等级解释 |

### `icp_query_types`

无输入参数（`{}`）。返回：

| 字段 | 类型 | 说明 |
|---|---|---|
| `count` | integer | 类型数量（固定 8） |
| `types` | array | 每项含 `type`、`label`、`blacklist`、`paginated`、`service_type`、`search_hint` |
| `endpoint` | string | 官方接口基地址 |
| `note` | string | 使用提示（验证码成本、反爬与限频说明） |
| `config` | object | 当前生效配置（`captcha_max_attempts`、`timeout_ms`、`max_page_size`、`detail_concurrency`、`include_details`） |

## 查询类型

| `type` | 中文 | 上游 `serviceType` | `search` 可填 | 分页 |
|---|---|---|---|---|
| `web` | 网站备案 | 1 | 域名 / 主办单位名称 / 备案号 | 支持 |
| `app` | APP 备案 | 6 | 应用名称 / 主办单位名称 / 备案号 | 支持（自动补详情） |
| `mapp` | 小程序备案 | 7 | 应用名称 / 主办单位名称 / 备案号 | 支持（自动补详情） |
| `kapp` | 快应用备案 | 8 | 应用名称 / 主办单位名称 / 备案号 | 支持（自动补详情） |
| `bweb` | 违法违规网站 | — | 域名 | 不支持（单条记录） |
| `bapp` | 违法违规 APP | 6 | APP 名称 | 不支持（单条记录） |
| `bmapp` | 违法违规小程序 | 7 | 小程序名称 | 不支持（单条记录） |
| `bkapp` | 违法违规快应用 | 8 | 快应用名称 | 不支持（单条记录） |

`bweb` / `bapp` / `bmapp` / `bkapp` 分别对应上游黑名单接口的四类查询；返回记录中的 `blackListLevel=2` 表示暂无违法违规信息，其它等级表示存在记录，具体含义以官方返回为准。

## 工具卡片（Client 半）

`client.js` 是该 bundle 的 Client 半（`package.json` → `dsh.client`），只做一件事：向 `tool.call.toolview` 槽位注册两个按工具名分发的会话卡片（`icp_query` / `icp_query_types`），样式沿用官方 Tool 行：

- **折叠头**：官方 14px 线条图标（备案文件 + 放大镜 / 列表）、标题、`·` 分隔的摘要（类型 · 关键词）、右侧统计（条数 · 耗时）；悬停时图标切换为展开箭头。
- **展开体**：复用官方 details-card 原语（`.ict_detailsCard`，只用 `--dsw-alias-*` 主题变量）；`icp_query` 显示类型、关键词、分页、耗时以及每条备案记录的字段，`icp_query_types` 显示接口基地址、当前生效配置与 8 类说明。
- **状态**：运行中是 shimmer 扫光 + 当前参数摘要；失败显示错误摘要与错误面板；被用户停止显示停止态；结果过大落盘（spill）时卡片仍可从持久化 meta 重绘。
- **数据来源**：Host 侧 `output.presentationMeta` 写入的持久化卡片事实（最多 10 条精简记录），不依赖模型可见正文，因此 fork / 重开会话后卡片仍完整。

> Client 半由页面在启动时加载：**新增或修改 `client.js` 后需要刷新一次浏览器页面**才会出现卡片；Host 侧工具本身即时生效。卡片没有插件设置页，配置仍来自 profile patch 行。

## 配置项

配置写在 bundle 的 `cordis.patch.yml` 中（安装时随 bundle 生效），也可以在本 profile 的 `cordis.patch.yml` 里按行 id `dsh-icp` 覆盖同名项：

```yaml
- id: dsh-icp
  config:
    timeoutMs: 45000
    includeDetails: false
```

| 配置项 | 类型 | 默认 | 范围 | 作用 |
|---|---|---|---|---|
| `captchaMaxAttempts` | integer | `5` | 1–10 | 单次查询内滑块验证码的最大尝试次数（每次尝试都会重新取图） |
| `timeoutMs` | integer | `30000` | 5000–120000 | 单次上游 HTTP 请求超时（毫秒）；工具级超时会随该值与重试次数自动放宽 |
| `maxPageSize` | integer | `10` | 1–26 | 每页条数上限；`page_size` 超过该值会被截断（官方上限 26） |
| `detailConcurrency` | integer | `5` | 1–10 | 并发拉取 APP / 小程序 / 快应用详情的数量 |
| `includeDetails` | boolean | `true` | `true` / `false` | 是否补全 APP / 小程序 / 快应用详情；关闭后更快、结果只含列表字段 |

本 bundle **刻意不依赖 `schemastery`**：配置由 `index.js` 的 `normalizeConfig()` 在代码里归一化，非法值回退默认值并截断到范围内，因此没有插件设置表单，配置只来自 Loader 行的 `config`。修改配置后重启 DSH 或重载该 bundle 行生效。

## 为什么是"原生"的

| 维度 | 本插件 | 典型 MCP 方案（如 `icp-mcp` bundle） |
|---|---|---|
| 查询链路 | Node 进程 → 工信部官方接口 | Node → MCP 服务 → 第三方接口 |
| 外部依赖 | **无**（不需要部署 MCP server / 中继） | 需要可达的 MCP 服务或 API 提供方 |
| 凭据 | **无 API Key**，只用官方匿名令牌 | 通常需要 API Key 或订阅账号 |
| 验证码 | 本地解码 PNG + 缺口定位，自动求解 | 由远端服务处理 |
| 运行时依赖 | **0 个 npm 包** | 视实现而定 |

它是对公开项目 [HG-ha/ICP_Query](https://github.com/HG-ha/ICP_Query) 查询流程的 Node 重写：不把该项目的实例接进来，而是直接复刻它访问工信部服务的行为。`lib/miit.js` 负责协议与网络，`lib/png.js` 负责纯 JS 解码 PNG，`lib/slider.js` 负责滑块缺口定位。

> 这是**非官方**实现：工信部未公开该接口文档，协议来自对公开项目的复刻与实测。官方接口或反爬策略变化时，插件可能失效。

## 上游查询流程

一次 `icp_query` 的完整时序（与 HG-ha/ICP_Query 一致）：

1. **`POST /auth`** — 取访问令牌。`authKey = md5("testtest" + timestamp)`，请求体为 `authKey` 与 `timestamp`（`application/x-www-form-urlencoded`）；响应 `params.bussiness` 即业务令牌，`params.expire` 为有效期。
2. **`POST /image/getCheckImagePoint`** — 携带 `token` 请求滑块验证码，响应返回 `uuid`、背景图 `bigImage` 与拼图块 `smallImage`（均为 base64 PNG）。
3. **本地求解滑块** — 用 `lib/png.js` 解码两张 PNG，用 `lib/slider.js` 在背景图中定位缺口位置，得到水平偏移量 `offsetX`。
4. **`POST /image/checkImage`** — 提交 `{ key: uuid, value: offsetX }`，通过后响应 `params` 即为该验证码会话的 `sign`。
5. **`POST /icpAbbreviateInfo/queryByCondition`** — 携带 `token`、`uuid`、`sign` 三个请求头，请求体 `{ pageNum, pageSize, unitName: search, serviceType }`；`serviceType` 为 1（网站）/ 6（APP）/ 7（小程序）/ 8（快应用）。响应 `params.list` 为备案记录，`params.total` / `pages` / `hasNextPage` 为分页信息。
6. **`POST /icpAbbreviateInfo/queryDetailByAppAndMiniId`** — 仅 APP / 小程序 / 快应用：对每条带 `dataId` 的记录按 `{ dataId, serviceType }` 拉取详情并合并进该行；并发数由 `detailConcurrency` 限制，详情失败只降级为缺少详情，不影响列表结果。

违法违规黑名单走同样第 1–4 步拿验证码会话，然后：

- 违法违规网站：`POST /blackListDomain/queryByCondition`，请求体 `{ domainName: search }`；
- 违法违规 APP / 小程序 / 快应用：`POST /blackListDomain/queryByCondition_appAndMini`，请求体 `{ serviceName: search, serviceType }`。

黑名单接口**不分页**，返回单条记录（`blackListLevel=2` 表示暂无违法违规信息）。

重试策略：

- 业务令牌在进程内缓存到过期前 5 秒；并发的多个查询共用同一次 `/auth` 请求。
- 单次查询内，若滑块定位或校验失败，会重新取一张验证码再试，最多 `captchaMaxAttempts` 次。
- **验证码会话复用**：`checkImage` 返回的 `sign` 本身有数分钟有效期，解析其 JWT 里的过期时间作为复用截止点（最多 3 分钟），期间所有查询共用同一会话；只有被 401 拒绝时才作废并重解一次（最多重试一轮）。
- 因此只有「会话过期后的第一次查询」需要解滑块（实测约 0.9 秒），后续查询约 0.2–0.4 秒；这是官方接口的正常成本。

## 风险与限制

- **创宇盾反爬**：官方服务由创宇盾保护。出口 IP 被判定异常时，接口会返回“当前访问疑似黑客攻击”页面，此时插件抛出 `BLOCKED` 错误；请稍后重试或更换网络出口，不要连续重试。
- **含 HTML/特殊片段的关键词可能被 WAF 拦截**：实测搜索词里带 `<script>` 等片段时，创宇盾会直接拦截（`BLOCKED`），与查询内容本身无关；这属于官方 WAF 行为，插件按错误返回且不自动重试。
- **大页码不报错**：`page_num` 超过 10000 会被截断为 10000，超出实际页数时返回 0 行（`total` 仍为真实总数），而不是抛出错误。
- **官方限频未知**：工信部未公布该匿名接口的频率配额，高频或并发查询可能被限流、拦截甚至临时封 IP。`icp_query` 已声明为非并发安全（同一 Agent 内不会并行调用），但仍建议保持低频、按需查询，不要批量扫描。
- **首查约 1 秒、后续约 0.2–0.4 秒**：验证码会话在有效期内复用，只有会话过期后的第一次查询需要本地解滑块；这是协议本身的成本，不是插件卡顿。
- **非官方协议**：接口文档未公开，协议逆向自公开项目 `HG-ha/ICP_Query` 并经过实测；官方调整接口、验证码或风控策略时插件可能失效，需要跟进修改（`lib/miit.js` 的端点、`lib/slider.js` 的定位算法）。
- **数据仅供参考**：结果以工信部备案系统（`https://beian.miit.gov.cn/`）与官方解释为准；`rowCount=0` 只代表该关键词在官方接口下未命中，不代表主体一定未备案。
- **无担保**：本项目按 MIT 许可“as is”提供，作者不对查询结果的正确性、完整性、可用性及因使用产生的任何后果负责。
- **合规使用**：仅用于查询公开备案信息，请遵守法律法规与官方服务条款，勿用于批量采集或攻击性用途。
- **隐私**：插件不收集、不上传用户数据；业务令牌与验证码会话只保存在进程内存中，不落盘。

## 文件

| 文件 | 作用 |
|---|---|
| `package.json` | bundle 清单：包名 `@local/dsh-icp`、导出 `index.js` / locale / icon、`dsh.bundle.patch` |
| `cordis.patch.yml` | 插入一条 Host 行：`id: dsh-icp`、`name: '@local/dsh-icp'` 及默认 `config` |
| `index.js` | Cordis Host 插件：`name` / `inject = ['tools']` / `apply`，注册 `icp_query` 与 `icp_query_types`，归一化配置、精简渲染、写卡片 meta |
| `client.js` | Cordis Client 插件：向 `tool.call.toolview` 注册 `icp_query` / `icp_query_types` 官方样式卡片，并注册词典与样式表 |
| `lib/miit.js` | 工信部协议客户端：`/auth` 令牌、滑块验证码会话（含复用）、`queryByCondition`、应用详情、四类黑名单端点、错误类型 |
| `lib/png.js` | 纯 JS PNG 解码器（解析 IHDR/PLTE/IDAT，用 `node:zlib` 解压并按行反滤波，支持调色板 / RGB / RGBA / 灰度），供验证码图像处理使用 |
| `lib/slider.js` | 滑块缺口定位算法（复刻上游 `match_slider_offset`）：背景图降采样 + 颜色量化，取前三大颜色做垂直游程统计，按长宽比筛出方形缺口，返回水平偏移量 |
| `locale/en.json` / `locale/zh.json` | Plugin Manager 显示的标题与描述（英文 / 中文） |
| `icon.svg` | 插件图标（备案文件 + 放大镜，64×64 SVG） |
| `test/contract.mjs` | 离线契约测试：用桩上下文跑真实 `apply()`，校验注册、参数校验、精简渲染、卡片 meta 与 disposer（不联网） |
| `test/client.mjs` | 离线卡片测试：用 React 桩加载 `client.js`，校验两个卡片的注册与成功 / 折叠 / 黑名单 / 运行中 / 失败 / 类型目录等渲染文本（不联网） |
| `test/stability.mjs` | 离线稳定性 / 故障注入套件：假 MIIT 服务 + 自造验证码 PNG，覆盖网络错误、超时、创宇盾拦截、401、并发首查、超大响应、异常行数据、异常 PNG 等 27 项（不联网） |
| `test/smoke.mjs` | 手工实查冒烟：八类查询 + 分页，每类一次真实调用（会消耗滑块验证码，请低频运行） |
| `test/live-stability.mjs` | 手工实网稳定性探测：四类正常查询 + 黑名单 + 分页越界 / `page_size` 截断 + 无结果，约 9 次真实调用（低频） |
| `docs/verification.md` | 代码审查、稳定性修复、离线测试与实网验证记录 |
| `README.md` | 本文档 |

> 本 bundle 是 **Host + Client** 结构：Host 半边提供工具与协议实现；Client 半边（`client.js`）只声明会话工具卡片，没有插件设置页，也不注册任何 HTTP 路由。

## 本地开发与测试

五个脚本都在 `test/` 下，直接用 Node 运行（零依赖、不需要 DSH，也不需要先安装）：

```bash
node test/contract.mjs        # 离线：契约 / 参数 / 精简渲染 / 卡片 meta / disposer
node test/client.mjs          # 离线：React 桩加载 client.js，浅渲染两种卡片各状态
node --unhandled-rejections=strict test/stability.mjs   # 离线：27 项故障注入稳定性测试
node test/smoke.mjs           # 联网：八类查询 + 分页各一次真实调用
node test/live-stability.mjs  # 联网：边界稳定性探测（约 9 次真实调用）
node test/smoke.mjs web app   # 只跑指定类型
```

`contract.mjs` / `client.mjs` / `stability.mjs` 不触网，可随时运行；`smoke.mjs` 与 `live-stability.mjs` 会真实调用官方接口并求解滑块验证码，受官方反爬限制，请低频使用（脚本内已做间隔；遇到创宇盾拦截会立即停止）。

## 测试与验证

| 套件 | 结果 |
|---|---|
| `test/contract.mjs`（契约 / 渲染 / meta / dispose） | 全部通过 |
| `test/client.mjs`（两种卡片各状态 + legacy/malformed meta） | 全部通过 |
| `test/stability.mjs`（离线故障注入） | 27/27 |
| 独立审查与实网验证 | 见 [docs/verification.md](docs/verification.md) |

离线套件覆盖协议状态机、401 重试、并发首查、取消、响应体上限、PNG 解压边界、异常行数据、卡片渲染与清理等路径；完整记录（含审查发现的 HIGH/MEDIUM 问题清单与修复方式）在 [docs/verification.md](docs/verification.md)。

## 与 MCP 方案共存

本插件与 `icp-mcp` 之类的 MCP 中继互不冲突：MCP 方案的工具名是 `mcp__icp__*`，本插件注册的是 `icp_query` / `icp_query_types`。两者可以同时安装，但会出现两套 ICP 工具，按需保留其中一个即可。

## 许可

[MIT](LICENSE) © 2026 keyblues

- 查询流程参考公开项目 [HG-ha/ICP_Query](https://github.com/HG-ha/ICP_Query)，本项目为 Node 原生重写，不依赖其运行实例；
- 本项目是**非官方**实现，与工信部及备案系统运营方无关联；接口与验证码可能随时变化；
- 仅用于查询公开备案信息，请遵守法律法规与官方服务条款，勿用于批量采集或攻击性用途。
