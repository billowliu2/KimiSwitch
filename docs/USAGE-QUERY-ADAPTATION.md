# 账单查询（用量查询）适配调研报告

> 调研日期：2026-07-31
> 调研范围：`D:\AIGC\cc-switch`（参考实现）、`D:\AIGC\KimiSwitch`（当前项目）、OpenCode（sst/opencode）订阅套餐定义、Kimi / 智谱官方用量查询 API
> 状态：调研完成，未动代码

---

## 1. 结论速览

- **KimiSwitch 的账单查询不是空白**：已移植 cc-switch 的「余额查询（Balance）+ 套餐查询（Coding Plan）」两大块，共 **8 种 `usageKinds`**，Rust 侧闭环 + `UsageFooter` 展示，错误通道、keep-last-good、缓存、`detect_provider` 自动识别等核心设计均与 cc-switch 对齐。
- **OpenCode 本身不提供账单/额度查询**。它只负责"定义"供应商与订阅套餐的接入方式（provider id、base URL、认证、模型清单，数据源为 models.dev），"套餐还剩下多少"需要查各家官方 API——这正是 cc-switch（及 KimiSwitch 已移植部分）做的事。
- **本次调研发现 2 个值得补的能力缺口**：
  1. **Kimi 开放平台余额查询**（`GET https://api.moonshot.cn/v1/users/me/balance`，Kimi 官方 2026-07 新增公开 API，cc-switch 尚未实现）→ **KimiSwitch 也缺**。
  2. **OpenCode Go 订阅套餐额度**（5h / 周 / 月 三窗口）→ 无公开查询 API，只有控制台，暂不可程序化。
- 其余缺口（ZenMux / 火山方舟 / 智谱团队版 / JS 脚本引擎 / 官方 OAuth 订阅）为 cc-switch 独有能力，与"做好现有账单查询"的目标匹配度分层，见 §6 路线。

---

## 2. 现状盘点：KimiSwitch 已实现的账单查询

### 2.1 架构

```
ProviderList (前端)
  └─ UsageFooter ── invoke("query_provider_usage", { agent, providerName, forceRefresh })
                     └─ Rust commands.rs:590 ── services::query_kind(kind, base_url, api_key)
                                                ├─ balance.rs      （余额，5 家）
                                                └─ coding_plan.rs  （套餐，3 家）
```

- 前端**永不持有 API key、不直连 HTTP**；所有请求在 Rust 侧用 reqwest 完成（无浏览器 CORS 问题）。
- `Provider.usageKinds`（前端 `src/config/providerPresets.ts` 预设字段）→ 保存时写入 SQLite settings `usage_kinds:<provider_name>`（`commands.rs:152`）→ 加载时 `merge_usage_kinds`（`commands.rs:33`），缺失时按 base_url host 自动 `detect_provider`。
- TS/Rust 双端枚举防漂移：`SUPPORTED_USAGE_KINDS` 运行时断言（`providerPresets.ts:563`）检查预设的 `usageKinds` 都在 Rust `UsageKind` 覆盖内。

### 2.2 已有能力对照表

| UsageKind | 供应商 | 端点 | 认证 | 实现 |
|---|---|---|---|---|
| `balance:deepseek` | DeepSeek | `GET https://api.deepseek.com/user/balance` | Bearer | ✅ |
| `balance:siliconflow` | SiliconFlow (.cn/.com) | `GET https://api.siliconflow.cn\|.com/v1/user/info` | Bearer | ✅ |
| `balance:openrouter` | OpenRouter | `GET https://openrouter.ai/api/v1/credits` | Bearer | ✅ |
| `balance:stepfun` | StepFun | `GET https://api.stepfun.com/v1/accounts` | Bearer | ✅ |
| `balance:novita` | Novita AI | `GET https://api.novita.ai/v3/user/balance`（÷10000 转 USD） | Bearer | ✅ |
| `plan:kimi_coding` | **Kimi For Coding** | `GET https://api.kimi.com/coding/v1/usages` | Bearer | ✅ |
| `plan:zhipu` | **GLM Coding Plan**（bigmodel.cn / z.ai） | `GET {open.bigmodel.cn\|api.z.ai}/api/monitor/usage/quota/limit` | **Raw key（无 Bearer）** | ✅ |
| `plan:minimax` | MiniMax Token Plan (.com/.io) | `GET https://api.minimaxi.com\|.io/v1/api/openplatform/coding_plan/remains` | Bearer | ✅ |

