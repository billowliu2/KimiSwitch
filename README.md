# Kimi Switch

> Windows 桌面端 LLM 供应商配置管理器，让你在 **Kimi Code CLI** 和 **Pi** 两个 Agent 之间无缝切换多家 LLM 供应商与模型。

[English](./README_EN.md) | **中文**

[![Tauri](https://img.shields.io/badge/Tauri-v2-blue?logo=tauri)](https://tauri.app)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-2021-ed764d?logo=rust)](https://www.rust-lang.org)
[![Version](https://img.shields.io/badge/release-v0.3.0-brightgreen)](https://git.codingplan.site/admin/KimiCodeSwitch)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

---

## 目录

- [这是什么](#这是什么)
- [核心特性](#核心特性)
- [界面预览](#界面预览)
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
- 一键切换供应商，更新对应 Agent 原生配置的 `default_model`，保留全部供应商
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
| **用量仪表盘** | Token 用量统计、每日趋势（按模型分色）、全年热力图、最近请求翻页、双击查看模型分布 |
| **会话管理** | 按工作区浏览、预览、归档、批量删除会话，逐行流式读取防崩溃（20MB 上限 + 500 字符折叠） |
| **未保存提示** | 关闭窗口前检测未保存修改，标题栏加 `*` 前缀 |

## 界面预览

**供应商列表**（浅色主题）

![供应商列表](docs/screenshots/providers.png)

清晰展示当前激活的供应商、默认模型、延迟和可用模型数量，支持快速切换、复制、跳转官网、编辑和删除操作。

**编辑供应商 - 基本信息**

![编辑供应商-基本信息](docs/screenshots/provider-basic-info.png)

包含供应商名称、备注、官网链接、托管供应商开关、API 格式、API Key 与请求地址等基础字段。

**编辑供应商 - 模型映射**

![编辑供应商-模型映射](docs/screenshots/provider-model-mapping.png)

一张表管理全部模型映射：显示名称、实际请求模型、上下文长度、1M 上下文声明、能力标签（思考/图像/视频/工具调用/其他），支持「一键设置」「获取模型列表」批量填充。

**用量仪表盘**

![用量仪表盘](docs/screenshots/dashboard.png)

8 项核心 KPI（请求数、非缓存输入、输出、缓存读/写/命中、总 Token、预估费用）+ 全年热力图 + 每日用量趋势（按模型分色堆叠柱状图）+ 模型用量明细（请求、Token、缓存命中、费用）。

**会话管理**

![会话管理](docs/screenshots/sessions.png)

按工作区隔离浏览 Kimi Code 会话，支持活跃/已归档/全部筛选，流式逐行预览会话内容（20MB 字节上限，500 字符折叠），可归档或批量删除。

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

- 对 Kimi Code，`config.toml` 是供应商/模型数据的**权威来源**：所有供应商和模型始终全量保留，`default_model` 决定哪个生效（与 CLI 原生 `/provider` 行为一致）
- SQLite 只存 Kimi Switch 专有元数据（备注、官网、每个供应商记住的默认模型），并在 `config.toml` 不完整时兜底
- 加载时以 `config.toml` 为准，因此通过 `/provider` 在 CLI 端增/改/删的供应商都会被正确反映，切换不再覆盖丢失
- `raw_other` 字段透传未知键（含 `[oauth]` 段），保证前后往返不丢字段
- Pi 的行为不变：切换时仍只写活跃供应商到 `models.json`

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
| `%USERPROFILE%\.kimi-switch\kimi-switch.db` | Kimi Switch 自己的 SQLite 数据库，存元数据（备注/官网/记住的模型）+ 迁移兜底 | — |
| `%USERPROFILE%\.kimi-code\config.toml` | Kimi Code CLI 的 TOML 配置（**权威数据源，切换/保存时写入**） | 同目录下 `backups/config.toml.bak.{YYYYMMDD_HHMMSS}`，保留 7 天 |
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
├── docs/
│   ├── screenshots/              # README 引用的界面截图
│   └── superpowers/              # 设计规范与实施计划
```

### Tauri Commands（前端 ↔ 后端）

| 命令 | 说明 |
| --- | --- |
| `load_agent_config_command(agent)` | 加载配置：Kimi Code 以 `config.toml` 为权威数据源，SQLite 补充元数据；Pi 优先 SQLite |
| `save_agent_config_command(agent, config)` | 保存到 SQLite；Kimi Code 同时写入 `config.toml` |
| `activate_agent_config_command(agent)` | 全量写入 Agent 原生配置（Kimi Code 写全部供应商，`default_model` 决定生效项；Pi 仅写活跃供应商） |
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
| `Ctrl + S` | 保存当前修改到 SQLite + config.toml（Kimi Code） |
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

- `src-tauri/target/release/bundle/msi/Kimi Switch_0.3.0_x64_en-US.msi`

Windows 安装包（MSI），含 WebView2 bootstrapper 自动下载。`nsis` 已禁用，目前只产 MSI。

### 发布版本

**v0.3.0** — 新增用量仪表盘与会话管理功能（基于 [kimicode-dashboard](https://github.com/JochenYang/kimicode-dashboard) 移植，感谢原作者 [JochenYang](https://github.com/JochenYang) 的开源贡献）：

- 用量仪表盘：8 项 KPI、每日趋势图（按模型分色堆叠柱状图，双击查看模型分布弹窗）、全年热力图（按 Token 量 5 级着色，鼠标悬浮 tooltip）、最近请求翻页（30 条/页）
- 会话管理：按工作区隔离浏览、预览会话内容（流式逐行读取防崩溃，20MB 字节上限，500 字符折叠可展开）、归档/取消归档/批量删除
- 时间线修复：`today` 范围、每日热力图和 `day_key` 分桶改用本地时区日历日，UTC+8 用户跨零点后不再数据错位
- 隐藏 Pi 选项：左侧导航栏 Pi 入口已移除（代码保留，仅 UI 隐藏）
- 支持供应商：Kimi / Anthropic / OpenAI / OpenAI Responses / Google GenAI / Vertex AI

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
A: 对 Kimi Code，`config.toml` 本身就是全量配置的权威来源，直接备份它即可；SQLite 存额外的备注/官网等元数据，需要时一并备份 `kimi-switch.db`。对 Pi，备份 `kimi-switch.db`。

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

## 致谢

用量仪表盘与会话管理功能基于 [kimicode-dashboard](https://github.com/JochenYang/kimicode-dashboard)（MIT 许可证，© JochenYang）移植。原始项目实现了 Kimi Code CLI 的本地 Token 用量统计与会话管理，本项目的 Rust 后端（`src-tauri/src/dashboard.rs`）、前端仪表盘（`src/components/dashboard/`）以及会话管理页（`src/components/sessions/`）均源自该项目，感谢原作者的开源贡献。

供应商品牌图标资源与图标选择器实现参考自 [cc-switch](https://github.com/farion1231/cc-switch)（MIT 许可证，© Jason Young），本项目复制了其 `src/icons/extracted/` 图标库与 `IconPicker` 交互设计，感谢原作者的开源贡献。

---

许可证：MIT，详见 [LICENSE](./LICENSE)。Copyright (c) 2026 CodingPlan.site