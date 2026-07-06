# KimiSwitch 设计文档

## 1. 项目概述

KimiSwitch 是一个 Windows 桌面配置管理工具，用于简化 Kimi Code CLI 的多供应商配置维护。它通过图形界面让用户增删改查 `[providers]` 与 `[models]`，支持多套配置**配置文件（Profile）**的保存与一键切换，最终生成符合 Kimi Code CLI 规范的 `~/.kimi-code/config.toml`。

## 2. 问题与目标

### 2.1 现状痛点

- Kimi Code CLI 的配置文件是 TOML 格式，需要手动编辑。
- 维护多个供应商（Kimi、OpenAI、Anthropic、Gemini、Vertex 等）时，`base_url` 与 `api_key` 容易写错或重复。
- 对 TOML 语法不熟的用户（例如 `[models."gpt-4.1"]` 需要引号）上手成本高。
- 工作、个人、测试等场景需要多套 API 配置时，只能手动备份/替换 `config.toml`，切换麻烦且容易出错。

### 2.2 项目目标

- **优先做好 Windows 版本**：安装包、路径处理、UI 风格、权限行为均以 Windows 为首要目标平台。
- 提供图形化界面，零 TOML 语法负担地维护供应商与模型别名。
- **支持一键切换当前使用的供应商及其对应模型**：选择供应商后自动筛选关联模型，确认后立即将 `default_model` 写入 `config.toml`。
- **支持多配置文件（Profile）管理**：保存多份独立配置，一键切换激活某一份到 `~/.kimi-code/config.toml`。
- 支持 Kimi Code CLI 官方支持的全部供应商类型。
- 自动处理凭证存储方式（直接字段 vs `[providers.<name>.env]` 子表）。
- 以 Windows MSI 安装包形式分发给 Windows 用户。

## 3. 功能范围

### 3.1 In Scope

- 供应商（providers）管理：增删改查。
- 模型别名（models）管理：增删改查。
- **供应商与模型快速切换**：选择供应商后只显示使用该供应商的模型，一键设为 `default_model`。
- **Profile（配置快照）管理**：新建、重命名、复制、删除、切换 Profile；Profile 保存在 `~/.kimi-code/profiles/` 下，切换时写入 `~/.kimi-code/config.toml`。
- 读取现有 `~/.kimi-code/config.toml`。
- 保存时自动备份原配置并写入新配置。
- 基础校验：必填项、重复别名、缺失的供应商引用、缺失凭证。
- 生成 Windows MSI 安装包。

### 3.2 Out of Scope

- 不实现加密存储：API Key 按 Kimi Code CLI 官方方式保存在 `config.toml` 中。
- 不修改 `tui.toml`、`mcp.json`、OAuth 凭证等其他文件。
- 不实现远程同步或云存储。
- 不实现网络连通性测试或 API 调用验证。
- 第一版不支持 macOS / Linux 安装包，仅输出 Windows x64 MSI；其他平台待 Windows x64 版本完成后再规划。

## 4. 技术方案

### 4.1 推荐方案

**Tauri（Rust + TypeScript）**

- **Tauri v2**：Rust 编写的跨平台桌面框架，内置 Windows MSI 打包，产物体积小、启动快。本设计基于 Tauri v2 的权限与命令体系。
- **Rust**：负责文件 I/O、配置解析、Profile 管理、校验逻辑；类型安全、性能高。
- **TypeScript + React + Tailwind CSS**：负责前端界面；Tailwind 提供基础样式，无需引入重型 UI 组件库。
- **toml_edit**：Rust 生态中支持 round-trip 的 TOML 编辑库，保留注释与格式。
- **IndexMap**：替代 `HashMap` 保留 Provider / Model 的插入顺序。
- **Tauri Bundler**：一键生成 `.msi` 安装包，无需额外 WiX 手动编写。

### 4.2 备选方案

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| Tauri + Rust + Vanilla TS | 依赖更少，构建更快 | 大型表单状态管理需手写 |
| Tauri + Rust + Vue/Svelte | 体积与 Vanilla 相近 | 团队需熟悉对应框架 |
| egui / Iced（纯 Rust） | 无前端构建链 | UI 灵活度与组件生态不如 Web |

