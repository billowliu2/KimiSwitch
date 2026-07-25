# Kimi Switch

> Windows 桌面端 LLM 供应商配置管理器，让你在 **Kimi Code CLI** 和 **Pi** 两个 Agent 之间无缝切换多家 LLM 供应商与模型。

[English](./README_EN.md) | **中文**

[![Tauri](https://img.shields.io/badge/Tauri-v2-blue?logo=tauri)](https://tauri.app)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-2021-ed764d?logo=rust)](https://www.rust-lang.org)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

---

## 目录

- [这是什么](#这是什么)
- [核心特性](#核心特性)
- [架构总览](#架构总览)
- [支持的供应商类型](#支持的供应商类型)
- [数据存储位置](#数据存储位置)
- [快速上手](#快速上手)
- [开发指南](#开发指南)
- [键盘快捷键](#键盘快捷键)
- [国际化](#国际化)
- [测试](#测试)
- [打包发布](#打包发布)
- [常见问题](#常见问题)
- [安全提示](#安全提示)

---

## 这是什么

**Kimi Switch** 是一个为 LLM CLI 用户打造的 Windows 桌面配置管理工具。它解决两个痛点：

1. **多供应商管理繁琐**：在 Kimi / Anthropic / OpenAI / Google GenAI / 自建代理 等多家供应商之间切换时，需要反复手改 TOML/JSON，容易出错。
2. **多 Agent 配置割裂**：同时使用 **Kimi Code CLI** 和 **Pi** 两个 Agent 的开发者，每个 Agent 都有一套独立的配置格式，改一处要改两份。

Kimi Switch 提供统一的图形界面：

- 统一图形界面，分别管理 Kimi Code 和 Pi 两套 Agent 配置，顶部 Tab 切换
- 一键切换供应商，自动写入对应 Agent 的原生配置
- 一键拉取模型列表（OpenAI / Anthropic / Google GenAI）
- 切换后给出 `/reload` 提示，确保 Kimi Code 会话立即生效

## 核心特性

| 分类 | 功能 |
| --- | --- |
| **多 Agent** | 同时管理 Kimi Code 和 Pi 两套配置，互不干扰，顶部 Tab 切换 |
| **多供应商** | Kimi / Anthropic / OpenAI / OpenAI Responses / Google GenAI / Vertex AI |
| **模型映射** | 别名 ↔ 实际模型 ID，支持显示名、上下文长度、角色（Sonnet/Opus/Fable/Haiku）、1M 上下文声明 |
| **一键发现** | 根据供应商 API 自动拉取可用模型列表 |
| **托管供应商** | 标记 OAuth/managed 供应商，跳过凭证校验，保留 `oauth` 段写入 Kimi Code 配置 |
| **Env 凭证** | 既支持 `api_key` 字段，也支持 `env` 表里的环境变量名（如 `OPENAI_API_KEY`） |
| **全局设置** | 思考开关/等级、循环重试、后台任务、权限规则、生命周期钩子（仅 Kimi Code） |
| **JSON 直编** | 高级用户可手动编辑完整配置 JSON（保留未知字段，不会丢字段） |
| **i18n** | 简体中文 / English，运行时切换 |
| **自动备份** | 写入 Kimi Code / Pi 原生配置前自动备份，按时间戳命名，保留最近 7 天（见 `src-tauri/src/config_io.rs`） |
| **快捷键** | Ctrl+S 保存、Ctrl+R 重载、Ctrl+O 打开配置目录 |
| **校验（预留）** | i18n 已定义错误文案（名称重复、凭证缺失、Vertex 字段缺失等），后端 `validators.rs` 为占位实现，尚未接线 |
| **未保存提示** | 关闭窗口前检测未保存修改，标题栏加 `*` 前缀 |

## 架构总览

```
┌────────────────────────────────────────────────────────────────────┐
│                       Kimi Switch (Tauri v2)                         │
│                                                                    │
│   ┌──────────────────────────┐    ┌──────────────────────────┐    │
│   │   React Frontend (TS)    │    │   Rust Backend (lib.rs)  │    │
│   │                          │    │                          │    │
│   │   src/App.tsx            │◄──►│   src-tauri/src/         │    │
│   │   src/components/        │ Tauri    ├── commands.rs    │    │
│   │     ProviderList         │  invoke  ├── db.rs          │    │
│   │     ProviderEdit         │          ├── kimi_code_io   │    │
│   │     AgentSettingsPanel   │          ├── pi_io.rs       │    │
│   │   src/hooks/useConfig    │          ├── config_io.rs   │    │
│   │   src/i18n/{zh,en}.ts    │          ├── validators.rs  │    │
│   │   src/types/index.ts     │          └── profile_manager│    │
│   └──────────────────────────┘    └──────────────────────────┘    │
│                  │                              │                  │
└──────────────────┼──────────────────────────────┼──────────────────┘
                   │                              │
                   ▼                              ▼
       ┌──────────────────────┐      ┌──────────────────────────┐
       │  SQLite              │      │  Agent 原生配置文件       │
       │  ~/.kimi-switch/       │      │  ├─ ~/.kimi-code/        │
       │    kimi-switch.db      │      │  │  └─ config.toml       │
       │                      │      │  └─ ~/.pi/agent/         │
       │  (Kimi Switch 内部状态) │      │     ├─ models.json      │
       └──────────────────────┘      │     └─ settings.json     │
                                     └──────────────────────────┘
```

**关键设计**：

- Kimi Switch 维护自己的 SQLite 数据库存**完整配置**（所有供应商 + 所有模型，含未激活的）
- 点「切换使用」时只把**当前激活的供应商**写入 Agent 原生配置，其他不写
- 这样 Kimi Code / Pi 始终只看到一个活跃供应商，不会被托管/OAuth 默认值干扰
- `raw_other` 字段透传未知键，保证前后往返不丢字段

## 支持的供应商类型

| 类型 | 标识符 | 默认 base_url | 模型发现 | 凭证 |
| --- | --- | --- | --- | --- |
| Kimi | `kimi` | `https://api.openai.com/v1` | ✅ OpenAI 协议 | `KIMI_API_KEY` 或 `env.KIMI_API_KEY` |
| Anthropic | `anthropic` | — | ✅ `/v1/models` | `ANTHROPIC_API_KEY` 或 `env` |
| OpenAI | `openai` | `https://api.openai.com/v1` | ✅ `/models` | `OPENAI_API_KEY` 或 `env` |
| OpenAI Responses | `openai_responses` | `https://api.openai.com/v1` | ✅ `/models` | `OPENAI_API_KEY` 或 `env` |
| Google GenAI | `google-genai` | `https://generativelanguage.googleapis.com` | ✅ `/v1beta/models` | `GOOGLE_API_KEY` 或 `env` |
| Vertex AI | `vertexai` | — | ⚠️ 待实现 | `VERTEXAI_API_KEY` + `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` |

凭证优先级：`api_key` 字段 > `env` 表里的同名键。

## 数据存储位置

| 文件 | 用途 | 备份 |
| --- | --- | --- |
| `%USERPROFILE%\.kimi-switch\kimi-switch.db` | Kimi Switch 自己的 SQLite 数据库，存全量配置 | — |
| `%USERPROFILE%\.kimi-code\config.toml` | Kimi Code CLI 的 TOML 配置（**切换时写入**） | 同目录下 `backups/config.toml.bak.{YYYYMMDD_HHMMSS}`，保留 7 天 |
| `%USERPROFILE%\.pi\agent\models.json` | Pi 的供应商+模型配置（**切换时写入**） | 同目录下 `backups/models.json.bak.{YYYYMMDD_HHMMSS}`，保留 7 天 |
| `%USERPROFILE%\.pi\agent\settings.json` | Pi 的默认供应商/模型（**切换时写入**） | 同目录下 `backups/settings.json.bak.{YYYYMMDD_HHMMSS}`，保留 7 天 |
| `localStorage[kimi-switch-agent]` | 前端记住上次选中的 Agent（kimi_code / pi） | — |

环境变量覆盖：

- `KIMI_CODE_HOME` 覆盖 Kimi Code 配置目录（默认 `~/.kimi-code`）
- `PI_CODING_AGENT_DIR` 覆盖 Pi Agent 配置目录（默认 `~/.pi/agent`）

## 快速上手

### 前置依赖

| 工具 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 18 | 前端构建 |
| Rust | stable 最新版（edition 2021） | Tauri 后端编译 |
| WebView2 Runtime | Windows 10/11 默认已装 | Tauri v2 运行时 |
| Microsoft C++ Build Tools | 最新版 | Rust 编译依赖 |
| WiX Toolset 3.14 | `src-tauri/wix314-binaries/` 目录 | MSI 打包（首次构建自动下载） |

### 安装

```bash
npm install
```

### 开发模式（热重载）

```bash
npm run tauri-dev
```

会同时启动 Vite 开发服务器（端口 1420）和 Tauri 窗口，修改前端代码会自动刷新，修改 Rust 代码会重新编译。

### 仅前端开发（无 Tauri 窗口）

```bash
npm run dev
```

适用于纯 UI 调试。

## 开发指南

### 项目结构

```
.
├── src/                          # React 前端
│   ├── App.tsx                   # 主组件，路由 ProviderList/ProviderEdit
│   ├── main.tsx                  # React 入口 + ErrorBoundary + I18nProvider
│   ├── components/
│   │   ├── ProviderList.tsx      # 供应商列表 + 切换按钮
│   │   ├── ProviderEdit.tsx      # 编辑供应商 + 模型映射 + JSON 直编
│   │   └── AgentSettingsPanel.tsx# 全局设置（思考/循环/权限/钩子）
│   ├── hooks/
│   │   └── useConfig.ts          # 加载/保存配置 hook
│   ├── lib/
│   │   ├── agent-settings.ts     # AgentSettings 解析/序列化
│   │   └── model-defaults.ts     # 模型默认上下文大小
│   ├── types/index.ts            # Provider/Model/Config 类型定义
│   ├── i18n/
│   │   ├── zh.ts                 # 中文翻译（143 条目）
│   │   ├── en.ts                 # 英文翻译
│   │   └── index.tsx             # useTranslation hook + Provider
│   └── index.css                 # Tailwind 入口
│
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── lib.rs                # Tauri Builder + invoke_handler 注册
│   │   ├── main.rs               # 二进制入口
│   │   ├── commands.rs           # 7 个 Tauri Command
│   │   ├── db.rs                 # SQLite 持久化
│   │   ├── kimi_code_io.rs       # ~/.kimi-code/config.toml 读写
│   │   ├── pi_io.rs              # ~/.pi/agent/*.json 读写
│   │   ├── config_io.rs          # 文件备份工具
│   │   ├── models.rs             # Config/Provider/Model 数据结构
│   │   ├── profile_manager.rs    # 多 Profile 管理（占位）
│   │   └── validators.rs         # 配置校验
│   ├── capabilities/             # Tauri 权限声明
│   ├── icons/                    # 应用图标（脚本生成）
│   └── tauri.conf.json           # Tauri 配置（窗口/打包/CSP）
│
├── scripts/generate-icons.py     # 从 SVG 生成各尺寸图标
├── public/kimi.svg               # 应用图标源（蓝紫渐变 π）
└── docs/superpowers/             # 设计规范与实施计划
```

### Tauri Commands（前端 ↔ 后端）

| 命令 | 说明 |
| --- | --- |
| `load_agent_config_command(agent)` | 加载配置：优先 SQLite，为空则从 Agent 原生配置导入 |
| `save_agent_config_command(agent, config)` | 保存全量配置到 SQLite |
| `activate_agent_config_command(agent)` | 把当前激活的供应商写入 Agent 原生配置 |
| `open_agent_config_dir(agent)` | 用系统资源管理器打开 Agent 配置目录 |
| `get_app_version()` | 返回 `Cargo.toml` 版本号 |
| `list_provider_models(provider)` | 调供应商 API 拉取模型列表（异步） |
| `debug_log(message)` | 把前端日志打到 stderr（开发用） |

### 添加新供应商类型

1. 在 `src-tauri/src/models.rs` 的 `ProviderType` 枚举里加新变体
2. 在 `default_base_url()` 里加默认值
3. 在 `commands.rs::list_provider_models` 的 `match` 里加分发
4. 在 `kimi_code_io.rs::provider_type_for_kimi_type` 和 `pi_io.rs::provider_type_for_pi_api` 里加映射
5. 在 `src/components/ProviderEdit.tsx` 的 API 格式下拉里加选项
6. 在 `src/i18n/{zh,en}.ts` 里加新的 i18n 键

### 添加新的 Tauri Command

1. 在 `src-tauri/src/commands.rs` 里加 `#[tauri::command]`
2. 在 `src-tauri/src/lib.rs` 的 `tauri::generate_handler![...]` 列表里注册
3. 前端用 `import { invoke } from "@tauri-apps/api/core"` 调用
4. 在 `src-tauri/capabilities/default.json` 里加权限（如需访问文件系统）

## 键盘快捷键

| 快捷键 | 作用 |
| --- | --- |
| `Ctrl + S` | 保存当前修改到 SQLite |
| `Ctrl + R` | 重新读取配置（未保存时会提示） |
| `Ctrl + O` | 打开当前 Agent 的配置目录 |

## 国际化

- 翻译源文件：`src/i18n/zh.ts`（源）和 `src/i18n/en.ts`（目标）
- 新增 key 时**先在 `zh.ts` 里加**，`en.ts` 的 `Record<TranslationKey, string>` 类型会自动校验缺失条目（编译时报错）
- 运行时通过右上角下拉切换语言，记忆在组件内 state（未持久化到 SQLite）

## 测试

### Rust 单元测试

```bash
cd src-tauri
cargo test
```

当前覆盖：

- `kimi_code_io::tests` — TOML 导入/导出往返
- `pi_io::tests` — JSON 往返，包括 advanced fields（headers/compat/cost/extra）

### 前端

暂无自动化测试。建议手动验证清单：

- [ ] 切换 Agent 时配置互不污染
- [ ] 删除供应商时关联模型也清掉
- [ ] 切换供应商后默认模型正确回填
- [ ] 重命名供应商后引用它的模型也跟着改
- [ ] JSON 直编后 `raw_other` 不丢字段

## 打包发布

```bash
npm run tauri-build
```

产物位置：

- `src-tauri/target/release/bundle/msi/Kimi Switch_0.1.0_x64_en-US.msi`

Windows 安装包（MSI），含 WebView2 bootstrapper 自动下载。`nsis` 已禁用，目前只产 MSI。

### 首次打包

首次运行会下载：

- WiX Toolset 3.14 binaries → `src-tauri/wix314-binaries/`
- WebView2 bootstrapper → 打包进 MSI

## 常见问题

**Q: 切换供应商后 Kimi Code 没生效？**
A: 在 Kimi Code 会话里执行 `/reload`（Kimi Code CLI 才会重新读取 `~/.kimi-code/config.toml`）。应用会在 UI 上提示。

**Q: 改了配置但忘了保存就关了窗口？**
A: 关闭窗口前会弹原生 `beforeunload` 提示，标题栏也会显示 `*` 前缀。

**Q: 怎么备份/迁移我的配置？**
A: 备份 `%USERPROFILE%\.kimi-switch\kimi-switch.db` 即可，里面存了全量配置（含未激活的供应商）。

**Q: Vertex AI 为什么不能拉取模型列表？**
A: Vertex 需要 GCP project/location 凭证，当前实现留了 TODO，等 GCP SDK 集成后再补。

**Q: 支持 macOS / Linux 吗？**
A: 代码不依赖 Windows 专属 API，但 `tauri.conf.json` 的 bundle 目标目前只配了 `msi`。理论上把 `bundle.targets` 改成 `["app", "dmg"]` 等即可跨平台，但未验证。

## 安全提示

- API Key 以明文存储在本地 SQLite 和 Agent 原生配置里——**不要在共享电脑上保存**
- 不要把 `kimi-switch.db`、`config.toml`、`models.json` 提交到 Git
- 应用 CSP 已收紧（`default-src 'self'`），但 WebView2 仍可能缓存表单内容，注意在公共电脑用完退出

---

## 附录：相关项目

- [Kimi Code CLI](https://github.com/MoonshotAI/kimi-cli) — 兼容的 Agent 之一
- [Tauri](https://tauri.app) — 桌面应用框架
- 设计文档见 `docs/superpowers/specs/`，实施计划见 `docs/superpowers/plans/`

---

许可证：MIT，详见 [LICENSE](./LICENSE)。Copyright (c) 2026 CodingPlan.site