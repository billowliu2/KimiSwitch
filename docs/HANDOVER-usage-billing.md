# 工作交接：账单查询功能（2026-08-01）

> 新会话续作入口：先读本文件 + `docs/USAGE-QUERY-ADAPTATION.md`（调研文档），然后按「二、下一步」继续。

## 一、当前进度总览

**已提交并发布 v0.6.4**：
- `ace9842` — feat: 新增部分套餐账单查询（v0.6.4）（26 文件 +1822/-60，含以下全部 6 个批次 + 版本号三处 0.6.4）
- 已推送 origin（git.codingplan.site）：分支 `Dev_20260801` + tag `v0.6.4`
- 已推送 GitHub（billowliu2/KimiSwitch）：tag `v0.6.4`（走 127.0.0.1:7897 代理；git 全局配置 `http.proxy` 指向它，代理关闭时 push 会报 schannel SSL 握手错误，可用 `git -c http.proxy= push` 绕过硬连 origin）
- GitHub Actions Release workflow 已触发（三平台构建 → Release draft 自动上传 msi/dmg/AppImage/deb/rpm）
- 本地 0.6.4 安装包：`src-tauri/target/release/bundle/{nsis,msi}/`

**已提交并发布 v0.6.5**：
- `feat: 优化更新检查逻辑 + 修复按量余额显示（v0.6.5）`
- 检查更新优先私有库（git.codingplan.site），8s 超时自动回退 GitHub
- 设置-关于：合并移植声明为一句、新增 cc-switch 链接（openUrl + window.open 兜底）、移除仪表盘/会话页脚重复声明
- 修复按量余额不显示：UsageFooter isPlan 判定增加配额字段（total/used）条件——余额条目（DeepSeek/StepFun/SiliconFlow/Novita/Kimi 开放平台）现在正确显示 `💰 ¥x.xx`，套餐类（有 total/used）不受影响。实测 DeepSeek 官方接口返回 200 + balance_infos
- 两仓库 main + Dev_20260801 + tag v0.6.5 已同步

**历史提交**：`12dcb17` — docs: 账单查询适配调研 + OpenCode Zen 预设补推荐链接

**工作区未提交改动**——用户硬约束：**实现完成不提交，等用户逐批测试确认后才提交**。
`git status` 实测清单（注意：`src-tauri/Cargo.toml` 现含**真实改动**——批次 4 新增 tokio 依赖行，另混有用户自己的行尾差异，提交时只保留 tokio 行）：

```
M  docs/USAGE-QUERY-ADAPTATION.md   M  src/App.tsx
M  src-tauri/Cargo.toml（含 tokio 真实改动）  M  src/components/ProviderList.tsx
M  src-tauri/src/commands.rs        M  src/components/UsageFooter.tsx
M  src-tauri/src/db.rs              M  src/config/providerPresets.ts
M  src-tauri/src/kimi_code_io.rs    M  src/hooks/useConfig.ts
M  src-tauri/src/lib.rs             M  src/i18n/en.ts
M  src-tauri/src/models.rs          M  src/i18n/zh.ts
M  src-tauri/src/pi_io.rs           M  src/types/index.ts
M  src-tauri/src/services/balance.rs / coding_plan.rs / mod.rs
?? docs/HANDOVER-usage-billing.md（本文件）
?? src-tauri/src/oauth.rs
?? src/components/UsageConfigModal.tsx
?? src/lib/usage-display.ts
```

### 批次 1：P0 `balance:kimi` + usageKinds 字段修复
- `src-tauri/src/services/balance.rs` — `query_kimi`/`parse_kimi`（`api.moonshot.cn|ai/v1/users/me/balance`，CNY/USD 消歧）+ 5 单测
- `src-tauri/src/services/mod.rs` — `UsageKind::BalanceKimi`（"balance:kimi"）、detect_provider 加 `api.moonshot.cn/.ai`
- `src/config/providerPresets.ts` — union/SUPPORTED 加 `balance:kimi`，moonshot 预设挂 usageKinds
- `src-tauri/src/models.rs` — **`usage_kinds` 加 `#[serde(rename = "usageKinds")]`**（修复历史 bug：Rust 序列化 snake_case、前端读 camelCase 导致所有账单入口不显示）

