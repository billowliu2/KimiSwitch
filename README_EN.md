# Kimi Switch

> A Windows desktop LLM provider config manager that lets you switch between multiple LLM providers and models across the **Kimi Code CLI** and **Pi** agents.

**English** | [中文](./README.md)

[![Tauri](https://img.shields.io/badge/Tauri-v2-blue?logo=tauri)](https://tauri.app)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-2021-ed764d?logo=rust)](https://www.rust-lang.org)
[![Version](https://img.shields.io/badge/release-v0.3.0-brightgreen)](https://git.codingplan.site/admin/KimiCodeSwitch)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

---

## Table of Contents

- [What Is This](#what-is-this)
- [Key Features](#key-features)
- [Architecture Overview](#architecture-overview)
- [Supported Provider Types](#supported-provider-types)
- [Data Storage Locations](#data-storage-locations)
- [Getting Started](#getting-started)
- [Development Guide](#development-guide)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Internationalization](#internationalization)
- [Testing](#testing)
- [Build & Release](#build--release)
- [FAQ](#faq)
- [Security Notes](#security-notes)

---

## What Is This

**Kimi Switch** is a Windows desktop configuration tool built for LLM CLI users. It solves two pain points:

1. **Tedious multi-provider management**: switching between Kimi / Anthropic / OpenAI / Google GenAI / self-hosted proxies requires repeatedly hand-editing TOML/JSON, which is error-prone.
2. **Fragmented multi-agent configs**: developers using both **Kimi Code CLI** and **Pi** have to maintain two independent config formats, duplicating every change.

Kimi Switch provides a unified GUI:

- One unified interface to manage two separate agent configs (Kimi Code and Pi), switched via a top tab
- One-click provider switching that updates `default_model` in the target agent's native config while preserving all providers
- One-click model-list fetching (OpenAI / Anthropic / Google GenAI)
- A `/reload` hint after switching so Kimi Code sessions take effect immediately

## Key Features

| Category | Feature |
| --- | --- |
| **Multi-agent** | Manage Kimi Code and Pi configs independently without interference, via a top tab |
| **Multi-provider** | Kimi / Anthropic / OpenAI / OpenAI Responses / Google GenAI / Vertex AI |
| **Model mapping** | Alias ↔ real model ID, with display name, context size, role (Sonnet/Opus/Fable/Haiku), and 1M-context declaration |
| **One-click discovery** | Auto-fetch available model lists from the provider API |
| **Managed providers** | Flag OAuth/managed providers to skip credential validation and preserve the `oauth` section in Kimi Code config |
| **Env credentials** | Supports both the `api_key` field and env-table keys (e.g. `OPENAI_API_KEY`) |
| **Global settings** | Thinking toggle/level, loop retries, background tasks, permission rules, lifecycle hooks (Kimi Code only) |
| **Raw JSON editing** | Power users can hand-edit the full config JSON (unknown fields are preserved, never dropped) |
| **i18n** | Simplified Chinese / English, switched at runtime |
| **Auto backup** | Before writing the Kimi Code / Pi native configs, back up with timestamp-based names and keep the last 7 days (see `src-tauri/src/config_io.rs`) |
| **Shortcuts** | Ctrl+S save, Ctrl+R reload, Ctrl+O open config dir |
| **Validation (reserved)** | i18n error strings are defined (duplicate names, missing credentials, missing Vertex fields, etc.), but the backend `validators.rs` is a stub and not yet wired |
| **Unsaved-changes prompt** | Detects unsaved edits before closing the window and prefixes the title bar with `*` |

## Architecture Overview

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
       │  SQLite              │      │  Agent native configs    │
       │  ~/.kimi-switch/       │      │  ├─ ~/.kimi-code/        │
       │    kimi-switch.db      │      │  │  └─ config.toml       │
       │                      │      │  └─ ~/.pi/agent/         │
       │  (Kimi Switch internal)│      │     ├─ models.json      │
       └──────────────────────┘      │     └─ settings.json     │
                                     └──────────────────────────┘
```

**Key design points**:

- For Kimi Code, `config.toml` is the **authoritative source** for provider/model data: all providers and models are always written in full, and `default_model` selects the active one (matching the CLI's native `/provider` behaviour)
- SQLite stores only Kimi Switch-private metadata (notes, official URLs, per-provider remembered default model) and acts as a fallback when `config.toml` is incomplete
- On load, `config.toml` takes precedence, so providers added/edited/deleted via the CLI's `/provider` are correctly reflected — switching no longer overwrites or loses them
- The `raw_other` field passes unknown keys through untouched (including `[oauth]` blocks), so round-trips never lose fields
- Pi behaviour is unchanged: switching still writes only the active provider to `models.json`

## Supported Provider Types

| Type | Identifier | Default base_url | Model discovery | Credentials |
| --- | --- | --- | --- | --- |
| Kimi | `kimi` | `https://api.openai.com/v1` | ✅ OpenAI protocol | `KIMI_API_KEY` or `env.KIMI_API_KEY` |
| Anthropic | `anthropic` | — | ✅ `/v1/models` | `ANTHROPIC_API_KEY` or `env` |
| OpenAI | `openai` | `https://api.openai.com/v1` | ✅ `/models` | `OPENAI_API_KEY` or `env` |
| OpenAI Responses | `openai_responses` | `https://api.openai.com/v1` | ✅ `/models` | `OPENAI_API_KEY` or `env` |
| Google GenAI | `google-genai` | `https://generativelanguage.googleapis.com` | ✅ `/v1beta/models` | `GOOGLE_API_KEY` or `env` |
| Vertex AI | `vertexai` | — | ⚠️ Not yet implemented | `VERTEXAI_API_KEY` + `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` |

Credential precedence: the `api_key` field wins over the same-named key in the `env` table.

## Data Storage Locations

| File | Purpose | Backup |
| --- | --- | --- |
| `%USERPROFILE%\.kimi-switch\kimi-switch.db` | Kimi Switch's own SQLite database, holding metadata (notes/official URLs/remembered models) + migration fallback | — |
| `%USERPROFILE%\.kimi-code\config.toml` | Kimi Code CLI's TOML config (**authoritative source, written on switch/save**) | `backups/config.toml.bak.{YYYYMMDD_HHMMSS}` next to it, kept 7 days |
| `%USERPROFILE%\.pi\agent\models.json` | Pi's provider+model config (**written on switch**) | `backups/models.json.bak.{YYYYMMDD_HHMMSS}` next to it, kept 7 days |
| `%USERPROFILE%\.pi\agent\settings.json` | Pi's default provider/model (**written on switch**) | `backups/settings.json.bak.{YYYYMMDD_HHMMSS}` next to it, kept 7 days |
| `localStorage[kimi-switch-agent]` | Frontend remembers the last selected agent (kimi_code / pi) | — |

Environment-variable overrides:

- `KIMI_CODE_HOME` overrides the Kimi Code config dir (default `~/.kimi-code`)
- `PI_CODING_AGENT_DIR` overrides the Pi agent config dir (default `~/.pi/agent`)

## Getting Started

### Prerequisites

| Tool | Version | Purpose |
| --- | --- | --- |
| Node.js | ≥ 18 | Frontend build |
| Rust | Latest stable (edition 2021) | Tauri backend compilation |
| WebView2 Runtime | Bundled with Windows 10/11 | Tauri v2 runtime |
| Microsoft C++ Build Tools | Latest | Rust compile dependency |
| WiX Toolset 3.14 | `src-tauri/wix314-binaries/` | MSI bundling (auto-downloaded on first build) |

### Install

```bash
npm install
```

### Dev mode (hot reload)

```bash
npm run tauri-dev
```

Starts both the Vite dev server (port 1420) and the Tauri window. Frontend edits hot-reload; Rust edits trigger a recompile.

### Frontend-only dev (no Tauri window)

```bash
npm run dev
```

Good for pure UI debugging.

## Development Guide

### Project structure

```
.
├── src/                          # React frontend
│   ├── App.tsx                   # Root component routing ProviderList/ProviderEdit
│   ├── main.tsx                  # React entry + ErrorBoundary + I18nProvider
│   ├── components/
│   │   ├── ProviderList.tsx      # Provider list + switch button
│   │   ├── ProviderEdit.tsx      # Edit provider + model mapping + raw JSON
│   │   └── AgentSettingsPanel.tsx# Global settings (thinking/loop/permissions/hooks)
│   ├── hooks/
│   │   └── useConfig.ts          # Config load/save hook
│   ├── lib/
│   │   ├── agent-settings.ts     # AgentSettings parse/serialize
│   │   └── model-defaults.ts     # Default model context sizes
│   ├── types/index.ts            # Provider/Model/Config type definitions
│   ├── i18n/
│   │   ├── zh.ts                 # Chinese translations (143 keys)
│   │   ├── en.ts                 # English translations
│   │   └── index.tsx             # useTranslation hook + Provider
│   └── index.css                 # Tailwind entry
│
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── lib.rs                # Tauri Builder + invoke_handler registration
│   │   ├── main.rs               # Binary entry
│   │   ├── commands.rs           # 7 Tauri commands
│   │   ├── db.rs                 # SQLite persistence
│   │   ├── kimi_code_io.rs       # ~/.kimi-code/config.toml read/write
│   │   ├── pi_io.rs              # ~/.pi/agent/*.json read/write
│   │   ├── config_io.rs          # File backup utilities
│   │   ├── models.rs             # Config/Provider/Model data structures
│   │   ├── profile_manager.rs    # Multi-profile management (stub)
│   │   └── validators.rs         # Config validation
│   ├── capabilities/             # Tauri permission declarations
│   ├── icons/                    # App icons (script-generated)
│   └── tauri.conf.json           # Tauri config (window/bundle/CSP)
│
├── scripts/generate-icons.py     # Generate all icon sizes from SVG
├── public/kimi.svg               # App icon source (blue-purple gradient π)
└── docs/superpowers/             # Design specs & implementation plans
```

### Tauri commands (frontend ↔ backend)

| Command | Description |
| --- | --- |
| `load_agent_config_command(agent)` | Load config: Kimi Code reads `config.toml` as the authoritative source, enriched with SQLite metadata; Pi reads SQLite first |
| `save_agent_config_command(agent, config)` | Save to SQLite; for Kimi Code also writes `config.toml` |
| `activate_agent_config_command(agent)` | Write to the agent's native config (Kimi Code writes all providers — `default_model` picks the active one; Pi writes only the active provider) |
| `open_agent_config_dir(agent)` | Open the agent's config dir in the system file manager |
| `get_app_version()` | Return the `Cargo.toml` version |
| `list_provider_models(provider)` | Fetch model list from the provider API (async) |
| `debug_log(message)` | Forward frontend logs to stderr (dev use) |

### Adding a new provider type

1. Add a new variant to the `ProviderType` enum in `src-tauri/src/models.rs`
2. Add a default in `default_base_url()`
3. Add a dispatch arm in `commands.rs::list_provider_models`
4. Add mappings in `kimi_code_io.rs::provider_type_for_kimi_type` and `pi_io.rs::provider_type_for_pi_api`
5. Add an option to the API-format dropdown in `src/components/ProviderEdit.tsx`
6. Add new i18n keys in `src/i18n/{zh,en}.ts`

### Adding a new Tauri command

1. Add a `#[tauri::command]` in `src-tauri/src/commands.rs`
2. Register it in the `tauri::generate_handler![...]` list in `src-tauri/src/lib.rs`
3. Call it from the frontend with `import { invoke } from "@tauri-apps/api/core"`
4. Add a permission in `src-tauri/capabilities/default.json` (if filesystem access is needed)

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl + S` | Save current changes to SQLite + config.toml (Kimi Code) |
| `Ctrl + R` | Reload config (prompts if unsaved) |
| `Ctrl + O` | Open the current agent's config dir |

## Internationalization

- Translation sources: `src/i18n/zh.ts` (source) and `src/i18n/en.ts` (target)
- When adding a key, **add it to `zh.ts` first** — the `Record<TranslationKey, string>` type in `en.ts` will flag any missing entry at compile time
- Language is switched at runtime via the top-right dropdown and held in component state (not persisted to SQLite)

## Testing

### Rust unit tests

```bash
cd src-tauri
cargo test
```

Currently covered:

- `kimi_code_io::tests` — TOML import/export round-trips
- `pi_io::tests` — JSON round-trips, including advanced fields (headers/compat/cost/extra)

### Frontend

No automated tests yet. Suggested manual checklist:

- [ ] Switching agents doesn't cross-contaminate configs
- [ ] Deleting a provider also deletes its models
- [ ] The default model restores correctly after switching providers
- [ ] Renaming a provider updates models that reference it
- [ ] Raw-JSON editing preserves `raw_other` fields

## Build & Release

```bash
npm run tauri-build
```

Output:

- `src-tauri/target/release/bundle/msi/Kimi Switch_0.3.0_x64_en-US.msi`

A Windows installer (MSI) with the WebView2 bootstrapper embedded for auto-download. `nsis` is disabled; only MSI is produced.

### v0.3.0 Release Notes

New dashboard and session management features, ported from [kimicode-dashboard](https://github.com/JochenYang/kimicode-dashboard) (MIT, © JochenYang). Many thanks to the original author for their open-source contribution.

- **Dashboard**: 8 KPI cards, daily trend chart (per-model stacked bars, double-click for per-model breakdown modal), full-year heatmap (5-level token coloring with hover tooltip), paginated recent requests (30/page)
- **Session management**: browse by workspace, preview (streaming line-by-line read, 20MB byte cap, 500-char collapse with expand toggle), archive/unarchive/bulk delete
- **Timezone fix**: `today` range, heatmap, and `day_key` now use the local calendar day — UTC+8 users no longer see empty data after midnight
- **Pi option hidden**: the Pi tab has been removed from the navigation bar (code preserved, UI only)
- **Supported providers**: Kimi / Anthropic / OpenAI / OpenAI Responses / Google GenAI / Vertex AI

### First build

The first run downloads:

- WiX Toolset 3.14 binaries → `src-tauri/wix314-binaries/`
- WebView2 bootstrapper → embedded into the MSI

## FAQ

**Q: Kimi Code didn't pick up the change after switching providers?**
A: Run `/reload` inside the Kimi Code session (the CLI only re-reads `~/.kimi-code/config.toml` on reload). The app shows this hint in the UI.

**Q: I edited the config but closed the window without saving?**
A: A native `beforeunload` prompt appears before closing, and the title bar shows a `*` prefix.

**Q: How do I back up / migrate my config?**
A: For Kimi Code, `config.toml` itself is the authoritative full config — back it up directly. SQLite holds extra metadata (notes, official URLs); back up `kimi-switch.db` too if you need those. For Pi, back up `kimi-switch.db`.

**Q: Why can't Vertex AI fetch the model list?**
A: Vertex requires GCP project/location credentials. The current implementation leaves a TODO pending GCP SDK integration.

**Q: macOS / Linux support?**
A: The code doesn't depend on Windows-only APIs, but `tauri.conf.json` only targets `msi` for bundling. In theory, changing `bundle.targets` to `["app", "dmg"]` etc. would enable cross-platform builds, but this is unverified.

## Security Notes

- API keys are stored in plaintext in the local SQLite database and agent native configs — **do not store them on shared computers**
- Do not commit `kimi-switch.db`, `config.toml`, or `models.json` to Git
- The app CSP is tightened (`default-src 'self'`), but WebView2 may still cache form content — log out when finished on public machines

---

## Appendix: Related Projects

- [Kimi Code CLI](https://github.com/MoonshotAI/kimi-cli) — one of the compatible agents
- [Tauri](https://tauri.app) — the desktop app framework
- Design specs in `docs/superpowers/specs/`, implementation plans in `docs/superpowers/plans/`

## Credits

The usage dashboard and session manager are ported from [kimicode-dashboard](https://github.com/JochenYang/kimicode-dashboard) (MIT License, © JochenYang). The original project implements local token usage analytics and session management for Kimi Code CLI. The Rust backend (`src-tauri/src/dashboard.rs`), dashboard UI (`src/components/dashboard/`), and sessions page (`src/components/sessions/`) in this project are derived from that work. Many thanks to the original author.

---

License: MIT, see [LICENSE](./LICENSE). Copyright (c) 2026 CodingPlan.site