选择 **Tauri + Rust + React** 的原因是：Tauri 内置 MSI 打包且产物体积小；Rust 适合处理文件与配置逻辑；React 表单/表格生态成熟，能快速实现三栏配置界面。

## 5. 目录结构

```
D:/AIGC/KimiSwitch
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json       # Tauri 应用配置与打包选项
│   └── src/
│       ├── main.rs             # 入口
│       ├── lib.rs              # 模块导出
│       ├── models.rs           # Provider / Model / Config / Profile 结构体
│       ├── config_io.rs        # 读写 config.toml 与 Profile 文件
│       ├── profile_manager.rs  # Profile 生命周期管理
│       ├── validators.rs       # 配置校验
│       └── commands.rs         # Tauri 暴露给前端的命令
├── src/                        # 前端源码
│   ├── App.tsx
│   ├── components/
│   │   ├── TopBar.tsx          # Profile / 供应商 / 模型 / 设为默认
│   │   ├── ProviderList.tsx
│   │   ├── ProviderForm.tsx
│   │   ├── ModelList.tsx
│   │   ├── ModelForm.tsx
│   │   └── BottomToolbar.tsx
│   ├── hooks/
│   │   └── useConfig.ts        # 配置状态与 Tauri 命令封装
│   └── types/
│       └── index.ts            # 前端类型定义
├── tests/
│   ├── config_io.rs
│   ├── profile_manager.rs
│   └── validators.rs
├── package.json
├── tsconfig.json
├── vite.config.ts
├── Cargo.lock
├── README.md
└── .gitignore
```

## 6. 数据模型

### 6.1 ProviderType 枚举

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderType {
    Kimi,
    Anthropic,
    Openai,
    #[serde(rename = "openai_responses")]
    OpenaiResponses,
    #[serde(rename = "google-genai")]
    GoogleGenai,
    Vertexai,
}
```

> 注意：`openai_responses` 与 `google-genai` 包含连字符，无法直接用 `rename_all = "snake_case"`，需单独 `#[serde(rename)]`。

### 6.2 Provider

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub name: String,                    // 供应商唯一标识
    pub provider_type: ProviderType,     // 枚举
    pub base_url: Option<String>,        // 直接字段
    pub api_key: Option<String>,         // 直接字段
    pub env: IndexMap<String, String>,   // [providers.<name>.env] 子表，保留顺序
    pub raw_other: Table,                // 保留本工具不直接编辑的其他字段（如 custom_headers）
}
```

### 6.3 Model

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Model {
    pub alias: String,                   // 模型别名
    pub provider: String,                // 引用的供应商 name
    pub model: String,                   // 实际模型 ID
    pub max_context_size: u64,
    pub display_name: Option<String>,
    pub raw_other: Table,                // 保留 capabilities 等本工具不直接编辑的字段
}
```