### 批次 2：A/B/C 三阶段（OAuth + 配置面板 + NewAPI）
Rust：
- `src-tauri/src/oauth.rs`（新增）— 读 `~/.kimi-code/credentials/kimi-code.json` access_token，30s 过期缓冲，**不做 refresh**（避免与 CLI 的 refresh_token 轮换竞态）
- `src-tauri/src/models.rs` — `UsageConfig` struct（camelCase）+ `Provider.usage_config`（rename="usageConfig"）
- `src-tauri/src/services/balance.rs` — `query_newapi`/`parse_newapi`/`fetch_newapi_status`（NewAPI 中转站：`{base}/api/user/self` + Bearer accessToken + `New-Api-User` userId；`/api/status` 拉 quota_per_unit/货币符号，进程内缓存 5min；quota=0 视为无限额度）
- `src-tauri/src/services/mod.rs` — `BalanceNewapi`（"balance:newapi"，ALL=10），`query_kind` 签名加 `usage_config: Option<&UsageConfig>`
- `src-tauri/src/commands.rs` — `usage_config_key` + merge_usage_kinds 同时 merge usage_config（SQLite `usage_config:<name>`）；save 时持久化；`query_provider_usage`：usageConfig.enabled=false 拒绝、templateType=="newapi" 走 NewAPI 分支、managed 供应商读 OAuth token（api_key 优先，OAuth 兜底）
- `src-tauri/src/lib.rs` — 注册 `pub mod oauth;`
- `src-tauri/src/db.rs` / `kimi_code_io.rs` / `pi_io.rs` — Provider 构造点补 `usage_config: None`（8 处）

前端：
- `src/types/index.ts` — `UsageConfig` 接口 + `Provider.usageConfig`
- `src/components/UsageConfigModal.tsx`（新增）— 配置面板（批次 3 已改全屏）
- `src/components/UsageFooter.tsx` — 拆 compact（卡片右侧：主摘要 + `x 分钟前` + 刷新，含自动查询 interval）/ detail（底部：多档明细 + 错误/重试）；模块级缓存 + 3 并发信号量
- `src/components/ProviderList.tsx` — BarChart3 配置入口按钮；紧凑用量行嵌入按钮组、位于「切换使用」左侧（cc-switch 布局）
- `src/App.tsx` — `usageConfigProvider` 状态 + `handleSaveUsageConfig` + modal 挂载
- `src/i18n/zh.ts` / `en.ts` — 新增约 34 个 key

### 批次 3：全屏配置页面 + 超时配置
- `src/components/UsageConfigModal.tsx` — **居中弹窗 → 全屏页面**（参考 cc-switch FullScreenPanel）：`fixed inset-0 flex flex-col bg-app`，header 64px（ArrowLeft 返回 + 标题），内容 `max-w-3xl` 居中滚动，footer 固定底部；ESC 关闭但输入框聚焦时不关（isTextEditableTarget）
- 新增页面元素：**支持的变量区**（`{{baseUrl}}`/`{{apiKey}}` 脱敏 + 眼睛切换明文）、**超时时间输入**（与自动查询间隔并排两列）
- 超时接线：`UsageConfig.timeout_seconds`（models.rs camelCase）+ `types/index.ts timeoutSeconds`；`balance.rs::get_json` 及全部 `query_*`、`fetch_newapi_status`、`coding_plan` 3 函数加 `timeout: Duration` 参数；`query_kind` 从 usage_config 计算（0/None 回退 8s），`commands.rs` 无改动
- i18n：`usageTimeout`/`usageTimeoutHint`/`usageSupportedVars`/`usageBack`（zh+en）
- **测试查询体验修复**（2026-08-01 用户反馈「测试查询没有生效」）：
  - 测试结果框改为 **sticky bottom-0**（在 body 滚动容器内），始终浮在 footer 上方，点了立即可见
  - 「自动检测 + 无识别类型」短路：handleTest 前置检查 detectedKinds.length===0，直接展示 `usageUnsupportedProvider` 中文提示，不发无效请求
  - 「未识别查询类型」区改为带「切换到 NewAPI 模板」快捷按钮的 amber 提示框（替换原灰色单行）
  - 新增 i18n：`usageNoKindsHint`/`usageSwitchToNewapi`/`usageUnsupportedProvider`

