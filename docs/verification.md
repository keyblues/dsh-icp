# 测试、审查与验证记录

本文档记录 2026-11-02 的一轮代码审查、稳定性测试与实网验证；所有脚本都在仓库 `test/` 下，可直接用 Node 运行、不依赖 DSH。

## 代码审查与稳定性

2026-11-02 做了一轮完整代码审查 + 稳定性测试：静态审查 + 独立只读审查 + 独立动态复核 + 自带故障注入套件。

### 审查方法

- **静态审查**：协议状态机、错误路径、并发/取消、内存边界、工具输出契约、Client 渲染安全、manifest 与 patch；
- **故障注入**（`test/stability.mjs`）：用假 MIIT 服务（自造验证码 PNG、假令牌/签名）模拟网络错误、超时、非 JSON、创宇盾拦截、401 验证码失配、验证码失败、空列表、详情失败、超大响应、预取消、并发首查、连续查询、异常 PNG 与异常行数据；
- **独立复核**：一个 agent 做只读静态审查；另一个 agent 独立编写 84 项动态探测（故障注入 / 并发与内存 / Host 工具 / 卡片 / PNG 模糊）并做限量实网边界测试。

### 本轮修复的稳定性问题

第一轮（故障注入 + 并发审查）：

| 问题 | 处理 |
|---|---|
| 并发首查各自解一次滑块（浪费反爬额度、可能交错） | 验证码求解改为单飞（single-flight），并发只解一次 |
| 401 后只作废验证码会话，过期令牌仍被复用 | 401 重试同时作废令牌与会话，重新认证 + 重解 |
| 详情端点被创宇盾拦截时被吞掉 | 改为向上抛出 `BLOCKED` 中止，而不是“悄悄缺详情” |
| 详情阶段取消被吞掉 | `AbortSignal` 中止一律向上传播 |
| 上游返回超大响应会全量读入内存 | 响应体 4 MB 上限（`RESPONSE_TOO_LARGE`），并先用 `content-length` 预检 |
| PNG 解压炸弹可能耗尽内存 | inflate 输出上限 + 像素上限，超限即拒 |
| `rows` 中出现 `null`/非对象会让渲染抛错 | `recordLine` / `cardRow` 防呆，跳过异常行 |
| 超长字段会刷爆模型可见正文 | 渲染字段截断 300 字符、卡片 meta 200→120 字符、标题/关键词同样截断 |
| 1.0.0 时期的历史结果没有 `rows` meta，卡片会误报“未查询到” | 旧 meta 判定为 legacy，展开回退到文本输出面板 |
| 图标里嵌套数组可能触发 React key 警告 | 扁平化子节点 |
| `page_num` 上限（10000）没有任何文档说明 | 工具描述与本文档补上 |

第二轮（独立静态审查发现的问题，均已修复）：

| 问题（严重度） | 处理 |
|---|---|
| **HIGH**：验证码环节 token 被服务端作废时，循环仍复用旧的 `const token`，重认证是死代码，可能白耗最多 5 次取图后报 `CAPTCHA_FAILED` | 每次尝试重新解析 token；`getCheckImagePoint` / `checkImage` 返回 401 时作废令牌并继续下一轮（新增回归测试） |
| **MEDIUM**：详情并发中某一条被创宇盾拦截后，其余 worker 仍继续请求（可能多打 ~20 次） | 共享 `AbortController` + `fatal` 标记：拦截/取消立即中止其余详情请求（新增 26 行并发回归测试） |
| **MEDIUM**：上游 `params.list` 混入 `null`/标量时，成功查询会在输出 schema 校验处变成 `INVALID_TOOL_OUTPUT` | `normalize()` 只保留对象行（与 `rows.items:{type:'object'}` 对齐，新增回归断言） |
| **MEDIUM**：工具 `timeoutMs` 未计入详情批次，最坏情况工具超时会掩盖真实错误 | 超时公式加入 `ceil(maxPageSize/detailConcurrency)` 个批次 |
| **MEDIUM**：超时/网络/非 JSON 等传输错误被当作“验证码失败”重试，可能空转数分钟 | 传输/认证类错误立即上抛，只对滑块识别失败重试 |
| **MEDIUM**：英文卡片里硬编码“条” | 计数文案走词典（`{count} records` / `{count} 条`） |
| **LOW**：每次请求轮换 `__jsluid_s` cookie | 每个客户端实例固定一个 cookie，更接近浏览器会话 |
| **LOW**：卡片 meta 最坏约 18 KB | 单字段 120 字符 + 序列化硬上限 8 KB（超限逐步裁掉行） |
| **LOW**：黑名单记录的 `title` 字段到不了卡片 | `RECORD_FIELDS` 增加 `title`，卡片副标题可用 |
| **LOW**：`rows[0]` 为 `null` 时卡片头部会抛错 | 头部取值加对象防护（新增 malformed-meta 回归测试） |
| **LOW**：清单缺 `engines.dsh` | 补 `dsh: ">=0.2.1-rc.3 <0.3.0-0"` |
| 清理项 | 删除不可达 throw、重复字段标签去重、空结果文案去重 |