### 6.4 Config

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub default_model: Option<String>,
    pub providers: IndexMap<String, Provider>,  // 保留顺序
    pub models: IndexMap<String, Model>,        // 保留顺序
    pub raw_other: Table,                       // 保留 config.toml 中与本工具无关的其他字段
}
```

### 6.5 Profile

```rust
#[derive(Debug, Clone)]
pub struct Profile {
    pub name: String,                 // Profile 显示名称，可包含中文/空格
    pub filename: String,             // 安全化的存储文件名，如 "my-profile.toml"
    pub config: Config,               // 该 Profile 对应的完整配置内容
    pub is_active: bool,              // 是否当前已激活
}
```

Profile 文件统一存放在 `~/.kimi-code/profiles/` 目录下。`default` Profile 特殊处理：它直接对应 `~/.kimi-code/config.toml`，不额外在 `profiles/` 下生成文件。

**文件名安全化**：Profile 显示名可包含中文、空格、大小写；存储时自动转译为合法 Windows 文件名。转译规则：保留 ASCII 字母数字，其他字符替换为 `-`，连续 `-` 合并，小写化；若结果为空（如纯中文名），则回退为基于名称哈希的短文件名（如 `profile-48291.toml`）。

## 7. 配置读写行为

### 7.1 读取流程

1. 定位 `~/.kimi-code/config.toml`（可通过 `KIMI_CODE_HOME` 环境变量覆盖；使用 Rust `std::path::PathBuf` 处理 Windows 路径）。
2. 使用 `toml_edit` 解析 TOML（保留注释、空行与字段顺序）。
3. 提取 `[providers.*]` 与 `[models.*]` 到 Rust 结构体。
4. 保留文件中其他字段（如 `[thinking]`、`[loop_control]` 等），保存时原样写回。

### 7.2 写入流程

1. 若目标文件已存在，先复制一份带时间戳的备份：`config.toml.bak.YYYYMMDD_HHMMSS_<毫秒>`（如 1 秒内多次保存，追加自增序号）。
2. 使用 `toml_edit` 加载并修改 `[providers]`、`[models]` 与 `default_model`，保留原文件中的注释、空行与字段顺序。
3. 合并保留的其他字段。
4. 写回文件。
5. 写操作使用临时文件 + 原子重命名（`write to tmp → fsync → rename`），降低写损风险。

> 第一版即使用 `toml_edit` 而非 `toml`/`serde_toml`，避免用户的既有注释和格式在保存后被清空。

### 7.3 Tauri 权限配置

Tauri 默认禁止前端访问文件系统，需在 `tauri.conf.json`（或 `capabilities/` 目录）中显式声明：

- `fs:allow-read-file`：`~/.kimi-code/config.toml`、Profile 文件。
- `fs:allow-write-file`：`~/.kimi-code/config.toml`、Profile 文件。
- `fs:allow-read-dir`：`~/.kimi-code/`、`~/.kimi-code/profiles/`。
- `fs:allow-create-dir`：首次运行时创建 `~/.kimi-code/profiles/`。
- `core:default`：基础窗口与事件权限。

所有路径使用 Tauri 的 `BaseDirectory::Home` 解析，避免硬编码绝对路径。

### 7.4 Tauri 命令清单

Rust 后端通过 `commands.rs` 暴露以下命令给前端调用：

| 命令 | 输入 | 输出 | 说明 |
| --- | --- | --- | --- |
| `load_config` | 无 | `Config` | 读取 `~/.kimi-code/config.toml`，若不存在则初始化空配置。 |
| `save_config` | `Config` | `Result<(), String>` | 校验并写入 `config.toml`，失败返回错误信息。 |
| `list_profiles` | 无 | `Vec<ProfileSummary>` | 列出 `profiles/` 下所有 Profile 及其激活状态。 |
| `load_profile` | `filename: String` | `Config` | 读取指定 Profile 文件内容。 |
| `save_profile` | `filename: String, config: Config` | `Result<(), String>` | 保存或覆盖指定 Profile 文件。 |
| `switch_profile` | `filename: String` | `Result<Config, String>` | 将指定 Profile 内容写入 `config.toml`（带备份）并返回新配置。 |
| `rename_profile` | `old_filename, new_name` | `Result<String, String>` | 重命名 Profile，返回新的安全文件名。 |
| `delete_profile` | `filename: String` | `Result<(), String>` | 删除指定 Profile 文件。 |
| `open_config_dir` | 无 | `Result<(), String>` | 调用系统文件管理器打开配置目录。 |
| `get_app_version` | 无 | `String` | 返回当前应用版本号。 |

### 7.5 凭证存储策略

根据 [Kimi Code CLI 配置覆盖文档](https://www.kimi.com/code/docs/kimi-code-cli/configuration/overrides.html)，凭证解析优先级为：

1. `[providers.<name>].api_key` / `.base_url`
2. `[providers.<name>.env]` 中对应键
3. 两者都缺失 → CLI 启动报错

KimiSwitch 默认将凭证写入 `[providers.<name>.env]` 子表，使用官方约定键名，同时提供「使用直接字段」开关，允许用户将 `api_key` / `base_url` 写到 `[providers.<name>]` 顶层。UI 中两种方式互斥：

- **env 子表模式**：`api_key` / `base_url` 输入框的值映射到 `env` 中的约定键名；保存时顶层 `api_key` / `base_url` 字段被移除。
- **直接字段模式**：`api_key` / `base_url` 写入顶层字段；保存时 `env` 中的对应约定键名被移除，其他自定义 `env` 键保留。

避免直接字段与 `env` 同时存在导致优先级迷惑。

各供应商的默认 Base URL 与 `env` 键名如下（参考 [Kimi Code CLI 平台与模型](https://www.kimi.com/code/docs/kimi-code-cli/configuration/providers.html)）：

| 供应商类型 | 默认 Base URL | API Key 键名 | Base URL 键名 | 特殊说明 |
| --- | --- | --- | --- | --- |
| `kimi` | `https://api.moonshot.ai/v1` | `KIMI_API_KEY` | `KIMI_BASE_URL` | 支持视频上传 |
| `anthropic` | Anthropic SDK 默认 | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` | Claude 模型自动识别 thinking / 视觉 / 工具调用 |
| `openai` | `https://api.openai.com/v1` | `OPENAI_API_KEY` | `OPENAI_BASE_URL` | 兼容 DeepSeek、Qwen 等第三方网关 |
| `openai_responses` | `https://api.openai.com/v1` | `OPENAI_API_KEY` | `OPENAI_BASE_URL` | 使用 OpenAI Responses API |
| `google-genai` | `https://generativelanguage.googleapis.com` | `GOOGLE_API_KEY` | `GOOGLE_GEMINI_BASE_URL` | 只填主机根地址，不要带 `/v1beta` |
| `vertexai` | 区域化 `*-aiplatform.googleapis.com` | 通常不需要（走 ADC） | `GOOGLE_VERTEX_BASE_URL` | 必须提供 `GOOGLE_CLOUD_PROJECT` 与 `GOOGLE_CLOUD_LOCATION`；只填主机根地址 |

