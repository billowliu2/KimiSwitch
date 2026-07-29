# 提案：预设供应商 + 供应商账单查询

> **状态**：v0.4-draft（v0.3-draft 已实施；P0 全部落地，新增 v0.4 修订）
> **作者**：Kimi Switch 内部
> **目标版本**：0.6.0
> **参考**：cc-switch（MIT，© Jason Young）— 仅借鉴字段结构与 Rust 用量查询层模式
> **Kimi Code 官方文档**：[providers 配置](https://www.kimi.com/code/docs/kimi-code-cli/configuration/providers.html)、[配置文件](https://www.kimi.com/code/docs/kimi-code-cli/configuration/config-files.html)

---

## 一、背景与目标

当前 Kimi Switch 已有"添加供应商"入口（`src/App.tsx:141 handleAddProvider`）直接凭空造一个 `provider-N`，用户需要手填 base_url、provider_type、模型映射等十几个字段。新用户面对一份空白表单门槛很高。

同时，用量仪表盘（`src/components/dashboard/`）展示的是**本地会话日志**聚合出来的 token 消耗，与"供应商账户里还剩多少钱/套餐还剩多少"完全无关——后者才能告诉用户"今天是不是该充值了"。

**目标**：

1. **预设供应商**：用户点"添加"时弹出预设选择面板，选中后表单字段自动填好（保留任意编辑权）；支持至少 12 条主流国内/海外供应商。
2. **供应商账单查询**：在 `ProviderList` 卡片底部展示余额/套餐剩余，调用供应商鉴权 API 实时拉取。

**非目标**：

- 不做 OAuth 流程（Claude/Codex 官方订阅）—— 我们不接管 CLI 登录态。
- 不做"用户自定义 JS 脚本"查询（rquickjs 依赖过重）。
- 不做用量费用看板（已有本地仪表盘）。

---

## 二、参考：cc-switch 关键事实

### 2.1 预设供应商

- **位置**：纯前端 TS 数组，`src/config/*ProviderPresets.ts`，按目标 CLI 工具拆 8+1 个文件，每文件 22–73 条。
- **数据契约**（`claudeProviderPresets.ts:25-74`）：
  - `name / nameKey(i18n) / websiteUrl / apiKeyUrl`
  - `settingsConfig`（真正写进配置的对象，**结构因工具而异**：Claude 用 `ANTHROPIC_*` env、Codex 用 auth.json + TOML）
  - `category`: `official | cn_official | third_party | aggregator`
  - `isOfficial / isPartner / primePartner`
  - `apiKeyField`(Claude 特有)、`endpointCandidates[]`、modelsUrl
  - `theme / icon / iconColor / apiFormat`
- **触发**：`ProviderForm` 表单顶部内嵌 `ProviderPresetSelector`（grid 按钮 + 搜索 + 排序）；选中即 `form.reset` 灌字段。
- **模型清单来源**：硬编码写进 `settingsConfig.env` 或 `modelCatalog[]`；**不**走 models.dev，**不**在预设里调 API。动态拉模型是另一个独立按钮。
- **许可证**：MIT，可直接借鉴字段结构与预设数据。

### 2.2 账单/用量查询

cc-switch 在 Rust 端实现了 6 套并行的查询层（详见 `src-tauri/src/services/`），与本项目相关的有 2 套：

| 机制 | 文件 | 覆盖 | 关键端点 |
|---|---|---|---|
| **A. 余额查询** | `balance.rs` | DeepSeek / StepFun / SiliconFlow / OpenRouter / Novita | `GET {base_url}/user/balance` 等 |
| **B. Token Plan 套餐** | `coding_plan.rs` | **Kimi For Coding** / 智谱 GLM / MiniMax / 火山 / ZenMux | `GET https://api.kimi.com/coding/v1/usages` |

**统一返回契约**（`balance.rs:1-10` 注释）：

```rust
struct UsageResult {
    success: bool,
    data: Option<Vec<UsageData>>,
    error: Option<String>,
}
struct UsageData {
    plan_name: Option<String>,
    remaining: Option<f64>,
    total: Option<f64>,
    used: Option<f64>,
    unit: Option<String>,
    is_valid: Option<bool>,
    resets_at: Option<String>,
}
```

**错误通道语义**（这套设计很成熟，建议照搬）：

- `Err(_)` = 瞬时失败（网络/超时/读体中断）→ 前端 retry + keep-last-good。
- `Ok(success:false)` = 确定性失败（空 key / 401 / 非 2xx / JSON 解析失败）→ 直接透出错误文案。

**鉴权**：统一 `Authorization: Bearer <api_key>`。

**路由**：`detect_provider(base_url)` 按子串匹配 → 调对应 `query_xxx`。

---

## 三、KimiSwitch 落点

| 现有结构 | 落点 |
|---|---|
| `src/App.tsx:141 handleAddProvider`（直接造空 `provider-N`）| 改为先打开 `PresetPickerModal` |
| `src/components/ProviderEdit.tsx` basic tab | 顶部加"切换预设"下拉（v1 不做） |
| `src-tauri/src/models.rs Provider` | 不动；预设转 Provider 由前端完成 |
| `src-tauri/src/commands.rs` | 新增 `query_provider_usage(base_url, api_key, usage_kind)` |
| `src-tauri/src/`（无 `services/`）| 新建 `services/{mod.rs, usage_types.rs, balance.rs, coding_plan.rs}` |
| `src/components/ProviderList.tsx` 卡片 | 卡片底部新增 `<UsageFooter>` |
| `src/i18n/{zh,en}.ts` | 加 i18n key（preset 名 / 账单相关） |
| `src/lib/models-dev.ts` | 复用：补全预设 model 的 `maxContextSize` / `capabilities` |

**已有依赖**（已满足）：

- `Cargo.toml`: `reqwest = { version = "0.12", features = ["json","rustls-tls","stream"] }` ✅
- `Cargo.toml`: `chrono = { version = "0.4", features = ["serde"] }` ✅

**私有字段存储约定**（**重要变更：v0.3 修订**）：

早前提议把 `usageKinds` 写进 `provider.raw_other["kimi-switch.usageKinds"]` 通过 `config.toml` 透传。**此方案否决**——`kimi-switch.` 前缀不是 Kimi Code 注册的 namespace，"安全"只是 Zod 非 strict + raw 透传的实现现状，无版本兼容承诺。

**v0.3 改为：**

- `usageKinds` 存进 **SQLite** 的 `settings` 表（已有 per-agent 设置表，key 形式 `usage_kinds:<provider_name>`，值为 JSON 数组字符串，如 `["balance:deepseek"]` 或 `["plan:kimi_coding","balance:custom"]`）
- `load_agent_config_command` 在返回 config 时**自动合并** SQLite settings 中的 usageKinds 到每个 provider（前端消费时是无感的）
- Rust 端导出 `config.toml` 时**完全不写** `usageKinds` 字段
- 卸载 / 退出登录 / 备份 `config.toml` 都不影响 `usageKinds`（独立存储）

**优势**：

1. 不污染用户的 Kimi Code 配置（终审 A8 解决）
2. 用户改 `provider_type` / `base_url` 后，Rust 端 `detect_provider(base_url)` 自动重新决定 `usageKinds`（B-D1 解决）
3. 旧用户升级 0.6.0 时，所有匹配 `detect_provider` host 列表的 provider **自动获得** `usageKinds`（B-D2 解决）
4. 数组形式让同一 provider 同时支持套餐 + 余额查询（如 SiliconFlow 未来加套餐）

---

## 四、方案 1：预设供应商

### 4.1 数据模型

新建 `src/config/providerPresets.ts`：

```ts
export interface ProviderPreset {
  /** 唯一 key，作为默认 Provider name 使用，如 "deepseek" */
  id: string;
  /** 显示名（中文/英文） */
  name: string;
  /** i18n key，可选；存在时优先用 t(nameKey) */
  nameKey?: string;
  /** 官网/拿 key 的链接 */
  websiteUrl?: string;
  apiKeyUrl?: string;
  /** 分类：排序 & 标签 */
  category: "official" | "cn_official" | "third_party" | "aggregator" | "custom";
  /** 真正写进 Provider 的字段 */
  providerType: ProviderType;
  /** 预设 base_url；`null` 表示无默认值（如 Anthropic、CodingPlan.site）。
   *  当选中的 provider.type 对应的 `defaultBaseUrl()` 返回非空时，
   *  PresetPicker 会**用预设值覆盖它**，保存后以 `provider.base_url` 为唯一真相。 */
  baseUrl: string | null;
  /** 复用现有 IconPicker 命名（无品牌图标时按 base_url 走首字母兜底） */
  icon?: string;
  iconColor?: string;
  /** 预填的模型映射（alias → model id）。
   *  数组第一个 ⇒ 设 default_model。
   *  数组为空时，default_model 留空，由用户通过「拉取模型」补齐。
   *
   *  **alias 强制规范**：`provider/${modelId}` 形式 —— 例如 `deepseek/deepseek-chat`。
   *  不能用裸 alias（如 `chat`），否则会破坏 `handleDuplicateProvider` 的
   *  `alias.slice(name.length)` 推导：若 provider=`copy`，会得到空串，
   *  复制时所有模型都写到 `copy` 上，后者覆盖前者。 */
  models: Array<{
    alias: string;
    model: string;
    /** 可选：覆写显示名；缺省走 models.dev 推导 */
    displayName?: string;
    /** 可选：覆写 context；缺省走 models.dev [API→models.dev→正则] 三级 */
    maxContextSize?: number;
    /** 默认 ["thinking"] */
    capabilities?: string[];
  }>;
  /** 关联方案 2：账单查询类型；缺省时不查。
   *  **v0.3 改为数组**：同一个供应商可能同时支持套餐 + 余额（如 SiliconFlow
   *  既有平台余额又有套餐），数组形式让两端都查、UI 都展示。
   *  注意：`plan:volcengine` **不在 v1 union** —— Volcengine 套餐需独立 AK/SK
   *  （不是推理 api_key），需要额外的 `access_key_id / secret_access_key` 参数，
   *  v1 不支持，留待 P2。 */
  usageKinds?: ReadonlyArray<
    | "balance:deepseek" | "balance:siliconflow" | "balance:openrouter"
    | "balance:stepfun" | "balance:novita"
    | "plan:kimi_coding" | "plan:zhipu" | "plan:minimax"
  >;
}
export const providerPresets: ProviderPreset[] = [ /* … */ ];
```

**`presetToProviderAndModels()` 显式转换契约**（v0.3 重要补充）：

```ts
export function presetToProviderAndModels(preset: ProviderPreset, options: {
  existingProviderNames: Set<string>;
  existingModelAliases: Set<string>;
}): {
  provider: Provider;
  models: Model[];
  defaultModel: string;  // 用于写入 config.default_model
  usageKinds: ReadonlyArray<string> | undefined;  // 用于写入 SQLite settings
} {
  // Provider.name 冲突 → 追加 -2 / -3
  let name = preset.id;
  let n = 2;
  while (options.existingProviderNames.has(name)) name = `${preset.id}-${n++}`;

  // 模型 alias 冲突 → 追加 -2 / -3
  const models: Model[] = preset.models.map((m, i) => {
    let alias = `${name}/${m.model}`;  // 强制规范
    let k = 2;
    while (options.existingModelAliases.has(alias)) alias = `${name}/${m.model}-${k++}`;

    // max_context_size 4 级优先级
    const ref = modelsDevRef(m.model);
    const maxContextSize =
      m.maxContextSize
      ?? ref?.maxContextSize
      ?? parseContextFromName(m.model)
      ?? DEFAULT_MAX_CONTEXT_SIZE;  // 256000

    return {
      alias,
      provider: name,
      model: m.model,
      max_context_size: maxContextSize,
      display_name: m.displayName ?? ref?.displayName ?? alias,
      capabilities: m.capabilities ?? ref?.capabilities ?? ["thinking"],
      supports_1m: maxContextSize >= 1_000_000,
      raw_other: {},
    };
  });

  const provider: Provider = {
    name,
    provider_type: preset.providerType,
    base_url: preset.baseUrl,
    api_key: null,  // 用户补
    env: {},
    note: null,
    official_url: preset.websiteUrl ?? null,
    managed: false,
    enabled: true,
    icon: preset.icon ?? null,
    icon_color: preset.iconColor ?? null,
    raw_other: {},
  };

  return {
    provider,
    models,
    defaultModel: models[0]?.alias ?? "",
    usageKinds: preset.usageKinds,
  };
}
```

**字段映射表**（明确每条字段从哪来）：

| Preset 字段 | Provider/Model 字段 | 备注 |
|---|---|---|
| `providerType` | `provider.provider_type` | 直透 |
| `baseUrl` | `provider.base_url` | `null` → 留空 |
| `websiteUrl` | `provider.official_url` | |
| `icon` | `provider.icon` | `null` → 走首字母兜底 |
| `iconColor` | `provider.icon_color` | |
| `models[].alias` | `models[].alias` | **强制 `${uniqueProviderName}/${modelId}`** |
| `models[].model` | `models[].model` | 直透 |
| `models[].displayName` | `models[].display_name` | 缺省走 models.dev |
| `models[].maxContextSize` | `models[].max_context_size` | 优先级链 |
| `models[].capabilities` | `models[].capabilities` | 缺省 `["thinking"]` |
| `id` | `provider.name` | 冲突 → `-2` |
| `usageKinds` | SQLite `settings` 表 | **不**写 `config.toml`；数组形式支持同一供应商多种查询 |

### 4.2 v1 预设清单（15 条）

| id | 供应商 | category | provider_type | base_url | icon | iconColor | usageKinds | 备注 |
|---|---|---|---|---|---|---|---|---|
| `anthropic` | Anthropic 官方 | official | anthropic | `null` | `anthropic` | — | — | 无默认 base_url；Kimi Code 自动走 `api.anthropic.com` |
| `kimi-coding` | Kimi Code 托管服务（会员订阅）| official | **kimi** | `https://api.kimi.com/coding/v1` | `kimi` | — | `[plan:kimi_coding]` | Kimi Code 托管服务走 `kimi` 类型（OpenAI 兼容 + Kimi identity headers + 视频上传）。Base URL 同时兼容 Anthropic 协议 `https://api.kimi.com/coding/`，但 preset 用 OpenAI 兼容路径 |
| `moonshot` | Moonshot Platform API（按量付费）| cn_official | **kimi** | `https://api.moonshot.ai/v1` | `kimi` | — | — | Moonshot 平台 API 密钥用户；官方文档明确 `kimi` 类型默认 base_url 即此（与 `.cn` 互为别名） |
| `deepseek` | DeepSeek | cn_official | openai | `https://api.deepseek.com/v1` | `deepseek` | — | `[balance:deepseek]` | — |
| `zhipu` | 智谱 GLM | cn_official | openai | `https://open.bigmodel.cn/api/paas/v4` | `zhipu` | — | `[plan:zhipu]` | — |
| `zai` | z.ai（智谱海外）| third_party | openai | `https://api.z.ai/api/paas/v4` | `zhipu` | — | `[plan:zhipu]` | — |
| `bailian` | 阿里百炼 | cn_official | openai | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `bailian` | — | — | — |
| `minimax` | MiniMax | cn_official | openai | `https://api.minimaxi.com/v1` | `minimax` | — | `[plan:minimax]` | — |
| `stepfun` | StepFun（阶跃星辰）| cn_official | openai | `https://api.stepfun.com/v1` | `stepfun` | — | `[balance:stepfun]` | — |
| `siliconflow` | 硅基流动 | cn_official | openai | `https://api.siliconflow.cn/v1` | `siliconflow` | 显式补色（默认灰色）| `[balance:siliconflow]` | `siliconflow` 在 `src/icons/extracted/index.ts:93` 有 SVG，但 `metadata.ts` 没有；需显式 `iconColor` |
| `novita` | Novita AI | third_party | openai | `https://api.novita.ai/v3` | `novita` | — | `[balance:novita]` | 注意 `/v3`（非 `/v1`） |
| `openrouter` | OpenRouter | third_party | openai | `https://openrouter.ai/api/v1` | `openrouter` | — | `[balance:openrouter]` | — |
| `openai` | OpenAI 官方 | official | openai | `https://api.openai.com/v1` | `openai` | — | — | — |
| `google-genai` | Google AI Studio | official | google-genai | `https://generativelanguage.googleapis.com` | `google` | — | — | — |
| `volcengine` | 火山方舟（仅推理）| cn_official | openai | `https://ark.cn-beijing.volces.com/api/v3` | `huoshan` | — | — | **v1 不支持套餐查询**（需 AK/SK），仅作推理 fallback |

**`codingplan`（自定义中转）v1 不做 preset**——价值低（无 base_url、无 usageKinds），与预设"一键填表"目标冲突。改在 `PresetPickerModal` 底部保留独立的"**+ 自定义配置**"按钮（来自空表单），与 cc-switch `ProviderPresetSelector.tsx:392-404` 一致。

**预估 icon 字段值校核**：上面表的 `icon` 值均来自 `src/icons/extracted/index.ts` 真实存在的 key；不能使用 `brands.ts` 推断 key 作显式 icon（两者命名空间不同）。P0 实现时若发现某个 key 不存在，需在 `src/icons/extracted/index.ts` 补 entry。

**模型清单里的 `maxContextSize` / `capabilities` 优先级**（与拉取模型同一体系）：

1. 预设内置值（`ProviderPreset.models[].maxContextSize / capabilities / displayName` — 若有）
2. `src/lib/models-dev.ts` 快照查找（`getModelRef`）
3. 正则兜底（`src/lib/model-defaults.ts`）
4. 全部 miss → **`DEFAULT_MAX_CONTEXT_SIZE`**（`src/lib/model-defaults.ts:1,83-89` 实际为 **256000**，不是 128000）

> v0.3 修正：早期文档误写 128000；统一用 `DEFAULT_MAX_CONTEXT_SIZE` 常量，避免双源真相。

**预设里绝大多数模型只需放 `alias` + `model id`**；仅对 models-dev 快照无覆盖的新发模型（如国产首发）才填覆写字段。

### 4.3 UI 流程

**入口 A（v1 必做）`PresetPickerModal`**：

```
┌────────────────────────────────────────────────┐
│ 选择预设供应商                              [X] │
├────────────────────────────────────────────────┤
│ 🔍[搜索]                    [排序:原始│A-Z]    │
├────────────────────────────────────────────────┤
│ [K] Kimi Coding  [官方]                        │
│ [A] Anthropic    [官方]                        │
│ [D] DeepSeek     [国产]                        │
│ [Z] 智谱 GLM     [国产]                        │
│ …(grid 150px×n)                                │
│ [+自定义配置]                                   │
├────────────────────────────────────────────────┤
│ 预设只是一键填表，后续可继续修改所有字段。       │
└────────────────────────────────────────────────┘
```

- 触发：① "添加"按钮 ② 顶部"+ 添加供应商"
- 选中预设后：
  1. 用预设 `id` 作为默认 `Provider.name`（冲突时尾部追加 `-2`、`-3`…）
  2. 把 `models[]` 转成 `Model` 加进 `config.models`，**每个 alias 逐一检测冲突**：alias 已存在 → 尾部追加 `-2` / `-3`；**第一个 model** 设为 `default_model`（经过去重后的 alias）
  3. 写入 `provider.raw_other["kimi-switch.usageKinds"] = usageKinds`（沿用 raw_other 私有字段约定）
  4. 跳到 `ProviderEdit` 让用户填 `api_key`（其余字段已预填）
- 分类徽章：官方 = 蓝、国产 = 绿、第三方 = 灰、聚合 = 紫
- 网格自适应：`repeat(auto-fill, minmax(140px, 1fr))`，参考 cc-switch `ProviderPresetSelector.tsx:392`

**入口 B（v2，可选）`ProviderEdit` 顶部"切换预设"下拉**：对已存在但想换预设的供应商也能用。

### 4.4 持久化约定

- **name 由预设 id 派生**，用户可后续在表单里改名（不要锁）。
- **`usageKinds` 存进 SQLite settings 表**（key: `usage_kinds:<provider_name>`，值为 JSON 数组），不写进 `config.toml`。详见 §三"私有字段存储约定"。
- **不使用** `raw_other` 存 usageKinds（v0.3 修订：避免污染 Kimi Code 配置 + 支持 Rust 端自动 host detect）。

---

## 五、方案 2：供应商账单查询

### 5.1 Rust 端

```
src-tauri/src/
├── services/
│   ├── mod.rs              // pub use + 统一入口
│   ├── usage_types.rs      // UsageResult / UsageData
│   ├── balance.rs          // 余额类（5 家）
│   └── coding_plan.rs      // 套餐类（5 家）
└── commands.rs             // +#[tauri::command] query_provider_usage
```

**usage_types.rs**（**注意必须加 camelCase** —— 缺它前端 `resetsAt/planName/isValid` 全部错位）：

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageData {
    pub plan_name: Option<String>,
    pub remaining: Option<f64>,
    pub total: Option<f64>,
    pub used: Option<f64>,
    pub unit: Option<String>,
    pub is_valid: Option<bool>,
    pub resets_at: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageResult {
    pub success: bool,
    pub data: Option<Vec<UsageData>>,
    pub error: Option<String>,
}
```

> **与 cc-switch 真实结构的差异**（重要）：cc-switch 的 `UsageData` 在 `provider.rs:282-314` 还含 `extra: Option<Value>` / `invalid_message: Option<String>`，**没有** `resets_at`（该字段在 `SubscriptionQuota.tiers[].resets_at`）。本方案**不"照抄"**，而是把套餐的 `tiers` 展平成数组 + 每项带 `resets_at` 字段，统一前端消费面。`SubscriptionQuota → UsageData[]` 的转换规则实现时需明确（每个 tier 一条 `UsageData`，`plan_name = tier.name`，`used/total/remaining/unit` 视情况映射）。

**balance.rs / coding_plan.rs**：直接 port cc-switch 实现的 5 家 + 5 家（~670 行 + ~2200 行）。重点实现：

- `detect_provider(base_url) -> Option<...>`：按子串匹配
- `query_xxx(api_key) -> Result<UsageResult, String>`：分别处理 401、读体失败、解析失败
- **读体失败和解析失败要区分**：先 `bytes().await` 拿到完整字节再 `serde_json::from_slice`（见 balance.rs:99-108 的注释，reqwest `.json()` 把读体错也包成 decode，会丢信息）

**command.rs 新增**（**v0.3 修订 + v0.4 落实**：传 `provider_name` 让 Rust 端从 config 加载 key 与 usageKinds，避免 IPC 序列化 key）：

```rust
#[tauri::command]
pub async fn query_provider_usage(
    agent: Agent,           // v0.4 落实：项目 config 按 agent 隔离，必须传
    provider_name: String,
    force_refresh: Option<bool>,  // true = 跳过 5min 缓存
) -> Result<UsageResult, String> {
    // 1. 从 config / SQLite 加载该 provider
    // 2. 如果 api_key 为空 → 自动 fallback 到 provider.env 里的
    //    expected_api_key_key(provider_type) 对应 key（v0.4 落实）
    // 3. 读取 usageKinds: 优先 SQLite 显式设置（JSON 数组）→ fallback detect_provider(base_url) → success:false "unknown provider"
    // 4. 对每个 kind 路由到对应 query_xxx，合并所有结果到一个 UsageData[]
    // 5. 返回 UsageResult（data 含全部 kind 的条目）
}
```

**v0.4 重要**：Rust 端除 `provider.api_key` 外，**会兜底读取 `provider.env` 里的 `expected_api_key_key(provider_type)`**（如 Kimi 平台期望 `KIMI_API_KEY`）。这只读 env 用于实际查询，**不**写回 config.toml，给只配 env 不配 api_key 的用户兜底。

**重要**：前端**不**传 `api_key` / `usage_kind` / `base_url`。Rust 端统一从配置加载，杜绝：
- API key 经 IPC 序列化（终审 D4）
- 前端绕过 host 校验乱发请求（终审 D1）
- Rust detect 与前端规则矛盾（终审 D2）

**Tauri 配置文件注册**（**v0.3 修订**：Rust reqwest 不走 Tauri HTTP plugin，不需 capability）：

1. `commands.rs` 加 `#[tauri::command]` ✅
2. `lib.rs` 的 `tauri::generate_handler![…]` 追加 `query_provider_usage`
3. `capabilities/default.json` **无需改动**（现有 `test_connectivity` 同样用 Rust reqwest，不需 HTTP scope）

**Tauri config**：`reqwest::get` 是 Rust 端发出，**不**走 WebView 网络栈，**不**需要改 CSP。

### 5.2 前端

**ProviderList 卡片底部的 `<UsageFooter>`**：

```
┌────────────────────────────────────────┐
│ Kimi For Coding         [使用中]        │
│ 默认: kimi-k2.7-code    3 models        │
├────────────────────────────────────────┤
│ ⚡ 35% 已使用  · 5h 后重置   [刷新]    │  ← 套餐类（green/orange/red）
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│ DeepSeek               [使用中]        │
│ 默认: deepseek-chat     2 models        │
├────────────────────────────────────────┤
│ 💰 余额 ¥12.34              [刷新]    │  ← 余额类
└────────────────────────────────────────┘
```

- 配色：<70% 绿 / 70-89% 橙 / ≥90% 红（对齐 cc-switch）
- **多 kind 渲染**：同一 provider 的 `usageKinds` 数组可能含多种（如 `[plan:kimi_coding, balance:custom]`）；`UsageData[]` 每条独立渲染为一行，余额类显金额、套餐类显百分比+倒计时
- 倒计时：前端 JS 算 `new Date(resetsAt) - Date.now()`，按区间显示"5h 后重置 / 3d 后重置"（绝对时间，Rust 端已转 ISO 8601，不依赖时区）
- 缓存：**5min stale TTL**（`force_refresh` 跳过）+ Manual 刷新（**v0.3 修订**：与 cc-switch `queries.ts:245-277` 对齐）。进入 ProviderList 时对有 usageKinds 的供应商并发查一次，**最多同时 3 个请求**（`Promise.allSettled` + 简易信号量），单请求超时 8 秒
- 错误：网络错"网络异常"、401"API Key 无效"、其他"查询失败" —— 不阻塞主界面
- 没 `usageKinds` 字段（undefined 或空数组）→ **完全不显示 footer，不发起任何请求**

**状态机**（每个 provider 独立维护）：

| 当前状态 | 触发 | 行为 |
|---|---|---|
| `idle` | 首次进入 ProviderList | → `loading`（并发 ≤3） |
| `loading` | 响应到达 | `ok` → `success`；`err` → `error` |
| `success` | 用户点「刷新」 | → `loading`，保留上一次 `data` 做 ghost 展示 |
| `error` | 用户点「重试」 | → `loading` |
| `success`/`error` | 缓存超 30s，重新进入列表 | 自动 → `loading` |
| 任何 | 用户清空 `api_key` | → `idle`（不发起请求，见 §5.1 命令层检查） |

**渲染**：

- `loading`：骨架屏或上次数据的半透明 ghost
- `success`：余额/百分比 + 配色 + 重置倒计时
- `error`：红色错误提示 + 「重试」按钮
- `idle`：无（不渲染 UsageFooter）

**触发与权限**（**v0.3 修订**）：

- 启动时**不**预查
- 进入 ProviderList 视图时并发查 1 次（≤3 并发，8s 超时）
- 用户点"刷新"按钮才再次查（5min stale TTL）
- 全局开关：设置面板加"启动账单查询"开关，关闭后 Rust 端拒绝查询（默认开启）
- **前端不做 usageKinds 决策**：单纯 `invoke("query_provider_usage", { provider_name: "deepseek" })`，Rust 端返回 `success: false` 时客户端仅展示错误，不做 host 校验

### 5.3 与现有"用量仪表盘"的关系

- **现有仪表盘**：本地 SQLite 聚合的 token 计数 + 费用估算（基于 `models.dev` 价格）
- **新增账单查询**：供应商侧的余额/套餐
- **不重复**：仪表盘 chip 区域不显示余额，余额只在 ProviderList 卡片底部
- **联动**：可选地（v2）在仪表盘 KPI 加一个"供应商侧配额"卡，但 v1 不做

---

## 六、里程碑

| 阶段 | 内容 | 优先级 |
|---|---|---|
| **P0** | 方案 1：15 条预设 + `PresetPickerModal` + App 入口接入 | P0 |
| **P0** | 方案 2 骨架：`services/{usage_types,mod}.rs` + `query_provider_usage` 命令 + `UsageResult` + **camelCase 序列化** | P0 |
| **P0** | `query_provider_usage` 两层注册（commands.rs + lib.rs；**无 capabilities 变更**） + Rust 端 mock 测试 | P0 |
| **P0** | SQLite 改造：`usage_kinds:<provider>` 存 settings 表（JSON 数组）；`load_agent_config_command` 合并回 config；export 时不写 usageKinds | P0 |
| **P0** | `detect_provider(base_url)` 启发式：迁移期旧用户自动获得 usageKinds | P0 |
| **P0** | 方案 2 前端：`<UsageFooter>` + 卡片接入 + 错误处理 + 配色 + 状态机 + 5min stale TTL | P0 |
| **P0** | **套餐类 v1：Kimi For Coding（`api.kimi.com/coding/v1/usages`）**（项目主题，优先） | P0 |
| **P0** | 余额类 v1：DeepSeek / SiliconFlow / OpenRouter（3 家） | P0 |
| **P0** | 前端手工验证 checklist（见 §十一 #20） | P0 |
| **P1** | 套餐类补全：智谱 GLM / MiniMax | P1 |
| **P1** | 余额类补全：StepFun / Novita | P1 |
| **P2** | `ProviderEdit` 顶部"切换预设"下拉（入口 B） | P2 |
| **P2** | 设置面板"启动账单查询"开关 | P2 |
| **P2** | 倒计时 i18n 友好格式化（"5小时后" / "in 5h"） | P2 |
| **P2** | Volcengine 套餐查询（独立 AK/SK 支持 + UI） | P2 |
| **P3** | 自定义 JS 脚本兜底（usage_script.rs + rquickjs） | P3 |
| **P3** | 仪表盘 KPI 加"供应商侧配额"卡 | P3 |

---

## 七、许可证与引用

cc-switch 是 MIT（`D:/AIGC/cc-switch/LICENSE`），Rust 实现（`balance.rs` / `coding_plan.rs`）可直接移植；预设数据（base_url、模型 id 等公开信息）不构成版权客体。

**文件头添加**：

```rust
// Adapted from cc-switch (MIT, © Jason Young)
// https://github.com/farion1231/cc-switch
```

**README 致谢段补一条**：

> 供应商预设结构与余额/套餐查询实现参考自 [cc-switch](https://github.com/farion1231/cc-switch)（MIT，© Jason Young）。

**配置文件同步**：preset 名 i18n key 同样放 `src/i18n/{zh,en}.ts`。

---

## 八、风险与待确认

| 风险 | 缓解措施 | 状态 |
|---|---|---|
| 预设的 `id` 与用户已存在的 `provider.name` 冲突 | `presetToProviderAndModels()` 内 `while` 循环追加 `-2` / `-3` | ✅ |
| 模型 alias 冲突 | 强制 alias = `${name}/${modelId}`，冲突追加 `-2` / `-3` | ✅ |
| 裸 alias 破坏 `handleDuplicateProvider` | **强制规范**（§4.1 转换契约）；`src/App.tsx:271` `alias.slice` 改造为 `startsWith` 显式判断 + 完整 re-prefix fallback（v0.4 落实） | ✅ |
| `usageKinds` 漂移（TS 端枚举与 Rust 端 enum 各自维护） | TS 端 enum + Rust 端 enum 各自声明；TS 端在 dev 模式加载 `providerPresets.ts` 时对每个 preset 的 usageKinds 做运行时断言（v0.4 新增 `SUPPORTED_USAGE_KINDS` Set + `import.meta.env.DEV` guard） | ✅（dev-only 断言）|
| Zhipu/MiniMax 的套餐端点可能限频 | 5min stale TTL + 失败 keep-last-good；网络错误自动 retry | ✅ |
| Kimi For Coding 套餐鉴权：官方文档已确认 `kimi` 类型 + `Authorization: Bearer <sk-...>` 即可，与 cc-switch 实现一致 | ✅ 已核验（[官方 providers 文档](https://www.kimi.com/code/docs/kimi-code-cli/configuration/providers.html)）| ✅ |
| StepFun / Novita 的 base_url 匹配与现有 OpenAI 兼容克隆冲突 | `detect_provider` 在 `detect_provider_openai` 之前调用 | ✅ |
| `defaultBaseUrl` 与预设 base_url 双方有值 | 预设的 baseUrl **覆盖** `default_base_url()`；保存时以 `provider.base_url` 为唯一真相 | ✅ |
| provider 改 `base_url` / `provider_type` 后旧 usageKinds 错路由 | usageKinds 不显式存 provider 字段，Rust 端每次 `query_provider_usage` 重新 `detect_provider(base_url)` | ✅ |
| 旧用户升级 0.6.0 后无 usageKinds | Rust 端 `detect_provider(base_url)` 启发式作为 fallback，自动识别 DeepSeek / SiliconFlow / OpenRouter / StepFun / Novita / Kimi Coding / 智谱 / MiniMax | ✅ |
| API key 暴露：当前 edit UI 已持有明文 key，IPC invoke 序列化 key 是"再次"暴露面 | command 改为 `provider_name`，Rust 端从 config 加载 key，**不**经 IPC 传 key。错误/调试日志中严禁输出 key | ✅ |
| Tauri capability 是否需要 | Rust reqwest 不走 Tauri HTTP plugin，无 capability 变更需求 | ✅ |
| `usageKinds` 写进 config.toml 污染 Kimi Code 配置 | 存 SQLite settings 表（JSON 数组），export 时不写 | ✅ |
| 限额与套餐 UI 区分 | 按 `plan_name` 判断：`five_hour` / `weekly_limit` → 百分比+倒计时；其他 → 余额数值 | ✅ |
| Pi 与 KimiCode 同名 provider 共享 UsageFooter 缓存造成串扰 | v0.4 落实：模块级 cache key 改为 `${agent}:${providerName}`（UsageFooter.tsx:36） | ✅ |
| 用户用 env 配 key 但 `api_key` 字段为空 | v0.4 落实：Rust 端 `query_provider_usage` 兜底读 `provider.env[expected_api_key_key(provider_type)]` | ✅ |

---

## 九、需要在开始前确认的决策点

**状态标签说明**：
- ✅ `代码已核验` —— 已对照源码确认可行
- 🟡 `产品决策` —— 已选，但落地细节随实现调整
- 🟠 `待真实 API 实测` —— 需真实 key 实测后才能标完成
- ⚪ `待用户确认` —— 文档中给了倾向，但需用户最终决定

1. ✅ **预设触发方式**：先做入口 A（独立弹窗）。入口 B 推迟到 P2。
2. 🟡 **预设的模型 maxContextSize / capabilities**：靠 models.dev 推导 + 预设可选覆写字段（§4.1 已明确 4 级优先级）。
3. 🟡 **账单查询触发**：首次进入自动查（≤3 并发）+ 5min stale TTL + 刷新/重试按钮。
4. 🟡 **Kimi For Coding 套餐**：P1（先 P0 跑通后再做）。
5. ✅ **自定义 JS 脚本**：不做（rquickjs 过重）。
6. 🟡 **预设 v1 清单**：15 条（不含 volcengine 套餐 + codingplan），够用。
7. ✅ **usageKinds 持久化**：SQLite settings 表（JSON 数组，v0.3 修订），不写 config.toml。
8. ✅ **kimi-coding preset 的 `provider_type`**：用 **`type: "kimi"`** + `base_url: "https://api.kimi.com/coding/v1"`。**官方文档已确认**：`kimi` 类型 = "对接 Moonshot AI 的 OpenAI 兼容接口，包括 Kimi Code 托管服务 + Kimi Platform API 密钥"。`moonshot` preset 同样用 `kimi` 类型（之前误写 `openai`，已修）。
9. ⚪ **Volcengine 套餐 v1 不做的取舍**：v1 仅保留 volcengine 推理预设，去掉套餐查询。是否可接受？

**用户实标 ✅ 决议后的项目**（待用户回复 8/9 后）：

---

## 十、附录：cc-switch 借鉴到的关键代码位置

- `src/config/claudeProviderPresets.ts:25-74` — `ProviderPreset` 接口
- `src/config/codexProviderPresets.ts:13-46` — `CodexProviderPreset` 接口（带 modelCatalog）
- `src/components/providers/forms/ProviderPresetSelector.tsx:142-500` — Reference UI
- `src/components/providers/forms/ProviderForm.tsx:1794-1899` — `handlePresetChange` 字段注入逻辑
- `src-tauri/src/services/balance.rs:1-454` — 余额查询完整实现（5 家）
- `src-tauri/src/services/coding_plan.rs:100-206` — Kimi For Coding 单家实现
- `src-tauri/src/provider.rs` — `UsageResult` / `UsageData` 类型定义
- `docs/user-manual/en/2-providers/2.5-usage-query.md` — 设计语义文档（中文版同路径）

---

## 十一、自审发现的问题（v0.1 → v0.2 已修正）

> 本节是第一轮自审发现的问题。v0.2 已全部修正或记录到正文 / §八风险表 / 对应章节。
>
> 第三轮审核额外发现 20 项（6 阻塞 + 7 类型/语义 + 7 逻辑/边界），已直接修入正文，不在此重复。关键修正：
> - B1 「baseUrl: string → string | null」已修正（§4.1）
> - B2 「category 缺少 custom」已补（§4.1）
> - B3 「model alias 冲突检测」已补（§4.3 步骤 2）
> - B5 「三层注册清单」已补（§5.1）
> - B6 「并发控制 ≤3」已补（§5.2）
> - L1 「icon 补齐」已在 §4.2 表为预设加 `icon` 字段（值由 P0 实现时从现有 IconPicker 名映射表中读取）
> - L2 「models-dev 缺失回退 4 级优先级」已补（§4.2 底部）
> - L3 「状态机」已补（§5.2）
> - L5 「空 api_key 拒绝」已补（§5.1 命令层）
> - S4 「models 数组为空」已补（§4.1 注释）

| # | 问题 | 状态 |
|---|---|---|
| 1 | **预设 `id` 与已有 provider.name 冲突** | ✅ §4.4 已解决 |
| 2 | **usageKinds 写进 raw_other 会进 config.toml** | ✅ §三 私有字段持久化约定已明确 `kimi-switch.` 命名空间 |
| 3 | **默认 base_url 来源双源** | ✅ §八·风险 #7 + §4.1 baseUrl 注释 |
| 4 | **TS 端 usageKinds 与 Rust 端 enum 漂移** | ✅ §八·风险 #2 |
| 5 | **Kimi For Coding 鉴权格式未实测** | ✅ §八·风险 #5：P1 前 curl 验证 |
| 6 | **StepFun/Novita base_url 与 OpenAI clone 冲突** | ✅ §八·风险 #6 |
| 7 | **倒计时 i18n 友好格式化** | → §六 P2 |
| 8 | **账单查询全局开关** | → §六 P2 |
| 9 | **入口 B 切换预设** | → §六 P2 |
| 10 | **model 字段名 vs Kimi Code 识别** | 核验后确认：`[models.alias]` 块与 `[providers.name]` 块独立，无冲突风险 ✅ |
| 11 | **图标名 → IconPicker 映射表** | → P0 实现时补 |
| 12 | **设置面板账单查询开关分组** | → §六 P2：放"设置"Tab 同一分组 |
| 13 | **模型 alias 命名规范** | ✅ §4.1 已明确 `provider/model` 形式 |
| 14 | **Moonshot 无余额 API → 不显示 footer** | ✅ §5.2：无 usageKinds = 不渲染 |
| 15 | **OpenAI 协议选择 `openai`** | ✅ 不暴露 `openai_responses` 让用户困惑 |
| 16 | **多端点候选 v1 不做** | ✅ |
| 17 | **extra_usage 字段简化** | ✅ §5.1 只留 `UsageData[]` |
| 18 | **is_valid: false 透出** | ✅ §5.1 类型已含 |
| 19 | **跨会话缓存 v1 不做** | ✅ 30s TTL 够用 |
| 20 | **测试覆盖 P0 必须** | ✅ 已加回 §六里程碑 |

---

*文档结束 — v0.4-draft（v0.3 已实施 + v0.4 落实 4 项收尾：handleDuplicateProvider 兼容老 alias / UsageFooter cache 加 agent / dev 模式跨端断言 / env 兜底读 key）。配套人工回归清单见 [VERIFICATION-CHECKLIST.md](./VERIFICATION-CHECKLIST.md)。*
