# Kimi Switch

> A Windows desktop **Kimi Code CLI** configuration manager — unify multi-provider LLM setup, models, icons, connectivity testing, usage analytics, and update checks in one place.

**English** | [中文](./README.md)

[![Tauri](https://img.shields.io/badge/Tauri-v2-blue?logo=tauri)](https://tauri.app)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-2021-ed764d?logo=rust)](https://www.rust-lang.org)
[![Version](https://img.shields.io/badge/release-v0.5.2-brightgreen)](https://git.codingplan.site/admin/KimiCodeSwitch/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

---

## Table of Contents

- [What Is This](#what-is-this)
- [Key Features](#key-features)
- [Screenshots](#screenshots)
- [Architecture Overview](#architecture-overview)
- [Feature Details](#feature-details)
- [Supported Provider Types](#supported-provider-types)
- [Data Storage Locations](#data-storage-locations)
- [Getting Started](#getting-started)
- [Development Guide](#development-guide)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Internationalization](#internationalization)
- [Testing](#testing)
- [Build & Release](#build--release)
- [Release History](#release-history)
- [FAQ](#faq)
- [Security Notes](#security-notes)
- [Credits](#credits)

---

## What Is This

**Kimi Switch** is a Windows desktop configuration tool built for [Kimi Code CLI](https://github.com/MoonshotAI/kimi-code) users. It pulls the hand-editing of `~/.kimi-code/config.toml` into a GUI and adds a pile of conveniences the CLI itself doesn't ship:

- **Unified multi-provider management** — Kimi / Anthropic / OpenAI / OpenAI Responses / Google GenAI / Vertex AI in one view; newly added providers are **automatically promoted to the top of the list**, and switching never overwrites or loses them
- **One-click model discovery** — fetch the available model list from the provider API; display names, context size, and capabilities **prefer the models.dev cache** (backend/UI fallback for missing fields)
- **Connectivity testing** — GET `base_url` (cc-switch semantics), with a coloured latency bubble (green / orange / red) that auto-dismisses in 6 seconds
- **Duplicate provider** — deep-copy an existing provider along with all its models in one click; the key becomes `xxx-copy`
- **Icon system** — 100+ first-party provider brand icons, adapted from cc-switch; unmatched providers get a deterministic initial-letter placeholder
- **Usage dashboard** — ported from kimicode-dashboard: KPIs / heatmap / per-model daily trend stacked bars / paginated recent requests
- **Session manager** — per-workspace browsing, preview, archive, and bulk delete for Kimi Code sessions
- **Update check** — auto-check on launch (toggleable) and one-click download + install
- **Theme / language** — dark / light / follow-system themes; Simplified Chinese / English
- **Windows polish** — single instance; minimize keeps the taskbar button; close hides to tray

## Key Features

| Category | Feature |
| --- | --- |
| **Multi-provider** | Kimi / Anthropic / OpenAI / OpenAI Responses / Google GenAI / Vertex AI |
| **Multi-agent** | Primary target is Kimi Code; Pi code is preserved but hidden from the UI |
| **Icon system** | 100+ first-party icons + initial-letter fallback; picker grouped by brands / inference |
| **Quick switch** | Added/activated providers move to the top of the list; switching only changes `default_model` and never drops other providers |
| **Connectivity test** | Real `base_url` latency, coloured bubble (green / orange / red), auto-dismiss in 6 seconds |
| **Duplicate provider** | Deep-copy a provider + all its models; key auto-suffixed to `xxx-copy` |
| **Iconified actions** | Activate / Edit / Duplicate / Test Connectivity / Delete via lucide-react |
| **Model mapping** | Alias (`"provider/model"`) ↔ real model ID, with display name, context size, 1M-context flag, and capabilities |
| **Auto context size** | On model fetch: **API response > models.dev ref > regex fallback** — three-tier priority |
| **Auto capabilities** | `image_in / video_in / tool_use` all derived from models.dev; UI only exposes `thinking` as a manual toggle |
| **Global settings** | Full `[thinking]` table (enabled / effort / keep); Kimi Code only |
| **Raw JSON editing** | Power users can hand-edit the full config; unknown fields pass through `raw_other` and never get dropped |
| **i18n / Theme** | Simplified Chinese / English; dark / light / follow-system; persisted |
| **Auto backup** | Before writing `config.toml`, backup with timestamp-based names kept 7 days |
| **Shortcuts** | `Ctrl+S` save, `Ctrl+R` reload, `Ctrl+O` open config dir |
| **Usage dashboard** | 8 KPIs, per-model stacked daily trend, full-year heatmap, paginated recent requests, double-click bars for per-model breakdown modal |
| **Session manager** | Per-workspace browsing, archive/unarchive, bulk delete; streaming line-by-line preview (20MB cap + 500-char collapse) |
| **Update check** | Auto-check on launch + every 8h periodic + manual; download progress bar; guided install after download |
| **Unsaved-changes prompt** | Native `beforeunload` warning + `*` prefix in title bar |
| **Window / tray** | Minimize keeps the taskbar button; close X hides to tray; tray left-click always shows + focuses |

## Screenshots

**Provider list** (light theme)

![Provider list](docs/screenshots/providers.png)

Active provider, default model, latency bubble, model count, and brand icons at a glance. Quick switch, copy, test connectivity, open website, edit, delete.

**Edit provider — basic info**

![Edit provider — basic info](docs/screenshots/provider-basic-info.png)

Provider name, notes, official URL, managed-provider toggle, API format, API key, and base URL.

**Edit provider — model mapping**

![Edit provider — model mapping](docs/screenshots/provider-model-mapping.png)

A single table for all model mappings: display name, real model ID, context length, 1M-context flag, capability (thinking only), default toggle, delete.

**Usage dashboard**

![Usage dashboard](docs/screenshots/dashboard.png)

8 KPIs (requests, non-cached input, output, cache read / write / hit, total tokens, estimated cost) + full-year heatmap + per-model stacked daily trend (bottom-aligned) + per-model usage table + paginated recent requests.

**Session manager**

![Session manager](docs/screenshots/sessions.png)

Per-workspace Kimi Code session browsing, active / archived / all filters; streaming line-by-line preview (20MB cap, 500-char collapse); archive/unarchive/bulk delete.

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                         Kimi Switch (Tauri v2)                          │
│                                                                        │
│   ┌──────────────────────────┐    ┌──────────────────────────────┐    │
│   │   React Frontend (TS)    │    │   Rust Backend (lib.rs)      │    │
│   │                          │    │                              │    │
│   │   src/App.tsx            │    │   src-tauri/src/             │    │
│   │   src/components/        │◄──►│     ├── lib.rs               │    │
│   │     ProviderList         │    │     ├── main.rs              │    │
│   │     ProviderEdit         │    │     ├── commands.rs          │    │
│   │     AgentSettingsPanel   │    │     ├── db.rs                │    │
│   │     SettingsModal        │    │     ├── kimi_code_io.rs      │    │
│   │     ProviderIcon /       │    │     ├── pi_io.rs (legacy)    │    │
│   │     IconPicker           │    │     ├── config_io.rs         │    │
│   │     dashboard/           │    │     ├── models.rs            │    │
│   │     sessions/            │    │     ├── validators.rs        │    │
│   │   src/hooks/             │    │     ├── dashboard.rs         │    │
│   │     useConfig / Dashboard│    │     └── profile_manager.rs   │    │
│   │     / Sessions / Theme   │    │                              │    │
│   │     / UpdateCheck        │    │                              │    │
│   │   src/lib/               │    │                              │    │
│   │   src/icons/             │    │                              │    │
│   │   src/i18n/{zh,en}.ts    │    │                              │    │
│   │   src/types/{...}        │    │                              │    │
│   └──────────────────────────┘    └──────────────────────────────┘    │
│                  │                                  │                  │
└──────────────────┼──────────────────────────────────┼──────────────────┘
                   │                                  │
                   ▼                                  ▼
        ┌──────────────────────┐      ┌──────────────────────────┐
        │  SQLite              │      │  Agent native configs    │
        │  ~/.kimi-switch/      │      │  ├─ ~/.kimi-code/        │
        │    kimi-switch.db     │      │  │  └─ config.toml       │
        │  (metadata + fallback)│     │  └─ ~/.pi/agent/         │
        │  + localStorage       │      │     ├─ models.json       │
        │   (theme / lang /     │      │     └─ settings.json     │
        │    update-check)      │      │                          │
        └──────────────────────┘      └──────────────────────────┘
                                              ▲
                                              │
                                  ┌──────────────────────────────┐
                                  │  models.dev snapshot (FE)    │
                                  │  src/lib/models-dev.json      │
                                  │  + scripts/fetch-models-      │
                                  │    dev.mjs (optional refresh) │
                                  └──────────────────────────────┘
```

**Key design points**:

- **`config.toml` is the authoritative source for Kimi Code**: all providers and models are always written in full; `default_model` selects the active one (matching the CLI's native `/provider` behaviour). Switching only changes `default_model`; newly added providers are auto-promoted to the top of the list and never get overwritten
- **SQLite holds Kimi Switch-private metadata only**: notes, official URLs, per-agent remembered default model (the `settings` table), ordering. Theme / language / last-update-check live in frontend `localStorage` (WebView2), not under `~/.kimi-switch`. It acts as a fallback when `config.toml` is incomplete
- **`raw_other` passes unknown fields through untouched**, including `[oauth]` blocks — round-trips never drop fields
- **models.dev snapshot**: derived from `https://models.dev/api.json`, cached to a local JSON; `capabilitiesFromRef` derives `thinking / image_in / video_in / tool_use`, `getModelRef` derives `max_context_size / display_name`
- **Override env vars**: `KIMI_CODE_HOME` / `PI_CODING_AGENT_DIR` override the Kimi Code / Pi dirs; Kimi Switch's own data dir is fixed at `~/.kimi-switch` (no env override yet). See [Data Storage Locations](#data-storage-locations)

## Feature Details

### Provider priority & switching

- **Auto-promote to top on add/activate**: when you add or switch a provider, it moves to the first position in `db.providers`; the UI renders the freshest order immediately
- **Switching only changes `default_model`**: all providers are written to `config.toml`, only the switched one becomes `default_model` — consistent with Kimi Code CLI's `/provider`
- **Never overwrites**: providers added/edited/deleted via the CLI's `/provider` are correctly reflected on load (config.toml wins), and fully persisted on next save

### Icon system

- Library adapted from cc-switch (`src/icons/extracted/`, 100+ first-party brand icons)
- Providers without an exact match get a deterministic **initial-letter placeholder** (e.g. `kimi-code` → `K`, `deepseek-v4` → `D`)
- `IconPicker` has brands / inference groups; the chosen icon is saved to `provider.icon`

### Connectivity test

- Backend `test_connectivity` command: GET `provider.base_url`; any HTTP response = reachable
- Returns `{ ok, latency_ms, status_code, error }`
- Frontend renders a **coloured bubble** (green / orange / red + ms) inline; auto-dismisses in 6 seconds
- The bubble sits before the "active / switch" button so it doesn't block the sight

### Duplicate provider

- Click the duplicate icon → deep-copy the provider + all its models
- `provider.name` gets a `-copy` suffix; model keys auto-suffix to `xxx-copy`
- Immediately persisted to SQLite + `config.toml`; toast confirmation

### Auto context size & capabilities

- On fetch, `max_context_size` priority: **API response > models.dev ref > regex fallback**
- models.dev ref → `capabilities = ["thinking","image_in","video_in","tool_use"]` (filtered by truthy fields)
- UI exposes **only the `thinking` checkbox**. Other capabilities are still auto-written but not manually editable — this matches Kimi Code's semantics: capabilities can only be added, never removed
- `always_thinking` can only be set manually (models.dev can't derive it). The UI hides it; edit `config.toml` directly when needed

### Capability vs thinking switch

- **Model capability** (`capabilities`) = "can it": declares whether the model supports thinking. Without `thinking`, the global switch has no effect on this model
- **Global `[thinking]`** (settings panel) = "do we want": new sessions default on/off, effort level (low/medium/high/max), and whether to keep thinking content
- `always_thinking` forces thinking on, ignoring the global switch
- Global settings apply to Kimi Code only

### Usage dashboard

- 8 KPIs, per-model stacked daily trend (**bottom-aligned layout**), full-year heatmap (5-level token colouring), paginated recent requests (30/page)
- Double-click a daily bar → `DailyDetailModal` with per-model breakdown
- Data source: `src-tauri/src/dashboard.rs` + `src/hooks/useDashboard.ts`

### Session manager

- Per-workspace Kimi Code session browsing, active / archived / all filters
- Streaming line-by-line preview (20MB cap, 500-char collapse with expand)
- Archive / unarchive / bulk delete
- Earlier "instant crash" issues fixed via streaming reads + size limits

### Settings modal

- **Theme**: dark / light / follow-system (`useTheme`, persisted to frontend `localStorage`)
- **Language**: Simplified Chinese / English
- **Version**: current version + last-checked timestamp
- **Update check**: launch auto + every 8h periodic + manual; download with progress bar; guided install after completion

### Window & tray

- **Minimize**: keeps the taskbar button (no longer hijacked to tray)
- **Close (X)**: `prevent_close` + `hide` → hides to tray instead of quitting
- **Tray menu**: Show / Quit
- **Tray left-click**: always `show + unminimize + focus` (no toggle hide)
- **Second launch**: `single_instance` plugin catches it, brings window to front and focuses

## Supported Provider Types

| Type | Identifier | Default base_url | Model discovery | Credentials |
| --- | --- | --- | --- | --- |
| Kimi | `kimi` | `https://api.openai.com/v1` | ✅ OpenAI protocol | `KIMI_API_KEY` or `env.KIMI_API_KEY` |
| Anthropic | `anthropic` | — | ✅ `/v1/models` | `ANTHROPIC_API_KEY` or `env` |
| OpenAI | `openai` | `https://api.openai.com/v1` | ✅ `/models` | `OPENAI_API_KEY` or `env` |
| OpenAI Responses | `openai_responses` | `https://api.openai.com/v1` | ✅ `/models` | `OPENAI_API_KEY` or `env` |
| Google GenAI | `google-genai` | `https://generativelanguage.googleapis.com` | ✅ `/v1beta/models` | `GOOGLE_API_KEY` or `env` |
| Vertex AI | `vertexai` | — | ⚠️ Not yet implemented | `VERTEXAI_API_KEY` + `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` |

Credential precedence: `api_key` field > same-named key in `env` table.

## Data Storage Locations

| File | Purpose | Backup |
| --- | --- | --- |
| `%USERPROFILE%\.kimi-switch\kimi-switch.db` | Kimi Switch's own SQLite — metadata (notes / official URLs / remembered default model + ordering) + fallback | — |
| `%USERPROFILE%\.kimi-code\config.toml` | Kimi Code CLI TOML config (**authoritative source, written on switch/save**) | `backups/config.toml.bak.{YYYYMMDD_HHMMSS}` next to it, kept 7 days |
| `%USERPROFILE%\.pi\agent\models.json` | Pi provider + model config (**written on switch**) | `backups/models.json.bak.{YYYYMMDD_HHMMSS}` next to it, kept 7 days |
| `%USERPROFILE%\.pi\agent\settings.json` | Pi default provider/model (**written on switch**) | `backups/settings.json.bak.{YYYYMMDD_HHMMSS}` next to it, kept 7 days |
| WebView2 `localStorage` | Frontend state: `kimi-switch-theme` / `kimi-switch-lang` / `kimi-switch-last-update-check` / `kimi-switch-agent` / `kimi-switch-dashboard-range` (theme / language / last-update-check / last-selected agent / dashboard range) | — |
| `src/lib/models-dev.json` | models.dev `api.json` snapshot (bundled with the frontend) | — |

Environment-variable overrides:

- `KIMI_CODE_HOME` overrides the Kimi Code config dir (default `~/.kimi-code`)
- `PI_CODING_AGENT_DIR` overrides the Pi agent config dir (default `~/.pi/agent`)
- Kimi Switch's own data dir is fixed at `~/.kimi-switch` (**no env override yet**)

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
├── src/                              # React frontend
│   ├── App.tsx                       # Root component routing provider list / edit / dashboard / sessions
│   ├── main.tsx                      # React entry + ErrorBoundary + I18nProvider
│   ├── components/
│   │   ├── ProviderList.tsx          # Provider list + switch / duplicate / test / edit / delete
│   │   ├── ProviderEdit.tsx          # Edit provider + model mapping + raw JSON + capabilities
│   │   ├── AgentSettingsPanel.tsx    # Kimi Code global settings (thinking / loop / permissions / hooks)
│   │   ├── SettingsModal.tsx         # Settings modal (theme / language / version / update check)
│   │   ├── ProviderIcon.tsx          # Provider brand icons (with initial-letter fallback)
│   │   ├── IconPicker.tsx            # Icon picker (brands / inference groups)
│   │   ├── dashboard/                # Usage dashboard
│   │   │   ├── DashboardPage.tsx
│   │   │   ├── DailyBars.tsx
│   │   │   ├── DailyDetailModal.tsx
│   │   │   └── Heatmap.tsx
│   │   └── sessions/                 # Session manager
│   │       └── SessionsPage.tsx
│   ├── hooks/
│   │   ├── useConfig.ts              # Config load/save
│   │   ├── useDashboard.ts           # Dashboard data
│   │   ├── useSessions.ts            # Session data
│   │   ├── useTheme.ts               # Theme switch
│   │   └── useUpdateCheck.ts         # Update check + download
│   ├── lib/
│   │   ├── agent-settings.ts         # AgentSettings parse/serialize
│   │   ├── model-defaults.ts         # Default model context sizes
│   │   ├── models-dev.ts             # models.dev snapshot lookup + capability mapping
│   │   ├── models-dev.json           # Bundled snapshot
│   │   └── dashboard-format.ts       # Dashboard formatting
│   ├── icons/
│   │   ├── brands.ts                 # Brand icon entry
│   │   ├── inference.ts              # Inference-service icons
│   │   └── extracted/                # Icon library adapted from cc-switch
│   │       ├── index.ts
│   │       └── metadata.ts
│   ├── types/
│   │   ├── index.ts                  # Provider / Model / Config
│   │   ├── dashboard.ts
│   │   ├── sessions.ts
│   │   └── icon.ts
│   ├── i18n/
│   │   ├── zh.ts                     # Chinese translations (source)
│   │   ├── en.ts                     # English translations
│   │   └── index.tsx                 # useTranslation hook + Provider
│   └── index.css                     # Tailwind entry
│
├── src-tauri/                        # Rust backend
│   ├── src/
│   │   ├── lib.rs                    # Tauri Builder + tray + window events + invoke_handler
│   │   ├── main.rs                   # Binary entry
│   │   ├── commands.rs               # ~14 Tauri commands
│   │   ├── db.rs                     # SQLite persistence
│   │   ├── kimi_code_io.rs           # ~/.kimi-code/config.toml read/write
│   │   ├── pi_io.rs                  # ~/.pi/agent/*.json read/write (preserved)
│   │   ├── config_io.rs              # File backup utilities
│   │   ├── models.rs                 # Config / Provider / Model data structures
│   │   ├── profile_manager.rs        # Multi-profile management (stub)
│   │   ├── validators.rs             # Config validation
│   │   └── dashboard.rs              # Session / usage data aggregation
│   ├── capabilities/                 # Tauri permission declarations
│   ├── icons/                        # App icons (script-generated)
│   └── tauri.conf.json               # Tauri config (window / bundle / CSP)
│
├── scripts/
│   ├── fetch-models-dev.mjs          # Refresh models-dev.json snapshot
│   └── generate-icons.py             # Generate all icon sizes from SVG
├── public/kimi.svg                   # App icon source (blue-purple gradient π)
└── docs/
    ├── screenshots/                  # Screenshots referenced by the README
    └── superpowers/                  # Design specs & implementation plans
```

### Tauri commands (frontend ↔ backend)

| Command | Description |
| --- | --- |
| `load_agent_config_command(agent)` | Load config: Kimi Code reads `config.toml` as authoritative + SQLite metadata; Pi reads SQLite first |
| `save_agent_config_command(agent, config)` | Save to SQLite; for Kimi Code also writes `config.toml` |
| `activate_agent_config_command(agent)` | Write to the agent's native config (Kimi Code writes all providers — `default_model` picks the active one; Pi writes only the active provider) |
| `open_agent_config_dir(agent)` | Open the agent's config dir in the system file manager |
| `get_app_version()` | Return the `Cargo.toml` version |
| `list_provider_models(provider)` | Fetch the model list from the provider API (async, paginated) |
| `test_connectivity(provider)` | GET `base_url` connectivity test, returns `{ ok, latency_ms, status_code, error }` |
| `get_app_setting(key)` | Read an app setting (theme / language / last-update-check) |
| `set_app_setting(key, value)` | Write an app setting |
| `check_for_update()` | Check GitHub releases; returns version + asset URL |
| `download_update(url, path)` | Stream-download the update; emits `download-progress` / `download-complete` events |
| `open_installer(path)` | Open the downloaded installer via the system shell |
| `dashboard::get_paths()` / `get_prices()` / `get_summary()` / `list_sessions()` / `archive_session()` / `unarchive_session()` / `delete_session()` / `delete_workspace()` / `get_session_preview()` | Dashboard & session commands |
| `debug_log(message)` | Forward frontend logs to stderr (dev use) |

### Adding a new provider type

1. Add a new variant to the `ProviderType` enum in `src-tauri/src/models.rs`
2. Add a default in `default_base_url()`
3. Add a dispatch arm in `commands.rs::list_provider_models`
4. Add a mapping in `kimi_code_io.rs::provider_type_for_kimi_type`
5. Add an option to the API-format dropdown in `src/components/ProviderEdit.tsx`
6. Add new i18n keys in `src/i18n/{zh,en}.ts`

### Adding a new Tauri command

1. Add a `#[tauri::command]` in `src-tauri/src/commands.rs`
2. Register it in `tauri::generate_handler![...]` in `src-tauri/src/lib.rs`
3. Call it from the frontend with `import { invoke } from "@tauri-apps/api/core"`
4. Add a permission in `src-tauri/capabilities/default.json` (if filesystem/network is needed)

### Adding a new model capability

1. Add a new key to `KNOWN_CAPABILITIES` in `src/components/ProviderEdit.tsx`
2. Add an i18n mapping in `CAPABILITY_LABELS`
3. Add translations in `src/i18n/{zh,en}.ts`
4. Add derivation in `capabilitiesFromRef` in `src/lib/models-dev.ts` (if it can be derived from models.dev)

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl + S` | Save current changes to SQLite + `config.toml` (Kimi Code) |
| `Ctrl + R` | Reload config (prompts if unsaved) |
| `Ctrl + O` | Open the current agent's config dir |

## Internationalization

- Sources: `src/i18n/zh.ts` (source) + `src/i18n/en.ts` (target)
- When adding a key, **add it to `zh.ts` first** — the `Record<TranslationKey, string>` type in `en.ts` will flag missing entries at compile time
- `useTranslation` hook exposes `{ t, lang, setLang }`
- Runtime switch is provided by `SettingsModal`; persisted to frontend `localStorage` (`kimi-switch-lang`)

## Testing

### Rust unit tests

```bash
cd src-tauri
cargo test
```

Currently covered:

- `kimi_code_io::tests` — TOML import/export round-trips
- `pi_io::tests` — JSON round-trips, including advanced fields (headers / compat / cost / extra)
- `validators::tests` — Config validation
- `dashboard::tests` — Usage aggregation and timezone handling

### Frontend

No automated tests yet. Suggested manual checklist:

- [ ] Default model restores correctly after switching providers
- [ ] Newly added providers auto-promote to the top of the list
- [ ] Duplicate provider generates non-conflicting keys
- [ ] Connectivity test bubble auto-dismisses after 6 seconds
- [ ] Close X hides to tray; minimize keeps taskbar button
- [ ] Theme switch (dark / light / follow-system) takes effect immediately
- [ ] Language switch updates UI text in place
- [ ] Update check → download → guided install
- [ ] `max_context_size` auto-fills on model fetch
- [ ] Kimi Code `/reload` picks up new config after switching

## Build & Release

```bash
npm run tauri-build
```

Output:

```
src-tauri/target/release/bundle/msi/Kimi Switch_<version>_x64_en-US.msi
```

A Windows installer (MSI) with the WebView2 bootstrapper embedded for auto-download. `nsis` is disabled; only MSI is produced.

### First build

The first run downloads:

- WiX Toolset 3.14 binaries → `src-tauri/wix314-binaries/`
- WebView2 bootstrapper → embedded into the MSI

### Common build issues

- **`os error 5`** (WiX light step): kill the process first with `taskkill //F //IM kimiswitch.exe`, then retry
- **prebuild times out pulling models.dev**: expected; the local snapshot keeps the build going

## Release History

### v0.5.1 (latest)

- Window / tray: minimize keeps the taskbar button; close X hides to tray; tray left-click always shows + focuses
- Usage table: model column auto-width, long names no longer truncated
- Capability editor: only `thinking` exposed; other capabilities still auto-derived from models.dev
- Model mapping table: theme-aware row divider, no more harsh line in light mode

### v0.5.0

- Iconified actions (lucide-react): activate / edit / duplicate / test / delete
- Duplicate provider (deep-copy a provider + all its models)
- Connectivity test (green / orange / red bubble + 6s auto-dismiss)
- Daily trend bars anchored to the panel bottom

### v0.4.1

- Model discovery pagination (OpenAI / Anthropic / Google), fewer large-list limits hit

### v0.4.0

- Polished icon system (library adapted from cc-switch)
- Settings modal (theme / language)
- Launch-time update check

### v0.3.0

Ported from [kimicode-dashboard](https://github.com/JochenYang/kimicode-dashboard):

- Dashboard: 8 KPIs, daily trend, full-year heatmap, paginated recent requests
- Session manager: per-workspace browsing, preview, archive, bulk delete
- Timezone fix: `today` / heatmap / `day_key` now use local calendar day
- Pi option hidden from the UI

## FAQ

**Q: Switching providers didn't take effect in Kimi Code?**
A: Run `/reload` inside the Kimi Code session (the CLI only re-reads `~/.kimi-code/config.toml` on reload). The app shows this hint in the UI.

**Q: Does switching overwrite other providers?**
A: No. Kimi Code's `config.toml` is always written with all providers, only `default_model` decides which one is active. This matches the CLI's native `/provider` behaviour.

**Q: Where do new / activated providers go?**
A: They auto-promote to the top of the list; the UI reflects it immediately.

**Q: Why does the capability editor only show "thinking"?**
A: Kimi Code's `capabilities` field can only be added to, not removed. models.dev already auto-derives the rest; exposing more manually would just invite mistakes. Edit `config.toml` directly when you need to set `always_thinking` or other special values.

**Q: I edited the config but closed the window without saving?**
A: A native `beforeunload` prompt appears before closing, and the title bar shows a `*` prefix.

**Q: How do I back up / migrate my config?**
A: For Kimi Code, `config.toml` itself is the authoritative full config — back it up directly. SQLite holds notes / official URLs / ordering, back it up too if you need that. Theme / language / last-update-check live in frontend `localStorage` (WebView2), not a standalone file, so they usually don't need separate handling on migration.

**Q: Why can't Vertex AI fetch the model list?**
A: Vertex requires GCP project / location credentials. The current implementation leaves a TODO pending GCP SDK integration.

**Q: macOS / Linux support?**
A: The code doesn't depend on Windows-only APIs, but `tauri.conf.json` only targets `msi` for bundling. In theory, changing `bundle.targets` to `["app", "dmg"]` etc. would enable cross-platform builds, but this is unverified.

**Q: How do I change the theme / language?**
A: Top-right gear → Settings modal → Theme / Language. Saved to frontend `localStorage` (WebView2), persists across restarts.

**Q: I closed the window — how do I get it back?**
A: The close X hides to the tray. Click the tray icon (menu bar / system tray) to bring it back; clicking the taskbar icon toggles minimize/restore normally.

**Q: How is the update check triggered?**
A: It silently checks once on launch, then automatically every 8 hours (silent failure with no network, no error popup). You can also trigger it manually: Settings modal → Version → Update check. Downloads have a progress bar; once done, an "Open installer" button appears.

## Security Notes

- API keys are stored in plaintext in local SQLite and agent native configs — **do not store them on shared computers**
- Do not commit `kimi-switch.db`, `config.toml`, or `models.json` to Git
- The app CSP is tightened (`default-src 'self'`), but WebView2 may still cache form content — log out when finished on public machines

---

## Credits

The usage dashboard and session manager are ported from [kimicode-dashboard](https://github.com/JochenYang/kimicode-dashboard) (MIT License, © JochenYang). The Rust backend (`src-tauri/src/dashboard.rs`), dashboard UI (`src/components/dashboard/`), and sessions page (`src/components/sessions/`) in this project are derived from that work. Many thanks to the original author.

The provider brand icon library (`src/icons/extracted/`) and the icon picker (`src/components/IconPicker.tsx`) are adapted from [cc-switch](https://github.com/farion1231/cc-switch) (MIT License, © Jason Young). Many thanks to the original author.

---

License: MIT, see [LICENSE](./LICENSE). Copyright (c) 2026 CodingPlan.site