### 测试结果

| 套件 | 结果 |
|---|---|
| `test/contract.mjs`（契约 / 渲染 / meta / dispose） | 23/23 |
| `test/client.mjs`（两种卡片各状态 + legacy/malformed meta） | 20/20 |
| `test/stability.mjs`（27 项离线故障注入，含 in-solve token 401、详情并发取消、PNG palette/16-bit） | 27/27 |
| 独立 verifier 自研探测（故障 25 / 并发+内存 8 / Host 12 / 卡片 29 / PNG 模糊 10） | 84/84 |
| 独立 code-auditor 只读静态审查 | HIGH 1 / MEDIUM 5 / LOW 若干，全部已处理；无 CRITICAL |
| 实网（独立 agent，限量） | 6/6 成功；第 7 次因关键词含 HTML 片段被创宇盾拦截，按约定立即停止 |

内存观察：连续 300 次查询堆增长约 0.3 MB，验证码会话始终只保留 1 个；`--unhandled-rejections=strict` 下所有套件无未处理 rejection。

## 验证

验证环境：DSH Desktop（profile `desktop`），2026-11-02；安装方式 `plugin_manager install_bundle`（本地目录以 `link:` 安装），安装结果 `application: applied`、`warnings: []`。本文档含三轮验证：1.0.0 首装（协议 / 工具）、1.1.0 更新（工具卡片 / 精简输出 / 会话复用）、审查与稳定性（故障注入 / 并发 / 边界，见上节）。

### 安装与注册

| 项 | 结果 |
|---|---|
| bundle 安装 | `dsh-icp`（1.0.0 首装，当前 1.1.1），`installed: true`，`enabled: true`，source `link:<本仓库目录>` |
| bundle 行 | `dsh-icp` → module `@local/dsh-icp`，entry `include:dsh-icp` |
| 工具注册 | `Tool.listTools` 中可见 `icp_query`（8 类 enum，required `[type, search]`）与 `icp_query_types`（无参数） |
| 配置 | `Config.listConfigs` → `include:dsh-icp`，`status: absent`（本 bundle 无 schemastery 配置 schema，配置来自 patch 行，属预期） |
| 插件页元数据 | `package.json` + `locale/zh|en.json` 标题/描述正常；`icon.svg` 为自包含 64×64 SVG |

### 实查结果（1.0.0 首轮，逐类取证）

| 调用 | 结果 |
|---|---|
| `icp_query_types` | count=8，8 类齐全，含官方接口基地址与当前生效配置 |
| `icp_query` web / `baidu.com` | 1 条：域名 baidu.com，主办单位 北京百度网讯科技有限公司，主体备案号 京ICP证030173号 |
| `icp_query` web / `深圳市腾讯计算机系统有限公司`、`page_num=2`、`page_size=3` | total=1702，pages=568，第 2 页 3 条，`hasNextPage=true`（渲染“还有下一页”） |
| `icp_query` app / `微信` | 1 条，`detailsFetched=true`，详情合并出 serviceName=微信、粤B2-20090059-1621A |
| `icp_query` mapp / `美团` | 2 条（北京三快在线科技 / 北京三快科技） |
| `icp_query` kapp / `支付宝` | 1 条 支付宝（杭州）数字服务技术有限公司，浙ICP备16025414号-44K |
| `icp_query` bweb / `tencent.com` | 单条记录，`blackListLevel=2`（暂无违法违规信息），`pageSize=0` |
| 错误输入 | 非法 `type` → 列出 8 个可选值；空 `search` → 明确报错；均在联网前失败，不崩溃 |