创建供应商时，UI 根据所选 `type` 自动填入默认 Base URL 与推荐 `env` 键名，用户可手动覆盖。

### 7.6 Profile 生命周期

Profile 是 `~/.kimi-code/config.toml` 的命名快照，存放在 `~/.kimi-code/profiles/` 目录下。

#### 7.6.1 初始化

- 工具首次启动时，若 `~/.kimi-code/config.toml` 已存在，自动生成一个名为 `default` 的 Profile，其内容即为当前 `config.toml`。
- 若 `config.toml` 不存在，创建一个空 `default` Profile。
- `default` Profile 始终直接对应 `~/.kimi-code/config.toml`，不在 `profiles/` 下额外生成文件。

**文件名安全化**：Profile 显示名可包含中文、空格、大小写；存储时自动转译为合法 Windows 文件名。转译规则：保留 ASCII 字母数字，其他字符替换为 `-`，连续 `-` 合并，小写化；若结果为空（如纯中文名），则回退为基于名称哈希的短文件名（如 `profile-48291.toml`）。

#### 7.6.2 操作

| 操作 | 行为 |
| --- | --- |
| 新建 Profile | 用户输入显示名，自动生成安全文件名；可选择「从当前配置复制」或「空白」；保存到 `profiles/<safe-name>.toml`。 |
| 重命名 Profile | 仅重命名非 `default` 的 Profile，修改显示名并重新生成安全文件名；原文件删除，新文件写入。 |
| 复制 Profile | 以 `<原显示名> Copy` 创建副本，自动生成新的安全文件名。 |
| 删除 Profile | 删除 `profiles/<safe-name>.toml`；`default` 不可删除。 |
| 切换 Profile | 将选中的 Profile 内容写入 `~/.kimi-code/config.toml`（先备份当前 `config.toml`），然后重新加载界面。 |
| 保存当前到 Profile | 把当前编辑内容导出为新的 Profile 文件，不影响当前激活状态。 |

#### 7.6.3 激活状态判定

- 工具启动时将 `config.toml` 解析为 `Config`，再与各 Profile 的 `Config` 做深度比较（而非字符串比较），语义一致即标记为 `is_active`。
- 若没有任何 Profile 与当前 `config.toml` 语义一致，则 `default` Profile 标记为 `is_active`，并在界面上提示「当前 config.toml 与所有 Profile 不完全匹配」。

#### 7.6.4 未保存变更处理

- 切换 Profile 或退出前若存在未保存的编辑，弹出对话框：「保存当前修改 / 丢弃 / 取消」。
- 标题栏或状态栏显示「已修改」指示器。

## 8. 界面设计

前端使用 React + TypeScript + Tailwind CSS 实现，主窗口采用三栏布局，顶部增加「快速切换」工具条。前端通过 Tauri `invoke` 调用 Rust 命令完成所有文件操作。

