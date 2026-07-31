# 用户自定义预设方案（User Presets）

## 动机

当前内置预设（`providerPresets.ts`）硬编码在源码中，用户无法自行添加自定义供应商预设或修改已有预设的 `apiKeyUrl`（获取 Key / 推广链接）。每次新增或修改都需要修改源码、重新编译、重新打包，缺乏灵活性。

## 目标

用户可通过外部配置文件**零代码**添加/修改预设供应商，包含：
- 自定义供应商预设（名称、Base URL、API 格式、图标、套餐类型）
- 自定义获取 API Key 入口 / 推广链接（`apiKeyUrl`，可直接放带 ref 的链接）
- 自定义模型列表（模型 ID、显示名称、上下文大小、能力）
- 覆盖内置预设（同一 `id` 时用户预设优先）

## 方案设计

### 1. 配置文件位置

```
Windows: %APPDATA%/KimiSwitch/user-presets.json
macOS:   ~/Library/Application Support/KimiSwitch/user-presets.json
Linux:   ~/.config/KimiSwitch/user-presets.json
```

统一使用应用数据目录（与 `app_config_dir` 一致），不扫描项目根目录——发行版是编译后的二进制，终端用户没有"项目根目录"。

首次启动时若文件不存在，自动创建一个空 `[]` 模板文件，方便用户直接编辑。
PresetPickerModal / 设置页提供一个"打开预设文件夹"按钮，让用户能找到文件位置。

### 2. 文件格式

> 支持 `//` 行注释（jsonc 风格）：加载时先剥离 `//` 注释再 `JSON.parse`，方便用户写备注。

```jsonc
[
  {
    // 唯一标识，与内置预设 id 重名则覆盖内置预设
    "id": "my-custom-vendor",
    // 显示名称（fallback 英文）
    "name": "My Custom Vendor",
    // i18n key（可选，有则优先用 t(nameKey)）
    "nameKey": "presetNameMyCustom",
    // 官网链接
    "websiteUrl": "https://example.com",
    // 获取 API Key 入口 / 推广链接（可直接放带 ref 的链接，如 ?ref=CODE）
    "apiKeyUrl": "https://example.com?ref=MYCODE",
    // 分类：official | cn_official | third_party | aggregator | custom
    "category": "third_party",
    // API 格式：openai | anthropic | google-genai | vertexai | kimi | openai_responses
    "providerType": "openai",
    // Base URL（null 表示使用默认）
    "baseUrl": "https://api.example.com/v1",
    // 图标 key（从 src/icons/extracted 中选，或空字符串用首字母）
    "icon": "",
    // 图标颜色（可选，hex 格式）
    "iconColor": "",
    // 计费模式：subscription | pay_as_you_go
    "billingMode": "pay_as_you_go",
    // 用量查询类型（可选，参考内置预设）
    "usageKinds": [],
    // 模型列表
    "models": [
      {
        "model": "my-model-1",
        "displayName": "My Model 1",
        "maxContextSize": 128000,
        "capabilities": ["thinking"]
      }
    ]
  }
]
```

### 3. 加载逻辑（伪代码）

```
function loadAllPresets(): ProviderPreset[] {
  const builtin = providerPresets;                    // 内置预设
  const user = readUserPresetsFile();                 // 读取用户预设文件
  if (!user || user.length === 0) return builtin;

  const merged = new Map<string, ProviderPreset>();
  for (const p of builtin) merged.set(p.id, p);       // 内置先进
  for (const p of user) merged.set(p.id, p);          // 用户覆盖
  return Array.from(merged.values());
}
```

### 4. 需要修改的代码文件

| 文件 | 修改内容 |
|------|----------|
| `src/config/providerPresets.ts` | 导出 `loadAllPresets()` 函数替代直接使用 `providerPresets` 数组 |
| `src/config/userPresets.ts`（新建） | 实现 `readUserPresetsFile()`：通过 Tauri 命令（Rust 侧 `read_text_file`）读取 + 剥离注释 + `JSON.parse` + 校验结构。用 Rust 命令而非前端 FS 插件，避免 scope 配置且跨平台路径由 Rust `app_config_dir` 统一解析 |
| `src/components/PresetPickerModal.tsx` | 将 `providerPresets` 引用改为 `loadAllPresets()` |
| `src/config/providerPresets.ts`（`findPresetForProvider`） | 同样需要从合并后的预设中查找 |

### 5. 校验逻辑

用户 JSON 文件可能写错，需要做基础校验：

```typescript
interface UserPresetValidation {
  valid: boolean;
  errors: string[];
  presets: ProviderPreset[];
}

function validateUserPreset(raw: unknown): UserPresetValidation {
  // 1. 必须是数组
  // 2. 每项必须有 id、name、providerType、billingMode
  // 3. providerType 必须是合法值之一（openai | openai_responses | anthropic | google-genai | vertexai | kimi）
  // 4. billingMode 必须是 "subscription" | "pay_as_you_go"
  // 5. models 数组每项必须有 model 字段
  // 6. usageKinds 若提供，每项必须在 SUPPORTED_USAGE_KINDS 内，否则丢弃并警告
  //    （Rust 侧运行时也会静默丢弃未知 kind，这里提前拦截给用户明确反馈）
  // 7. 忽略未知字段不报错（仅警告）
  // 8. 单条严重错误时跳过该条，不阻塞其他预设
}
```

### 6. 用户交互

- PresetPickerModal 中用户预设顶部显示，与内置预设分栏展示（或加"自定义"标签）
- 若 JSON 文件解析失败，界面上显示一个黄色警告条 + 错误详情
- 提供一个"刷新用户预设"按钮，不必重启应用

### 7. 安全问题

- 不读取系统敏感路径，仅限于应用数据目录
- 不执行 JSON 中的任何代码；`JSON.parse` 产出的是纯对象，无原型污染风险，校验只需关注字段类型与取值
- 对 URL 字段（websiteUrl / apiKeyUrl）做基本 `http(s)://` 协议校验，`openUrl` 调用前过滤非法 scheme

### 8. 向后兼容

- 没有 `user-presets.json` 时行为完全不变
- 用户预设只影响 PresetPickerModal 中的选项，不影响已保存的 Provider
- 已保存的 Provider 不受用户预设删除影响

## 未解决的问题

1. **图标来源**：用户用内置图标集不存在的 key（含空字符串/null）时，统一降级为首字母显示。是否支持用户自定义 SVG 图标？—— 当前首字母降级足够，先不做。
2. **热加载**：文件修改后是否需要自动检测并刷新？—— 初期手动刷新按钮即可，后续可加 `fs::watch`。
3. **i18n**：用户预设的 `nameKey` 如果对应内置 i18n key 则显示翻译，否则 fallback 到 `name`。用户不能添加自定义 i18n key（涉及翻译文件修改，违背零代码原则）。