单次查询实测耗时 0.3–1.2 秒；测试期间未触发创宇盾拦截。独立验证 agent 复核了上述注册、实查与错误路径（6 次实查，未发现阻断性问题），复核后修复了两处缺陷：`icp_query_types` 的文本输出补齐「当前生效配置」、`hasNextPage` 改为由 `pageNum` / `pages` 推导（官方该字段恒为 `false`）。

### 1.1.0 更新验证（工具卡片 / 精简输出 / 会话复用）

2026-11-02 第二轮（1.1.0）：

| 项 | 结果 |
|---|---|
| Host 重载 | 插件页禁用 → 启用后 `application: applied`，新描述与新渲染立即生效 |
| 工具描述 | `Tool.listTools` 确认已精简：`icp_query` 为「查询工信部 ICP 备案（网站 / APP / 小程序 / 快应用及四类违规黑名单）…」，`icp_query_types` 为「列出 ICP 查询的 8 种类型…」 |
| 精简输出 | `icp_query`（web / `深圳市腾讯计算机系统有限公司`、`page_size=3`）返回 `ICP 备案 · 网站备案（web）· …` + `共 1702 条 / 568 页 · 第 1 页（每页 3 条） · 969 ms` + 3 行记录 + `下一页：page_num=2` |
| 会话复用 | 同一进程连续查询：首查 915 ms（含解滑块），后续 178–371 ms；期间无 401、无创宇盾拦截 |
| 离线测试 | `test/contract.mjs` 全部通过（含卡片 meta 断言）；`test/client.mjs` 17/17 通过（2 个卡片键注册、成功 / 折叠 / 黑名单 / 运行中 / 失败 / 类型目录渲染文本、词典与样式注册） |
| Client 注册 | Client `tool.call.toolview` 的 occupants 需页面刷新后出现；刷新前未出现（符合预期，见限制） |

独立验证 agent（第二轮）复核：`contract.mjs` 21/21、`client.mjs` 17/17 通过；一次实查（`web` / `baidu.com`，410 ms）输出与精简格式一致；`client.js` 已按官方 `ui-tool` 的 Tool 视图契约审查（hooks、`phase/block` 属性、slot 注册、locale、样式清理），未发现会导致卡片崩溃的问题。复核提出的 4 项已全部处理：

- 修正模型可见文案中“每次查询都要解验证码”的过期表述，改为“会话有效期内复用、过期后首查解滑块”；
- 修正 `cordis.patch.yml` 里“没有 client 半边 / 每次查询需解验证码”的过期注释；
- `test/client.mjs` 的样式表清理断言改为真实校验（`remove()` 确实被调用）；
- `dsh.client.inject` 补充槽位属主 `@deepseek-ai/dsh-client-ui-tool`。

### 已知限制

- **会话卡片尚未做视觉核对**：验证环境无浏览器控制能力。`client.js` 已通过离线浅渲染测试（`test/client.mjs`）、独立 agent 的 29 项卡片探测与官方 `ui-tool` 契约审查，但页面上的实际渲染需**刷新页面后**目视确认；卡片以官方样式为目标，复用官方 details-card 结构并只依赖 `--dsw-alias-*` 主题变量。刷新前的 `tool.call.toolview` occupants 中不会出现 `icp_query` / `icp_query_types`，属正常现象。
- **实网验证遇到拦截即停止**：审查轮实网探测在第 7 次调用（关键词含 `<script>` 片段）被创宇盾拦截后按约定立即停止，因此 `bapp` / `bmapp` / `bkapp` 本轮未重跑（1.0.0 首轮已实网通过）；被拦截后建议冷却数分钟再查。
- `includeDetails=false`、`page_size` 截断、401 重试、超时与 abort 路径均有离线故障注入覆盖，部分未逐项做实网调用（避免触发官方风控）。
- 插件页标题/描述/图标以文件与安装清单为准，未做浏览器截图逐像素核对。