- **窗口约束**：最小宽度 1000px，最小高度 700px；标题栏显示 `[未保存] Profile 名 - KimiSwitch`。
- **快捷键**：`Ctrl + S` 保存当前配置，`Ctrl + R` 重新读取，`Ctrl + O` 打开配置目录。第一版不单独做主题切换，跟随系统亮/暗模式。

### 8.1 顶部工具条

从左到右依次为：

- **Profile 下拉框**：列出所有 Profile（含 `default`），当前激活项高亮显示。
- **Profile 操作按钮**：「新建」「复制」「重命名」「删除」「切换」。
- **当前供应商** 下拉框：列出当前 Profile 中已配置供应商。
- **当前模型** 下拉框：根据所选供应商，只列出引用该供应商的模型别名；若该供应商下没有模型，则提示「未绑定模型，请先在右侧添加」。
- **设为默认** 按钮：将当前选中的模型写入 `default_model` 字段，并立即保存到当前 Profile 与 `config.toml`。
- 启动时自动高亮当前 `default_model` 对应的供应商和模型。

### 8.2 左栏：供应商列表

- 显示所有 provider name 与 type。
- 支持「添加」与「删除」按钮。
- 切换左栏选中项时，顶部「当前供应商」下拉框同步联动，右栏模型列表按该供应商过滤。

### 8.3 中栏：供应商详情表单

- `type` 下拉选择框；切换时自动填充默认 `base_url` 与推荐 `env` 键名。
- `base_url` 输入框。
- `api_key` 输入框（默认掩码，可切换明文）。
- 凭证存储方式单选：直接字段 / env 子表；两种方式互斥，保存时只写入被选中的那一种。
- `env` 键值对表格（可增删改行）。

### 8.4 右栏：模型别名列表与详情

- 显示当前选中供应商下的 model alias（也可切换显示全部）。
- 表单包含 `alias`、`provider` 下拉选择、`model`、`max_context_size`、`display_name`。
- 提供「设为默认模型」按钮，等同于顶部快速切换区的「设为默认」。

### 8.5 状态与错误处理

- **未保存指示**：标题栏在配置有未保存变更时显示 `*` 前缀；状态栏显示「已修改」或「已保存」。
- **切换/退出前检查**：存在未保存变更时，弹出「保存 / 丢弃 / 取消」三选一对话框。
- **文件不存在**：首次启动或配置目录不存在时，自动创建 `~/.kimi-code/` 目录与空 `config.toml`，不报错。
- **文件只读/权限不足**：保存失败时给出明确提示，并建议检查目录权限或以管理员身份运行。
- **校验失败**：保存前校验不通过时，弹窗列出所有错误项，禁止写入。
- **备份失败**：若备份步骤失败（如磁盘满），禁止覆盖原文件。
- **多实例冲突**：启动时检测 `~/.kimi-code/.kimiswitch.lock`；若已存在且进程仍在运行，提示用户「KimiSwitch 已在运行，请勿多开」；若进程已消失则清理旧锁。保存时不强制全局锁，但建议单次会话内顺序执行写操作。

### 8.6 底部工具栏

- **读取配置**：从 `~/.kimi-code/config.toml` 重新加载。
- **保存配置**：校验并写入当前 Profile 与 `config.toml`，失败时弹出错误提示。
- **保存为新 Profile**：把当前编辑内容导出为新的 Profile 文件。
- **打开配置目录**：调用系统文件管理器定位到数据目录。

## 9. 校验规则

保存前必须校验通过，否则禁止写入：

1. 每个 Provider 的 `name` 非空、不重复，且为合法 TOML 表键（必要时生成带引号的键）。
2. 每个 Provider 的 `type` 必须是支持的类型之一。
3. 每个 Provider 必须至少提供一种凭证来源，但 `vertexai` 例外（走 Google Cloud ADC，无需静态 API Key）：
   - `api_key` 直接字段非空，或
   - `env` 中包含对应供应商的 API Key 键名。