已有预设（`providerPresets.ts`）：`kimi-coding`（`plan:kimi_coding`）、`zhipu-coding` / `zai-coding`（`plan:zhipu`）、`minimax` / `minimax-token-plan`（`plan:minimax`）、`deepseek` / `stepfun` / `siliconflow` / `novita` / `openrouter`（余额）。

### 2.3 统一返回契约（Rust → 前端）

`src-tauri/src/services/usage_types.rs`（camelCase serde）：

```ts
interface UsageData {
  planName?: string | null;   // 套餐名：five_hour / weekly_limit
  remaining?: number | null;  // 余额：金额（balance）或剩余百分比（plan）
  total?: number | null;      // 总量（plan 恒为 100）
  used?: number | null;       // 已用百分比 0-100（plan）
  unit?: string | null;       // CNY / USD / %
  isValid?: boolean | null;
  resetsAt?: string | null;   // ISO 8601 重置时间
}
interface UsageResult { success: boolean; data?: UsageData[] | null; error?: string | null; }
```

错误通道语义（与 cc-switch 一致）：`Err`（invoke reject）= 瞬时失败（网络/超时，前端重试 + 保留 last-good）；`Ok(success:false)` = 确定性失败（无 key / 401 / 非 2xx / 坏 JSON，立即透出并清 last-good）。实现要点：**先 `bytes()` 再 `serde_json::from_slice`** 以区分读体失败（瞬时）与解析失败（确定性）。

---

## 3. OpenCode 如何"定义" Kimi / 智谱订阅套餐（重点）

### 3.1 OpenCode 的 provider 体系

OpenCode（sst/opencode）通过 `~/.config/opencode/opencode.json` 的 `provider` 段注册供应商，用 AI SDK + **Models.dev** 提供 75+ 提供商。一个"订阅套餐"在 OpenCode 里不是一个独立概念，而是**一组 provider 定义 + 模型引用**：

| provider id | 对应产品 | 默认 base URL（API 端点） | 说明 |
|---|---|---|---|
| `zhipuai` | **GLM Coding Plan**（订阅） | `https://open.bigmodel.cn/api/coding/paas/v4` | 套餐专属端点，与按量 PaaS 端点不同 |
| `zai` | z.ai（按量） | `https://api.z.ai/api/paas/v4` | |
| `kimi` | **Kimi For Coding**（订阅） | `https://api.kimi.com/coding/v1` | OpenAI 兼容；Anthropic 兼容为 `https://api.kimi.com/coding/` |
| `moonshot` | Moonshot / Kimi 开放平台（按量） | `https://api.moonshot.ai/v1`（国际） | 国内站 `api.moonshot.cn/v1` |
| `opencode-zen` | OpenCode Zen（充值余额） | `https://opencode.ai/zen/v1` | 按量 |
| `opencode-go` | **OpenCode Go**（$10/月订阅） | `https://opencode.ai/zen/go/v1` | 5h/周/月 额度 |

关键事实：
- **套餐与按量是不同 provider id、不同 base URL**（`zhipuai` vs `zai`；`kimi` vs `moonshot`）。`/connect` 时按选择的 provider 存 key。
- 认证均为 API Key（多数 `Authorization: Bearer`）；智谱 Coding Plan 的额度查询**不含 Bearer**（见 §4.2）。
- **模型清单来自 Models.dev**（OpenCode 编译内置），模型 id 形如 `zhipuai/glm-5.2`、`moonshotai/kimi-k2.7-code`；OpenCode Go 的模型走独立命名空间 `opencode-go/<model>`（如 `opencode-go/kimi-k3`），其额度不消耗各家套餐，只消耗 Go 的 5h/周/月窗口。

### 3.2 OpenCode Go 套餐额度（当前 opencode.ai 官方数据）