**验证（三批累计）**：`cargo test --lib` 46 全过、`cargo check` 干净、`tsc --noEmit` 零错误。
**最新打包产物**（批次 3 + 体验修复 已交付用户测试）：
- `D:\AIGC\KimiSwitch\src-tauri\target\release\bundle\nsis\Kimi Switch_0.6.3_x64-setup.exe`
- `D:\AIGC\KimiSwitch\src-tauri\target\release\bundle\msi\Kimi Switch_0.6.3_x64_en-US.msi`

### 批次 4（2026-08-01）：OAuth refresh + 测试查询短路修复
- **背景**：用户反馈「Kimi login 又失效」——根因是 access token 15 分钟过期且 refresh 未实现（§三.3 已拍板实现）；refresh 端点与 client_id 已从 kimi.exe 二进制实测确认（`POST https://auth.kimi.com/api/oauth/token`，client_id `17e5f671-d194-4dfb-9706-5516cb48c098`，form-encoded grant_type=refresh_token）
- `src-tauri/src/oauth.rs` — `get_valid_access_token()`：过期 → `tokio::sync::Mutex` 单 flight 锁内重读文件（CLI/其他等待者可能已刷新则直接采用）→ `refresh_credentials()` 调 token 端点 → 写回前再重读（CLI 若已轮换则采纳其 token，避免覆盖 CLI 的新 refresh_token）→ `merge_token_response()` 纯函数合并写回（保留未知字段）+ 3 个新单测
- `src-tauri/src/commands.rs` — managed 分支改为 `get_valid_access_token().await`，错误信息直接用 refresh 的具体失败原因（含 invalid_grant 时提示重新 `kimi login`）
- `src-tauri/Cargo.toml` — 新增 `tokio = { version = "1", features = ["sync"] }`（项目本无 tokio 直接依赖）
- `src/components/UsageConfigModal.tsx` — 「无识别类型短路」加 `!isManaged` 守卫（managed 走 OAuth 与 detectedKinds 无关，防误伤）
- **验证**：cargo test 48 过（+2 merge 用例）、tsc 零错误

### 批次 5（2026-08-01）：用量显示本地化 + 按钮顺序调整
- `src/lib/usage-display.ts`（新增）— `planLabel()`（five_hour→"5小时"/"5-hour"、weekly_limit→"7天"/"Weekly"，其余专名透传）+ `localizeUsageError()`（Rust 英文错误串按前缀/正则映射到 i18n，未知错误透传保留诊断信息）
- `src/components/UsageFooter.tsx` — compact/detail 的 tier 标签与错误显示接入两个 helper
- `src/components/UsageConfigModal.tsx` — 测试结果的 planName/错误同样本地化；catch（瞬时失败）统一显示 usageNetworkError
- `src/components/ProviderList.tsx` — BarChart3（配置用量查询）按钮从图标组首位移到 Activity（连通测试）与 Trash（删除）之间
- i18n 新增：`usageTier5h`/`usageTierWeekly`/`usageErrNoKey`/`usageErrDisabled`/`usageErrLoginExpired`/`usageErrNoOauth`/`usageErrNewapiCreds`（zh+en）
- **验证**：tsc 零错误（纯前端改动，Rust 未动）