4. 凭证存储方式在直接字段与 `env` 子表之间互斥，保存时只写入选中的那一种。
5. `vertexai` 类型的 Provider 必须在 `env` 中提供 `GOOGLE_CLOUD_PROJECT` 与 `GOOGLE_CLOUD_LOCATION`，不强制要求 API Key。
6. 每个 Model 的 `alias` 非空、不重复，且为合法 TOML 表键（含 `.` 等字符时自动加引号）。
7. 每个 Model 的 `provider` 必须引用一个已存在的 Provider。
8. 每个 Model 的 `model` 非空，`max_context_size` 为正整数。

## 10. MSI 打包

### 10.1 打包流程

1. 安装依赖：`npm install` 与 `cargo fetch`
2. 开发/构建前端：`npm run build`
3. 构建并打包：`npm run tauri build`
   - Tauri 自动调用 `cargo build --release` 与 Windows bundler
   - 输出：`src-tauri/target/release/bundle/msi/KimiSwitch_<version>_x64_en-US.msi`

### 10.2 MSI 行为

- 默认安装目录：`C:\Program Files\KimiSwitch`（ per-machine 安装，需管理员权限）。
- 创建开始菜单快捷方式：`KimiSwitch`。
- 安装程序不自动写入 `config.toml`，仅部署工具本身。
- 支持标准卸载。
- 可在 `tauri.conf.json` 中配置签名、版本、厂商信息、安装目录等。
- 第一版仅构建 x64 架构 MSI，不构建 arm64 或 32 位版本。
- 第一版**不启用 Tauri Updater**，后续版本通过重新安装 MSI 升级，降低第一版复杂度。

### 10.3 Windows 专项处理

- **路径解析**：使用 Rust `dirs::home_dir()` 获取用户主目录，拼接 `.kimi-code`，避免依赖 `$HOME` 环境变量（Windows 下可能不存在）。
- **配置文件位置**：默认 `C:\Users\<用户名>\.kimi-code\config.toml`；若用户设置 `KIMI_CODE_HOME`，按该变量解析。
- **权限**：工具运行时只读写用户目录下的文件，无需以管理员身份运行；仅 MSI 安装本身需要管理员权限。
- **编码与换行**：TOML 文件统一使用 UTF-8；Windows 下换行保持为 `\r\n` 或 `\n` 均可，`toml_edit` 会保留原文件换行风格。
- **代码签名（可选）**：如后续分发，建议为 MSI 配置代码签名证书，减少 Windows Defender  SmartScreen 提示。

## 11. 测试策略

- **单元测试**（Rust）：
  - `config_io.rs`：解析与生成 TOML 的 round-trip 测试。
  - `profile_manager.rs`：Profile 新建、复制、切换、激活状态判定测试。
  - `validators.rs`：校验规则的边界测试。
- **手动测试**：
  - 启动 GUI，增删改供应商与模型。
  - 创建多个 Profile 并相互切换，验证 `config.toml` 内容正确变化。
  - 保存后使用 Kimi Code CLI 读取并验证可用性。
  - 在 Windows 上执行 MSI 安装与卸载。

## 12. 假设与约束

- **第一版目标平台仅为 Windows x64**，macOS / Linux 跨平台支持不在第一版范围内，待 Windows x64 版本完成后再规划。
- API Key 按 Kimi Code CLI 官方方式明文存储在 `config.toml` 中，不引入额外加密。
- 开发者已安装 Rust 工具链、Node.js 与 Tauri CLI（仅开发与打包时需要，最终用户不需要）。
- 不覆盖 Kimi Code CLI 的自动更新机制或 OAuth 登录流程。
- 最终用户运行 KimiSwitch 只需标准 Windows 用户权限，安装 MSI 时才需要管理员权限。

## 13. 参考文档

- [Kimi Code CLI 配置文件](https://www.kimi.com/code/docs/kimi-code-cli/configuration/config-files.html)
- [Kimi Code CLI 平台与模型](https://www.kimi.com/code/docs/kimi-code-cli/configuration/providers.html)
- [Kimi Code CLI 数据路径](https://www.kimi.com/code/docs/kimi-code-cli/configuration/data-locations.html)
- [Kimi Code CLI 环境变量](https://www.kimi.com/code/docs/kimi-code-cli/configuration/env-vars.html)
- [Kimi Code CLI 配置覆盖](https://www.kimi.com/code/docs/kimi-code-cli/configuration/overrides.html)