来源：[opencode.ai/docs/go](https://opencode.ai/docs/go/)

| 窗口 | 额度 |
|---|---|
| 5 小时 | $12 用量 |
| 每周 | $30 用量 |
| 每月 | $60 用量 |

额度按美元计费价值计算（不同模型折算请求数不同）。超出限额后可选"Use balance"回退到 Zen 余额。

**查询方式：仅控制台（console），无公开 REST API**。OpenCode 项目本身不做用量查询（无 usage/billing 命令），社区工具（如 cc-switch 的 `usage_script`）也无法覆盖 Go 套餐——这是目前的技术边界，适配时只能提示用户"网页控制台查看"或把 Go 归入"不可查询"类。

### 3.3 OpenCode 定义 → KimiSwitch 预设的对应关系

KimiSwitch 的 `providerPresets.ts` 已镜像这套体系（`baseUrl` 与 OpenCode 一致）：

| KimiSwitch 预设 | baseUrl | billingMode | usageKinds | 备注 |
|---|---|---|---|---|
| `kimi-coding` | `https://api.kimi.com/coding/v1` | subscription | `plan:kimi_coding` | ✅ 可查套餐 |
| `zhipu-coding` | `https://open.bigmodel.cn/api/coding/paas/v4` | subscription | `plan:zhipu` | ✅ 可查套餐 |
| `zai-coding` | `https://api.z.ai/api/coding/paas/v4` | subscription | `plan:zhipu` | ✅ 可查套餐 |
| `opencode-go` | `https://opencode.ai/zen/go/v1` | subscription | **（空）** | ❌ 不可查，见 §4.4 |
| `opencode-zen` | `https://opencode.ai/zen/v1` | pay_as_you_go | **（空）** | ❌ 不可查 |
| `moonshot` | `https://api.moonshot.ai/v1` | pay_as_you_go | **（空）** | ❌ 未挂余额查询，见 §4.3 |

---

## 4. 各订阅 / 余额查询 API 详细方案

### 4.1 Kimi For Coding 套餐（✅ 已实现，无需改动）

- **端点**：`GET https://api.kimi.com/coding/v1/usages`
- **认证**：`Authorization: Bearer <kimi-code-api-key>`（Kimi Code 控制台签发，与开放平台 key 不互通）
- **响应**（cc-switch 实测 + 社区验证）：

```json
{
  "limits": [
    { "detail": { "limit": 100, "remaining": 40, "resetTime": 1754000000000 } }
  ],
  "usage": { "limit": 1000, "remaining": 900, "resetTime": "2026-08-01T00:00:00Z" }
}
```

- **解析**（`coding_plan.rs::parse_kimi_coding`）：`limits[].detail` → 5 小时窗口（5h 滚动，`resetTime` 毫秒）；`usage` → 周限额。`used = limit - remaining`，换算百分比。
- 官方端点确认：Kimi Code 文档服务地址 `https://api.kimi.com/coding/v1`（OpenAI 协议），模型 ID `kimi-for-coding`。

### 4.2 GLM Coding Plan 套餐（✅ 已实现，无需改动）

- **端点**：`GET https://open.bigmodel.cn/api/monitor/usage/quota/limit`（国内）/ `GET https://api.z.ai/api/monitor/usage/quota/limit`（海外）
- **认证**：`Authorization: <api-key>` —— **裸 key，不带 `Bearer` 前缀**（cc-switch 实测；智谱官方 `glm-plan-usage` 插件 `query-usage.mjs` 同样如此）
- **响应**：

```json
{
  "success": true,
  "data": {
    "level": "pro",
    "limits": [
      { "type": "TOKENS_LIMIT", "percentage": 35, "unit": 3, "nextResetTime": 1754000000000 },
      { "type": "TOKENS_LIMIT", "percentage": 80, "unit": 6, "nextResetTime": 1754500000000 }
    ]
  }
}
```

- **解析**（`coding_plan.rs::parse_zhipu`）：只取 `type == "TOKENS_LIMIT"` 的条目；`unit: 3` → 5 小时窗口，`unit: 6` → 每周窗口（缺失时按 `nextResetTime` 升序启发式兜底）；`percentage` 即已用百分比。
- **套餐等级**（Lite / Pro 等）在 `data.level`，当前实现未透出（`UsageData` 无该字段，可后续扩展）。

### 4.3 Kimi 开放平台余额（❌ 未实现 —— 建议新增，优先级 P0）

**这是本次调研最重要的新发现**。Kimi 官方 2026-07 新增公开余额 API（[platform.kimi.com/docs/api/balance](https://platform.kimi.com/docs/api/balance)），cc-switch 也尚未实现（issue [#4455](https://github.com/farion1231/cc-switch/issues/4455) 提议中）。

- **端点**：`GET https://api.moonshot.cn/v1/users/me/balance`
- **认证**：`Authorization: Bearer <MOONSHOT_API_KEY>`
- **响应**：

```json
{
  "code": 0,
  "data": {
    "available_balance": 49.58894,   // 可用余额 CNY（= 现金 + 代金券）
    "voucher_balance": 46.58893,     // 代金券余额
    "cash_balance": 3.00001          // 现金余额（可为负，欠费）
  },
  "scode": "0x0",
  "status": true
}
```

- 业务错误：`code != 0` 或 `status == false` → 确定性失败。
- **适配点**：`moonshot` 预设 baseUrl 为 `https://api.moonshot.ai/v1`（国际站），而该端点固定 `api.moonshot.cn`（国内站）。需按 base_url 消歧：host 含 `moonshot.cn` → 查 CN 端点；`moonshot.ai` → 查 `https://api.moonshot.ai/v1/users/me/balance`（国际站对应端点，待实测确认；官方文档仅给出 CN 示例）。
- 新增 `balance:kimi` kind 即可复用现有 balance 路径，前端 `UsageFooter` 自动生效（余额形态显示 `💰 余额 ¥49.59`）。

### 4.4 OpenCode Go / Zen（❌ 未实现 —— 无公开 API，建议标注"不可查"）

- **Go 套餐**：额度窗口见 §3.2，仅控制台可看；`opencode.ai/zen/go/v1` 只有推理端点（`/chat/completions`、`/responses`、`/models`），**无 usage/balance 端点**。
- **Zen 余额**：充值制，同样仅控制台。
- **可选替代（不推荐投入）**：通过调用推理端点时服务端返回的 402/429/额度错误头做被动感知，无法拿到数值，价值低。
- **适配结论**：`opencode-go` / `opencode-zen` 预设维持 `usageKinds` 为空；可在预设 `note`/UI 上提示"额度请在 opencode.ai 控制台查看"。

### 4.5 其他 cc-switch 独有、KimiSwitch 未移植的能力（按目标匹配度排序）

| 能力 | cc-switch 实现 | KimiSwitch | 匹配度与建议 |
|---|---|---|---|
| 通用 JS 脚本引擎（custom/general/newapi） | `usage_script.rs`（rquickjs）+ `UsageScriptModal` | ❌ | 覆盖"任意中转站"，工程量大（新增 rquickjs 依赖 + ~1000 行引擎）；若"现有账单查询"只服务已知供应商则非必须。**若要支持 new-api/one-api 类中转站，可优先用声明式配置方案替代**（见 §6 P2） |
| ZenMux 套餐 | `coding_plan.rs::query_zenmux`（base_url 即查询端点，Bearer） | ❌ | 简单可搬（~50 行 + 测试），P1 |
| 火山方舟 Coding Plan | `coding_plan.rs::query_volcengine`（AK/SK 签名 V4 变体，控制面网关） | ❌ | 中等（~200 行签名逻辑，照搬注释坑位），P1 |
| 智谱团队版 | `query_zhipu_team`（`bigmodel-organization`/`bigmodel-project` header） | ❌ | 需前端表单存组织/项目 ID + Rust 凭据扩展，P2 |
| 官方订阅额度（Claude/Codex/Gemini/Grok OAuth） | `subscription.rs` / `subscription_grok.rs`（读 CLI 凭据文件） | ❌ | 与 KimiSwitch 目标 CLI（Kimi Code / Pi）不匹配，**不建议** |
| GitHub Copilot / Codex-OAuth / xAI-OAuth 配额 | 自管 OAuth | ❌ | 同上，**不建议** |
| 托盘用量摘要 + UsageCache 事件桥 | `tray.rs` + `usage_cache.rs` | ❌ | KimiSwitch 托盘无用量入口，低价值 |

### 4.6 盘点中新发现的「订阅预设但不可查」项

| 预设 | billingMode | 现状 | 说明 |
|---|---|---|---|
| `stepfun-plan`（StepFun Plan） | subscription | `usageKinds` 为空 | StepFun Plan 走 `https://api.stepfun.com/step_plan/v1` 推理端点；**未发现公开的套餐用量查询 API**（cc-switch 也无）。`balance:stepfun` 查的是按量账户余额（`/v1/accounts`），两者不互通。标注"不可查"即可 |
| `bailian`（阿里云百炼） | pay_as_you_go | `usageKinds` 为空 | 百炼 2026-07 上线 Coding Plan（专属 key 格式 `sk-sp-`，按**调用次数**扣额度，与 token 无关）；官方文档仅提供"控制台 Coding Plan 页面查看"，**未发现公开查询 API**。预留为待跟踪项（套餐上线早期，API 可能随后开放） |
| `moonshot`（Kimi 开放平台） | pay_as_you_go | `usageKinds` 为空 | → 即 P0 的 `balance:kimi`，见 §4.3 |

### 4.7 NewAPI / OneAPI 类中转站账单查询（本次重点调研）

**背景**：用户使用自建 NewAPI 中转站（实测 `https://ai.codingplan.site`，`sk-` API Key 验证有效）。结论先行：

1. **`sk-` API Key 查不了余额**（实测 401）。NewAPI 站点的**管理接口只认「登录 Access Token」**，不认推理令牌。cc-switch 也是这个结论——它的 NEW_API 模板填的不是 `apiKey`，而是 `accessToken` + `userId` 两个独立字段。
2. **参考实现（cc-switch，完整链路）**：
   - 模板代码（`UsageScriptModal.tsx:90`）：`GET {{baseUrl}}/api/user/self`，头 `Authorization: Bearer {{accessToken}}` + **`New-Api-User: {{userId}}`**；extractor 取 `data.quota`、`data.used_quota`，余额 = `quota ÷ 500000`，已用 = `used_quota ÷ 500000`（单位按站点 `quota_per_unit`，实测本站为 500000；`custom_currency_symbol` 决定是 ¥ 还是 $）。
   - 凭据模型（`types.ts UsageScript`）：`accessToken?` / `userId?`，与 `apiKey`、`baseUrl` 并列，存供应商 `meta.usage_script`。
   - 后端占位符替换（`usage_script.rs:413-416`）：`{{accessToken}}` / `{{userId}}` 仅在脚本含对应占位符时替换；查询凭证由 `resolve_script_credentials` 决定（显式值优先，回退供应商配置）。
   - 安全校验（`usage_script.rs`）：**非 custom 模板强制 HTTPS + 与 base_url 同源（host+port）**；custom 模板放开（可任意 HTTPS 域名/HTTP）。
   - 前端表单（`UsageScriptModal.tsx:1154-1230`）：NEW_API 模板下显示 Base URL / Access Token（密码框带显隐）/ User ID 三个输入；模板切换联动清理多余字段。
3. **本站在 cc-switch 下的配置方式**：新建 Claude/Codex 供应商 → 开启用量查询 → 选 NEW_API 模板 → 填 `https://ai.codingplan.site`（Base URL）+ 网页后台 Access Token + 数字用户 ID。实测确认该站 `/api/status` 返回 `quota_per_unit: 500000`、`display_in_currency: true`、`custom_currency_symbol: ¤`（金额符号需按站确认）。

### 4.8 NewAPI 适配 KimiSwitch 的落地方案

KimiSwitch 现有 `usageKinds` 枚举是**每家中转站一个 Rust 函数**的路子，不适合任意 NewAPI 站。对照 cc-switch，推荐**声明式配置（不引入 JS 引擎）**：

- **存储**：`Provider` 增加可选 `usageConfig?: { accessToken?: string; userId?: string }`（不写进 TOML，与 `usageKinds` 一样存 SQLite settings `usage_config:<provider_name>`，避免污染 Kimi Code 原生配置）。
- **查询**：新增一个 `UsageKind::BalanceNewApi`（`"balance:newapi"`），Rust 侧 `query_kind` 分支：
  - 端点：`{base_url}/api/user/self`（同源，复用 provider 的 base_url）；
  - 头：`Authorization: Bearer {accessToken}` + `New-Api-User: {userId}`；
  - 解析：`data.quota / data.used_quota` ÷ `quota_per_unit`（从 `/api/status` 拉取，避免硬编码 500000；失败时回退 500000）；
  - 金额符号：`custom_currency_symbol`（未取到默认 ¥）。
- **错误通道**：遵循现有约定（`bytes()` 再解析、瞬时/确定性分离）。
- **前端**：`UsageFooter` 无需改；`ProviderEdit` 在启用 `usageKinds` 含 `balance:newapi` 时显示 Access Token / User ID 输入（参考 cc-switch 表单），或做成独立小弹窗。
- **风险**：`sk-` 用户拿不到 Access Token 时无解（需登录网页后台）；同源校验天然防误查其他站。

## 5. 新增能力实现清单（改动点）

> 实施状态（2026-07-31）：**P0 已实现，未验证、未提交**。
> 展示方案已确认为 **A（供应商卡片底部 UsageFooter，零前端改动）**。
> 改动文件：`src-tauri/src/services/balance.rs`（query_kimi/parse_kimi + 单测）、`src-tauri/src/services/mod.rs`（枚举/路由/detect + 单测）、`src/config/providerPresets.ts`（UsageKind/SUPPORTED_USAGE_KINDS + moonshot 预设挂 `balance:kimi`）。
> 待办：用户确认后 `cargo test` + `tsc` 验证，验证通过再提交。
> 遗留风险：国际站 `api.moonshot.ai/v1/users/me/balance` 端点与币种（按 USD 处理）未实测，见 §4.3。

> 实施状态更新（2026-07-31 晚）：**A + B + C 已全部实现（打包验证中，未提交）**。
> - **A（OAuth）**：新增 `src-tauri/src/oauth.rs`（读 `~/.kimi-code/credentials/kimi-code.json` access_token，过期 30s 缓冲，不做 refresh），`query_provider_usage` 的 managed 分支从"报 API key 错误"改为读 OAuth 凭据走 `plan:kimi_coding` 查询；`managed:kimi-code` 卡片不再显示"API Key 无效"。
> - **B（NewAPI）**：`services/balance.rs` 加 `query_newapi`（`{base_url}/api/user/self` + Bearer accessToken + `New-Api-User` userId，`/api/status` 运行态拉 `quota_per_unit` 与 `custom_currency_symbol`，进程内缓存）；`UsageKind` 加 `BalanceNewApi`（`"balance:newapi"`，ALL 变 10）；`query_kind` 签名加 `usage_config` 参数。
> - **C（配置面板 + 布局）**：新增 `UsageConfigModal.tsx`（启用开关 / 自动检测 vs NewAPI 模板 / 凭据输入 / 自动查询间隔 / 测试按钮，参考 cc-switch UsageScriptModal 但裁剪）；`UsageFooter` 拆分 compact（卡片右上：主摘要 + `x 前` + 刷新）与 detail（底部：多档明细 + 错误/重试）；`ProviderList` 加 BarChart3 配置入口按钮；`usageConfig` 存 SQLite settings（`usage_config:<provider_name>`），不进 config.toml。
> - **验证**：`cargo test` 46 通过（新增 oauth 凭据解析/过期、newapi 解析 5 个用例、UsageKind roundtrip 10 项）、`tsc --noEmit` 零错误；打包供用户测试。
> - **改动文件**：Rust 6 个（oauth.rs 新增、models.rs、commands.rs、services/mod.rs、services/balance.rs、lib.rs）+ 前端 7 个（types/index.ts、UsageConfigModal.tsx 新增、UsageFooter.tsx、ProviderList.tsx、App.tsx、i18n/zh.ts、i18n/en.ts）。

以 **P0：Kimi 开放平台余额（`balance:kimi`）** 为例，完整改动点如下（严格套用现有四步模式，前端展示零改动）：

1. **Rust** `src-tauri/src/services/balance.rs`
   - 新增 `pub async fn query_kimi(api_key: &str, is_cn: bool) -> Result<UsageResult, String>`：
     - 端点：`https://api.moonshot.cn/v1/users/me/balance`（CN）/ `https://api.moonshot.ai/v1/users/me/balance`（EN，待实测）
     - 复用 `get_json(url, key, AuthStyle::Bearer)`；新增 `parse_kimi`：`code == 0 && status == true` 时取 `data.available_balance`，`unit: "CNY"`；`code != 0` 走确定性失败。
   - 单元测试：正常解析 / `code!=0` / 缺字段。
2. **Rust** `src-tauri/src/services/mod.rs`
   - `UsageKind` 加 `BalanceKimi`；`as_str` → `"balance:kimi"`；`ALL` 变 9 项；`FromStr` 匹配；`query_kind` 路由按 host 消歧（`moonshot.cn` → CN，`moonshot.ai` → EN）；`detect_provider` 加 `api.moonshot.cn` / `api.moonshot.ai` host 匹配 + 测试。
3. **前端** `src/config/providerPresets.ts`
   - `UsageKind` union 与 `SUPPORTED_USAGE_KINDS` 各加 `"balance:kimi"`；`moonshot` 预设加 `usageKinds: ["balance:kimi"]`（防漂移断言会强制两侧同步）。
4. **i18n**：无需新 key（`usageBalance` 等已存在）。

若同时做 P1 的 ZenMux / 火山，则除第 3 步外再加预设（`zenmux`、火山套餐基 URL 或 AK/SK 凭据存储）。注意：**火山 / 智谱团队需要 Provider 模型新增凭据字段**（AK/SK、组织/项目 ID），会触及 `models.rs`、`db.rs` 的 SQLite 表结构与前端 `ProviderEdit` 表单，改动面明显更大，建议单独排期。

---

## 6. 建议路线

| 优先级 | 事项 | 改动面 | 工作量 | 风险 |
|---|---|---|---|---|
| **P0** | Kimi 开放平台余额 `balance:kimi` | balance.rs + mod.rs + providerPresets.ts | 小（~1 天） | 低；EN 端点待实测 |
| P1 | ZenMux 套餐（照搬 cc-switch） | coding_plan.rs + mod.rs + 预设 | 小 | 低 |
| P1 | 火山方舟 Coding Plan（AK/SK 签名 V4） | coding_plan.rs + 凭据存储 + 表单 | 中 | 签名细节易错，需单测 |
| P2 | 智谱团队版 | coding_plan.rs + 凭据存储 + 表单 | 中 | 需扩展 Provider 凭据 |
| **P1** | **NewAPI 中转站余额 `balance:newapi`**（§4.8 声明式方案：`usageConfig{accessToken,userId}` + `/api/user/self`） | balance.rs + mod.rs + db 存储 + ProviderEdit 表单 | 中 | 需用户提供 Access Token；站点 quota_per_unit/符号需运行态拉取 |
| P3 | JS 脚本引擎（custom/general） | usage_script.rs 移植（rquickjs） | 大 | 覆盖面广但工程量大；被 `balance:newapi` 声明式方案覆盖主场景后可暂缓 |
| P3 | 官方 OAuth 订阅 / 托盘用量 | — | 大 | 与目标 CLI 不匹配，建议不做 |
| P3 | 查询请求走代理（见 §6.1） | balance.rs 共用 Client 改造 | 小-中 | 依赖全局代理设置是否已存在 |

### 6.1 遗漏盘点（首轮调研未覆盖，本次补查确认）

1. **代理支持缺失（建议 P1-P2）**：KimiSwitch 的 `balance.rs::get_json` 每次新建 `reqwest::Client`，**没有配置代理**；cc-switch 的 `crate::proxy::http_client::get()` 继承全局代理。用户若经代理访问海外站（SiliconFlow.com / z.ai / OpenRouter / Novita / api.moonshot.ai），账单查询会直连失败。适配时建议把 Client 构造提升为共用函数并支持代理（项目已依赖 reqwest，无新增依赖）。
2. **无自动轮询（P3 可选）**：cc-switch 有 `autoQueryInterval` + react-query 轮询 + 托盘摘要；KimiSwitch 的 `UsageFooter` 仅在挂载时查询 + 手动刷新。低价值（窗口额度重置倒计时可手动刷新），不做不影响正确性。
3. **智谱套餐等级未透出（P3 可选）**：`data.level`（Lite/Pro）已在响应中但 `UsageData` 无字段承接；如需展示需扩契约。
4. **多 agent 已覆盖**：`UsageFooter` 挂在两个 agent（Kimi Code / Pi）的 `ProviderList`，cacheKey 含 agent，无遗漏。
5. **相关文档衔接**：项目已有 `docs/PROPOSAL-presets-and-usage.md`、`docs/VERIFICATION-CHECKLIST.md` 随功能迭代更新；本文档为独立调研稿，实施时按项目约定把改动项回写上述文档。

> 说明：以上为调研结论与建议，尚未实现任何代码；若确认方向，可先落 P0。

---

## 7. 风险与坑位备忘

1. **智谱裸 key**：`monitor/usage/quota/limit` 的 `Authorization` 不带 `Bearer`，且要带 `Content-Type: application/json`、`Accept-Language`（cc-switch 实测）。
2. **Kimi 三套凭据不互通**：Kimi 开放平台（开放平台 key）、Kimi Code（`api.kimi.com/coding` 专属 key）、Kimi 会员是三个独立产品，余额/权益/key 均不通用（官方 FAQ 确认）——UI 文案需区分"开放平台余额"与"For Coding 套餐"。
3. **base_url 消歧**：SiliconFlow `.cn/.com`、MiniMax `.com/.io`、智谱 `bigmodel.cn/z.ai`、Kimi 开放平台 `moonshot.cn/.ai` 均靠 host 子串区分；`detect_provider` 命中即注入，注意别把 `api.kimi.com`（非 `/coding` 路径）误判为套餐。
4. **响应读体与解析分离**：所有查询先 `bytes()` 再 parse，保持瞬时/确定性错误通道不混淆（已统一在 `balance.rs::get_json`）。
5. **金额单位**：Novita ×0.0001 USD；Kimi 余额为 CNY；Go 套餐按 USD 计。
6. **TS/Rust 枚举漂移**：新增 kind 必须同时改 `UsageKind` union + `SUPPORTED_USAGE_KINDS` + Rust 枚举三处，否则 dev 断言报错。
7. **NewAPI 特有点（§4.7 实测）**：`sk-` API Key 与 Access Token 是两套凭据，前者**查不了** `/api/user/self`；`New-Api-User` 头必须带；余额 = `quota/used_quota ÷ quota_per_unit`（本站 500000）；`quota` 为 0 常表示该令牌"无限额度"（后台设置），不要显示成余额为 0。
8. **NewAPI 同源**：`/api/user/self` 与推理同源（同一 base_url host），天然可复用车基地址；若经代理访问站点，`/api/status` 也要走代理（见 §6.1 代理改造）。

---

## 8. 附：OpenCode 预设"获取 API Key"推荐链接检查（2026-07-31）

用户反馈：OpenCode 预设的"获取 API Key"链接没有走自己的推荐链接。排查结果如下：

| 预设 | 字段 | 当前值 | 是否带推荐码 |
|---|---|---|---|
| `opencode-go` | `websiteUrl` | `https://opencode.ai/go?ref=DFCNADQCEM` | ✅ 带 `ref=DFCNADQCEM` |
| `opencode-go` | `apiKeyUrl` | `https://opencode.ai/go?ref=DFCNADQCEM` | ✅ 带 `ref=DFCNADQCEM` |
| `opencode-zen` | `websiteUrl` | `https://opencode.ai/zen/` | ❌ **不带 ref** |
| `opencode-zen` | `apiKeyUrl` | `https://opencode.ai/zen/` | ❌ **不带 ref** |

- 位置：`src/config/providerPresets.ts:417-458`（`opencode-go` / `opencode-zen` 两个预设）。
- 渲染链路：`src/components/ProviderEdit.tsx:325` —— 编辑页"获取 API Key"按钮 = `preset?.apiKeyUrl ?? provider.official_url`；预设选择后即带出该 URL。
- 历史：`ref=DFCNADQCEM` 于 v0.6.2（提交 `bee981a` "OpenCode Go/Zen 预设"）加入 `opencode-go`；`opencode-zen` 自始未带 ref。
- 结论：推荐链接确认为 `https://opencode.ai/go?ref=DFCNADQCEM`（用户确认）。`opencode-go` 预设两处均已带该 ref，无需改动；**`opencode-zen` 的 `apiKeyUrl` 已修复**为推荐链接（`websiteUrl` 保持 `https://opencode.ai/zen/` 官网展示不变），这样两个 OpenCode 预设的"获取 API Key"入口都走推荐链接。

---

## 9. 参考资料

- Kimi 开放平台余额 API：https://platform.kimi.com/docs/api/balance
- Kimi Code 文档（服务地址 / 环境变量 / 错误参考）：https://www.kimi.com/code/docs/ 、 https://www.kimi.com/code/docs/kimi-code-cli/configuration/env-vars.html
- Kimi 帮助中心（余额与用量、会员权益）：https://www.kimi.com/zh-cn/help/kimi-api/api-balance-and-usage 、 https://www.kimi.com/zh-cn/help/kimi-code/membership-guide
- 智谱 GLM Coding Plan 额度 API（cc-switch issue 社区确认）：https://github.com/farion1231/cc-switch/issues/1588 、 https://github.com/seakee/CPA-Manager-Plus/issues/379
- NewAPI / OneAPI `/api/user/self` 接口（社区文档）：https://juejin.cn/post/7493007002832551988 、 https://allinone.apifox.cn/399558528e0 、 https://docs.laozhang.ai/faq/balance-query-api
- NewAPI 用户管理文档：https://www.newapi.ai/zh/docs/guide/feature-guide/admin/user
- 实测站点：`https://ai.codingplan.site`（`/api/status`：quota_per_unit=500000、display_in_currency=true）
- Kimi 余额查询（cc-switch issue，官方 API 引入）：https://github.com/farion1231/cc-switch/issues/4455
- OpenCode Go 套餐额度：https://opencode.ai/docs/go/
- OpenCode providers / 配置：https://opencode.ai/docs/providers/
- cc-switch 源码（MIT）：`src-tauri/src/services/balance.rs`、`src-tauri/src/services/coding_plan.rs`、`src-tauri/src/usage_script.rs`
- KimiSwitch 现有实现：`src-tauri/src/services/{mod,balance,coding_plan,usage_types}.rs`、`src/config/providerPresets.ts`、`src/components/UsageFooter.tsx`
