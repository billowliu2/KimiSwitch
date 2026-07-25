# Kimi Code 全局配置面板设计

## 背景

Kimi Code CLI 的 `~/.kimi-code/config.toml` 包含大量全局设置：`[thinking]`、`[loop_control]`、`[background]`、`[[permission.rules]]`、`[[hooks]]` 等。当前 Kimi Switch 只暴露了 `providers` 和 `models` 的可视化编辑，其他全局配置只能通过"配置 JSON"标签页手动修改，不够便捷。

## 目标

1. 在 Kimi Code 选项卡的供应商编辑页面（`ProviderEdit`）中，"模型映射"标签页下方新增一个"全局配置"面板，用图形化控件快速编辑上述 Kimi Code 全局设置。
2. 根据模型 ID 自动为新添加/发现的模型设置默认 `max_context_size`，全局默认值为 256000，具体模型按可扩展的键值对表格匹配。

模型级的 `max_context_size` 已在模型映射表格中实现，用户仍可手动覆盖自动默认值。

## 设计

### 位置

- 组件：`src/components/ProviderEdit.tsx`
- 仅在 `agent === "kimi_code"` 时显示。
- 位于"模型映射"标签页的内容区域内，在模型映射表格和"+ 添加模型映射"按钮的下方。
- 垂直排列，超出区域高度时由页面滚动条处理。

### 分组与控件

面板按功能分为 5 张卡片：

#### 卡片 1：思考模式 `[thinking]`

| 控件 | 字段 | 说明 |
| --- | --- | --- |
| 复选框 | `enabled` | 是否默认开启思考 |
| 分段按钮 | `effort` | 思考强度：`low` / `medium` / `high` / `max` |
| 复选框 | `keep` | 是否保留历史思考内容（`"all"` 或关值） |

- 思考等级和保留思考内容仅在"启用思考"勾选时可用，禁用时置灰。
- "保留思考内容"未勾选时，写入 `[thinking].keep = false`（不能省略，否则 CLI 会回退到默认值 `"all"`）。
- 卡片底部小字提示："启用思考会占用更多上下文，请确保模型上下文长度和预留空间足够。"

#### 卡片 2：循环控制 `[loop_control]`

| 控件 | 字段 | 说明 |
| --- | --- | --- |
| 数字输入框 | `max_retries_per_step` | 单步失败后最大重试次数，默认 3 |
| 数字输入框 | `reserved_context_size` | 预留给模型输出的 token 数，单位 token |

#### 卡片 3：后台任务 `[background]`

| 控件 | 字段 | 说明 |
| --- | --- | --- |
| 数字输入框 | `max_running_tasks` | 同时运行的最大后台任务数 |
| 复选框 | `keep_alive_on_exit` | 会话关闭时是否保留后台任务 |

#### 卡片 4：权限规则 `[[permission.rules]]`

- 可添加/删除的规则列表，默认空列表。
- 每行包含：
  - **处置** 下拉框：`allow` / `deny` / `ask`
  - **模式** 输入框：如 `Read`、`Bash(rm -rf*)`
  - **删除** 按钮
- 提供"添加常用规则"快捷入口，可一键插入：
  - `allow` + `Read`
  - `deny` + `Bash(rm -rf*)`

#### 卡片 5：生命周期钩子 `[[hooks]]`

- 可添加/删除的钩子列表，默认空列表。
- 每行包含：
  - **事件** 下拉框：常见事件如 `PreToolUse` / `PostToolUse`，也可手动输入其他事件
  - **匹配器** 输入框：如 `Bash`
  - **命令** 输入框：如 `node ~/.kimi-code/hooks/check-bash.mjs`
  - **超时** 数字输入框（秒）
  - **删除** 按钮

### 样式

- 卡片容器：`bg-[#16161a] border border-[#2a2a2e] rounded-xl p-4`
- 卡片间距：`gap-4`
- 卡片标题：`text-gray-400 text-sm font-medium mb-3`
- 表单项：`flex items-center gap-4 flex-wrap`
- 数字输入框宽度：`w-32`
- 禁用状态：文字 `text-gray-600`，按钮不可交互

### 字段默认值

当 `raw_other` 中不存在对应表时，控件按以下默认值展示：

| 配置块 | 字段 | UI 默认值 |
| --- | --- | --- |
| `[thinking]` | `enabled` | `true` |
| `[thinking]` | `effort` | `"medium"` |
| `[thinking]` | `keep` | `"all"`（勾选） |
| `[loop_control]` | `max_retries_per_step` | `3` |
| `[loop_control]` | `reserved_context_size` | `50000` |
| `[background]` | `max_running_tasks` | 空（不写入） |
| `[background]` | `keep_alive_on_exit` | `false` |
| `[[permission.rules]]` | — | 空列表 |
| `[[hooks]]` | — | 空列表 |