### 批次 6（2026-08-01）：测试查询「无结果」根因修复
- **根因**：`App.tsx` 顶层 `if (loading || !config) return <loading 页>`——`handleTest` 先 `onSave` → `void save()` → `setLoading(true)` → App 整树换成 loading 页 → **modal 被卸载**；查询结果回来后 setState 打到已卸载实例（无效），save 结束 modal 全新重挂载（testResult=null）。自配置面板引入即存在，任何「先保存再查询」的路径都中招。
- `src/hooks/useConfig.ts` — `refresh`/`save` 加 `{ silent?: boolean }` 选项：silent 时不翻 loading 页（不 setLoading）
- `src/App.tsx` — `handleSaveUsageConfig` 改为 `return save({ silent: true })`；error 分支重试按钮 `onClick={refresh}` 改箭头包装（MouseEvent 会当 opts 传入）
- `src/components/UsageConfigModal.tsx` — `onSave` 类型改 `Promise<void> | void`；`handleTest` **await onSave 完成后再 invoke 查询**（保证后端读到同一份配置）
- `src/components/ProviderList.tsx` — **managed（OAuth 登录托管）供应商置顶**：组件内 `[...providers].sort()` 稳定排序，仅展示层，不改 config.toml/SQLite 存储顺序
- **验证**：tsc 零错误

## 二、下一步

1. **等用户测批次 3 的包**（重点：卡片图表图标 → 全屏配置页 → 变量区/超时输入 → 测试查询 → 保存后紧凑行刷新）。用户反馈优先处理。
2. **用户确认后才 `git commit`**（建议拆 3 个 commit 对应批次 1/2/3，提交信息中文 + scope 前缀；排除 `src-tauri/Cargo.toml` 行尾改动）。
3. 后续候选（均待用户拍板，见 §三）：OAuth refresh、NewAPI 面板自动探测、自定义 JS 提取器模板（P3）。

## 三、悬而未决（用户已知情，待决定）

1. **OpenCode Go 账单查询**：~~已实测全部端点 404（`/zen/go/v1/usages`、`/api/usage`、`/api/billing` 等 12+ 路径），cc-switch 源码也不支持 → 结论：无公开 API，不可查~~。**2026-08 推翻**：`GET https://opencode.ai/zen/go/v1/usage`（Bearer + 显式浏览器 UA，否则 Cloudflare 1010 拦截 403）实测 200，已实现为 `plan:opencode_go`（滚动 5h / 周 / 月三窗口）。
2. **Kimi login 配 API key**：可以，代码已支持（api_key 优先于 OAuth）。但 managed 供应商编辑页隐藏 key 输入框（`ProviderEdit.tsx:301` `{!provider.managed && ...}`）。选项：① 用户新建 kimi-coding 预设供应商填 key；② 改 UI 让 managed 显示可选 key 输入。
3. **OAuth refresh**：**已实现**（批次 4）。过期自动用 refresh_token 换新并写回凭据文件；单 flight 锁 + 写回前重读防 CLI 竞态。已知边界：若 access token 未过期但被服务端吊销（罕见），401 不会触发重读重试——暂不处理。
4. **NewAPI 面板自动探测**：打开配置面板时探测 `{base}/api/status` 含 `quota_per_unit` → 自动预选 NewAPI 模板。已提议，未确认。

## 四、关键环境信息

- 项目：`D:\AIGC\KimiSwitch`（Tauri 2 + React 18 + TS + Tailwind + Rust/rusqlite/reqwest），分支 `Dev_20260801`
- 参考项目：`D:\AIGC\cc-switch`（MIT，账单查询功能源头；全屏面板参考其 `src/components/common/FullScreenPanel.tsx`）
- 构建：`npm run tauri-build`（前后端一起，产出 msi+nsis）；`cargo test --lib`（src-tauri 下）；`npx tsc --noEmit`
- 提交信息风格：中文 + scope 前缀（`docs:`/`build:`/`fix:`/`feat:`）
- 用户 NewAPI 站点：`https://ai.codingplan.site`（quota_per_unit=500000，符号 ¤）；Access Token 需网页后台生成（sk- 推理 key 查不了 `/api/user/self`，实测 401）