数字输入框允许清空，表示不写入配置文件，由 Kimi Code CLI 使用其内置默认值。

### 数据流

- `App.tsx` 向 `ProviderEdit` 传入：
  - `agent`
  - `rawOther`（即 `config.raw_other`）
  - `updateRawOther: (updater: (rawOther: unknown) => unknown) => void`
- `ProviderEdit` 中新增内部子组件 `AgentSettingsPanel`，封装所有全局配置 UI。
- 新增 TypeScript 类型（`src/types/index.ts`）：
  - `ThinkingConfig`
  - `LoopControlConfig`
  - `BackgroundConfig`
  - `PermissionRule`
  - `Hook`
  - `AgentSettings`
- 新增 helper（`src/components/AgentSettingsPanel.tsx` 或 `src/lib/agent-settings.ts`）：
  - `getAgentSettings(rawOther: unknown): AgentSettings`
  - `setAgentSettings(rawOther: unknown, patch: Partial<AgentSettings>): unknown`
  - 统一从 `raw_other` 中读取/写入 `[thinking]`、`[loop_control]`、`[background]`、`[[permission.rules]]`、`[[hooks]]`。
- 后端无需改动：这些顶层表原本就通过 `Config.raw_other` 在导入/导出时保留。

### 模型默认上下文长度

在新增模型（手动添加、一键设置、从 API 发现模型）时，根据模型 ID 自动推荐 `max_context_size`。

- 默认回退值：`256000`
- 匹配方式：按模型 ID 字符串进行不区分大小写的正则前缀/全名匹配（代码中使用 `/pattern/i`），命中第一条规则即返回。
- 规则表（按匹配优先级排列）：

| 匹配规则（不区分大小写） | `max_context_size` | 说明 |
| --- | --- | --- |
| **国内模型（优先）** | | |
| `^kimi-for-coding$` | `262144` | Kimi Code 官方托管模型 |
| `^kimi-k2\.5` | `256000` | Kimi K2.5 系列 |
| `^kimi-k2` | `256000` | Kimi K2 系列 |
| `^kimi-` | `256000` | 其他 Kimi 模型 |
| `^glm-5\.2` | `1000000` | GLM-5.2 |
| `^glm-5\.1` | `256000` | GLM-5.1 |
| `^glm-5` | `256000` | GLM-5 系列 |
| `^glm-4` | `128000` | GLM-4 / GLM-4-Plus / GLM-4-Flash |
| `^glm-` | `128000` | 其他 GLM 模型 |
| `^MiniMax-M3` | `1000000` | MiniMax-M3 |
| `^MiniMax-Text-01` | `400000` | MiniMax-Text-01 |
| `^MiniMax-` | `256000` | 其他 MiniMax 模型 |
| `^qwen2\.5` | `128000` | 通义千问 Qwen2.5 系列 |
| `^qwen-max` | `128000` | 通义千问 Max |
| `^qwen-plus` | `128000` | 通义千问 Plus |
| `^qwen-turbo` | `128000` | 通义千问 Turbo |
| `^qwen-coder` | `128000` | 通义千问 Coder |
| `^qwen-` | `128000` | 其他通义千问模型 |
| `^deepseek-r1` | `64000` | DeepSeek-R1 |
| `^deepseek-v3` | `64000` | DeepSeek-V3 |
| `^deepseek-coder` | `64000` | DeepSeek-Coder |
| `^deepseek-` | `64000` | 其他 DeepSeek 模型 |
| `^hunyuan-pro` | `32000` | 腾讯 Hunyuan Pro |
| `^hunyuan-standard` | `32000` | 腾讯 Hunyuan Standard |
| `^hunyuan-lite` | `32000` | 腾讯 Hunyuan Lite |
| `^hunyuan-` | `32000` | 其他 Hunyuan 模型 |
| `^doubao-pro` | `128000` | 字节 Doubao Pro |
| `^doubao-lite` | `128000` | 字节 Doubao Lite |
| `^doubao-vision` | `128000` | 字节 Doubao Vision |
| `^doubao-` | `128000` | 其他 Doubao 模型 |
| `^ernie-4\.0` | `128000` | 百度文心 4.0 |
| `^ernie-3\.5` | `128000` | 百度文心 3.5 |
| `^ernie-speed` | `128000` | 百度文心 Speed |
| `^ernie-lite` | `128000` | 百度文心 Lite |
| `^ernie-` | `128000` | 其他文心模型 |
| `^spark-v4` | `32000` | 讯飞星火 V4 |
| `^spark-v3\.5` | `32000` | 讯飞星火 V3.5 |
| `^spark-pro` | `32000` | 讯飞星火 Pro |
| `^spark-max` | `32000` | 讯飞星火 Max |
| `^spark-` | `32000` | 其他星火模型 |
| `^sensechat-` | `128000` | 商汤 SenseChat |
| `^baichuan-4` | `128000` | 百川 Baichuan 4 |
| `^baichuan-3` | `128000` | 百川 Baichuan 3 |
| `^baichuan-` | `128000` | 其他百川模型 |
| `^yi-` | `128000` | 零一万物 Yi 系列 |
| **国际模型** | | |
| `^claude-opus` | `200000` | Claude Opus 系列（多数版本为 200K；Claude 4 部分版本可达 1M，这里取保守值） |
| `^claude-sonnet` | `200000` | Claude Sonnet 系列 |
| `^claude-haiku` | `200000` | Claude Haiku 系列 |
| `^claude-` | `200000` | 其他 Claude 模型 |
| `^gpt-4\.1` | `1047576` | GPT-4.1 系列（1M tokens） |
| `^gpt-4o` | `128000` | GPT-4o 系列 |
| `^gpt-4-turbo` | `128000` | GPT-4 Turbo |
| `^gpt-4-` | `128000` | 其他 GPT-4 模型 |
| `^gemini-2\.0-flash` | `1048576` | Gemini 2.0 Flash（1M tokens） |
| `^gemini-1\.5-pro` | `2097152` | Gemini 1.5 Pro（2M tokens） |
| `^gemini-1\.5-flash` | `1048576` | Gemini 1.5 Flash（1M tokens） |
| `^gemini-` | `1048576` | 其他 Gemini 模型 |
| （默认） | `256000` | 未命中任何规则 |

> 注：模型上下文长度取公开资料典型值，部分国内/国际模型存在多个版本导致数值差异，实际以供应商文档为准。规则表以代码常量形式存在，按 specificity 从高到低排列，命中第一条即返回，未命中时回退到 256000。用户仍可在模型映射表格中手动覆盖。

- 实现位置：`src/lib/model-defaults.ts`（或类似纯函数文件）。
- 核心函数：
  ```ts
  export function getDefaultMaxContextSize(modelId: string): number;
  ```
- 调用点：
  - `ProviderEdit` 中手动添加模型时。
  - `ProviderEdit` 中通过"获取模型列表"发现模型并添加时。
  - `handleAddProvider` / `handleApplyProviderJson` 等生成默认模型的地方，可一并使用此函数作为更智能的默认值。

### i18n 键

新增键：

- `agentSettings`: "全局配置"
- `enableThinking`: "启用思考"
- `thinkingLevel`: "思考等级"
- `thinkingKeep`: "保留思考内容"
- `thinkingLow`: "低"
- `thinkingMedium`: "中"
- `thinkingHigh`: "高"
- `thinkingMax`: "最大"
- `thinkingContextHint`: "启用思考会占用更多上下文，请确保模型上下文长度和预留空间足够。"
- `loopControlSettings`: "循环控制"
- `maxRetriesPerStep`: "单步重试次数"
- `reservedContextSize`: "上下文预留大小"
- `backgroundSettings`: "后台任务"
- `maxRunningTasks`: "最大并发数"
- `keepAliveOnExit`: "退出时保持运行"
- `permissionRules`: "权限规则"
- `permissionDecision`: "处置"
- `permissionPattern`: "模式"
- `permissionAllow`: "允许"
- `permissionDeny`: "拒绝"
- `permissionAsk`: "询问"
- `addRule`: "+ 添加规则"
- `addCommonRules`: "添加常用规则"
- `hooks`: "生命周期钩子"
- `hookEvent`: "事件"
- `hookMatcher`: "匹配器"
- `hookCommand`: "命令"
- `hookTimeout`: "超时"
- `addHook`: "+ 添加钩子"

## 验收标准

- [ ] 在 Kimi Code 选项卡下进入供应商编辑页面，"模型映射"标签页下方出现"全局配置"区域。
- [ ] Pi 选项卡下不显示该全局配置区域。
- [ ] "启用思考"复选框控制 `[thinking].enabled`。
- [ ] 启用思考后，"思考等级"和"保留思考内容"可用；未启用时禁用。
- [ ] "思考等级"分段按钮写入 `[thinking].effort`。
- [ ] "保留思考内容"写入 `[thinking].keep = "all"`，未勾选时写入关值。
- [ ] `[loop_control]` 和 `[background]` 的数字/复选框正确读写。
- [ ] 权限规则列表可增删改，导出为 `[[permission.rules]]`。
- [ ] 钩子列表可增删改，导出为 `[[hooks]]`。
- [ ] 保存配置后，Kimi Code 的 `config.toml` 中对应顶层表内容正确。
- [ ] 不修改模型映射表格中已有的 `max_context_size` 手动编辑逻辑。
- [ ] 添加新模型时，`max_context_size` 默认按规则表自动填充，匹配不区分大小写，未命中规则时为 256000。
- [ ] 用户仍可在模型映射表格中手动覆盖自动填充的 `max_context_size`。
- [ ] `npm run build` 通过。
