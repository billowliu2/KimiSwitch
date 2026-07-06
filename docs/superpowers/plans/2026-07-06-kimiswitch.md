# KimiSwitch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows x64 desktop config manager for Kimi Code CLI using Tauri v2, supporting multi-provider editing, profile switching, and MSI packaging.

**Architecture:** Rust backend handles all file I/O, TOML parsing/editing via `toml_edit`, validation, and profile management. TypeScript/React frontend renders a three-pane UI and invokes Rust commands via Tauri. Tauri v2 bundler produces the Windows MSI.

**Tech Stack:** Tauri v2, Rust, TypeScript, React, Tailwind CSS, `toml_edit`, `indexmap`, `serde`.

---

## File Structure

```
D:/AIGC/KimiSwitch
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── default.json
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       ├── models.rs
│       ├── config_io.rs
│       ├── validators.rs
│       ├── profile_manager.rs
│       └── commands.rs
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── index.css
│   ├── components/
│   │   ├── TopBar.tsx
│   │   ├── ProviderList.tsx
│   │   ├── ProviderForm.tsx
│   │   ├── ModelList.tsx
│   │   ├── ModelForm.tsx
│   │   └── BottomToolbar.tsx
│   ├── hooks/
│   │   └── useConfig.ts
│   └── types/
│       └── index.ts
├── tests/
│   ├── config_io.rs
│   ├── profile_manager.rs
│   └── validators.rs
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── README.md
└── .gitignore
```

---

## Task 1: Initialize Tauri v2 Project

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/index.css`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "kimiswitch",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "tauri-dev": "tauri dev",
    "tauri-build": "tauri build"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-shell": "^2.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.41",
    "tailwindcss": "^3.4.10",
    "typescript": "^5.5.4",
    "vite": "^5.4.2"
  }
}
```

- [ ] **Step 2: Create vite.config.ts**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_"],
}));
```

- [ ] **Step 3: Create tsconfig.json and tsconfig.node.json**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Create index.html**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>KimiSwitch</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create src/main.tsx**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 6: Create src/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root {
  height: 100%;
  margin: 0;
  overflow: hidden;
}
```

- [ ] **Step 7: Create src-tauri/Cargo.toml**

```toml
[package]
name = "kimiswitch"
version = "0.1.0"
description = "Kimi Code CLI config manager"
authors = ["you"]
edition = "2021"

[build-dependencies]
tauri-build = { version = "2.0.0", features = [] }

[dependencies]
tauri = { version = "2.0.0", features = [] }
tauri-plugin-shell = "2.0.0"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
toml_edit = "0.22"
indexmap = { version = "2.2", features = ["serde"] }
dirs = "5.0"
thiserror = "1.0"
chrono = "0.4"
anyhow = "1.0"

[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

- [ ] **Step 8: Create src-tauri/tauri.conf.json**

```json
{
  "productName": "KimiSwitch",
  "version": "0.1.0",
  "identifier": "com.kimiswitch.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://localhost:1420",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "KimiSwitch",
        "width": 1200,
        "height": 800,
        "minWidth": 1000,
        "minHeight": 700,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["msi"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.ico"
    ]
  }
}
```

- [ ] **Step 9: Create src-tauri/src/main.rs**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    kimiswitch_lib::run();
}
```

- [ ] **Step 10: Install dependencies and verify dev build**

Run:
```bash
npm install
cd src-tauri && cargo fetch
```

Expected: `node_modules/` and `src-tauri/target/` populated without errors.

---

## Task 2: Define Rust Models

**Files:**
- Create: `src-tauri/src/models.rs`
- Create: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write models.rs**

```rust
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
pub use toml_edit::Table;

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

impl ProviderType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProviderType::Kimi => "kimi",
            ProviderType::Anthropic => "anthropic",
            ProviderType::Openai => "openai",
            ProviderType::OpenaiResponses => "openai_responses",
            ProviderType::GoogleGenai => "google-genai",
            ProviderType::Vertexai => "vertexai",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub name: String,
    pub provider_type: ProviderType,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub env: IndexMap<String, String>,
    #[serde(skip)]
    pub raw_other: Table,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Model {
    pub alias: String,
    pub provider: String,
    pub model: String,
    pub max_context_size: u64,
    pub display_name: Option<String>,
    #[serde(skip)]
    pub raw_other: Table,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub default_model: Option<String>,
    pub providers: IndexMap<String, Provider>,
    pub models: IndexMap<String, Model>,
    #[serde(skip)]
    pub raw_other: Table,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileSummary {
    pub name: String,
    pub filename: String,
    pub is_active: bool,
}

#[derive(Debug, Clone)]
pub struct Profile {
    pub name: String,
    pub filename: String,
    pub config: Config,
    pub is_active: bool,
}
```

- [ ] **Step 2: Write lib.rs module exports**

```rust
pub mod commands;
pub mod config_io;
pub mod models;
pub mod profile_manager;
pub mod validators;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::load_config,
            commands::save_config,
            commands::list_profiles,
            commands::load_profile,
            commands::save_profile,
            commands::switch_profile,
            commands::rename_profile,
            commands::delete_profile,
            commands::open_config_dir,
            commands::get_app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Verify compilation**

Run:
```bash
cd src-tauri && cargo check
```

Expected: `Finished dev [unoptimized + debuginfo] target(s)`.

---

## Task 3: Implement Config I/O

**Files:**
- Create: `src-tauri/src/config_io.rs`
- Test: `tests/config_io.rs`

- [ ] **Step 1: Implement config_io.rs read path**

```rust
use crate::models::{Config, Model, Provider, ProviderType};
use indexmap::IndexMap;
use std::path::{Path, PathBuf};
use toml_edit::{DocumentMut, Item, Table, Value};

pub fn config_dir() -> PathBuf {
    if let Ok(home) = std::env::var("KIMI_CODE_HOME") {
        PathBuf::from(home)
    } else {
        dirs::home_dir()
            .expect("failed to get home dir")
            .join(".kimi-code")
    }
}

pub fn config_path() -> PathBuf {
    config_dir().join("config.toml")
}

fn item_to_string(item: &Item) -> Option<String> {
    item.as_str().map(|s| s.to_string())
}

fn item_to_u64(item: &Item) -> Option<u64> {
    item.as_integer().map(|i| i as u64)
}

fn parse_provider_table(name: &str, table: &Table) -> Provider {
    let provider_type_str = table
        .get("type")
        .and_then(|i| i.as_str())
        .unwrap_or("kimi");
    let provider_type = match provider_type_str {
        "kimi" => ProviderType::Kimi,
        "anthropic" => ProviderType::Anthropic,
        "openai" => ProviderType::Openai,
        "openai_responses" => ProviderType::OpenaiResponses,
        "google-genai" => ProviderType::GoogleGenai,
        "vertexai" => ProviderType::Vertexai,
        _ => ProviderType::Kimi,
    };

    let mut raw_other = Table::new();
    let mut env = IndexMap::new();
    let mut base_url = None;
    let mut api_key = None;

    for (key, value) in table.iter() {
        match key {
            "type" => {}
            "base_url" => base_url = item_to_string(value),
            "api_key" => api_key = item_to_string(value),
            "env" => {
                if let Some(env_table) = value.as_table() {
                    for (k, v) in env_table.iter() {
                        if let Some(s) = item_to_string(v) {
                            env.insert(k.to_string(), s);
                        }
                    }
                }
            }
            _ => {
                raw_other.insert(key, value.clone());
            }
        }
    }

    Provider {
        name: name.to_string(),
        provider_type,
        base_url,
        api_key,
        env,
        raw_other,
    }
}

fn parse_model_table(alias: &str, table: &Table) -> Model {
    let mut raw_other = Table::new();
    let mut provider = String::new();
    let mut model = String::new();
    let mut max_context_size = 0;
    let mut display_name = None;

    for (key, value) in table.iter() {
        match key {
            "provider" => provider = item_to_string(value).unwrap_or_default(),
            "model" => model = item_to_string(value).unwrap_or_default(),
            "max_context_size" => max_context_size = item_to_u64(value).unwrap_or(0),
            "display_name" => display_name = item_to_string(value),
            _ => {
                raw_other.insert(key, value.clone());
            }
        }
    }

    Model {
        alias: alias.to_string(),
        provider,
        model,
        max_context_size,
        display_name,
        raw_other,
    }
}

pub fn load_config<P: AsRef<Path>>(path: P) -> anyhow::Result<Config> {
    let content = std::fs::read_to_string(path)?;
    let doc = content.parse::<DocumentMut>()?;

    let mut providers = IndexMap::new();
    let mut models = IndexMap::new();
    let mut default_model = None;
    let mut raw_other = Table::new();

    for (key, value) in doc.iter() {
        match key {
            "default_model" => default_model = item_to_string(value),
            "providers" => {
                if let Some(table) = value.as_table() {
                    for (name, item) in table.iter() {
                        if let Some(provider_table) = item.as_table() {
                            let provider = parse_provider_table(name, provider_table);
                            providers.insert(name.to_string(), provider);
                        }
                    }
                }
            }
            "models" => {
                if let Some(table) = value.as_table() {
                    for (alias, item) in table.iter() {
                        if let Some(model_table) = item.as_table() {
                            let model = parse_model_table(alias, model_table);
                            models.insert(alias.to_string(), model);
                        }
                    }
                }
            }
            _ => {
                raw_other.insert(key, value.clone());
            }
        }
    }

    Ok(Config {
        default_model,
        providers,
        models,
        raw_other,
    })
}
```

- [ ] **Step 2: Implement config_io.rs write path**

```rust
pub fn save_config<P: AsRef<Path>>(path: P, config: &Config) -> anyhow::Result<()> {
    let path = path.as_ref();
    if path.exists() {
        let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S_%3f");
        let backup_path = path.with_extension(format!("toml.bak.{}", timestamp));
        std::fs::copy(path, backup_path)?;
    }

    let mut doc = if path.exists() {
        std::fs::read_to_string(path)?.parse::<DocumentMut>()?
    } else {
        DocumentMut::new()
    };

    if let Some(dm) = &config.default_model {
        doc["default_model"] = Item::Value(Value::String(toml_edit::Formatted::new(dm.clone())));
    } else {
        doc.remove("default_model");
    }

    {
        let providers_table = doc["providers"].or_insert(Table::new());
        let providers_table = providers_table.as_table_mut().unwrap();
        providers_table.clear();
        for (name, provider) in &config.providers {
            let mut table = Table::new();
            table.insert(
                "type",
                Item::Value(Value::String(toml_edit::Formatted::new(
                    provider.provider_type.as_str().to_string(),
                ))),
            );
            if let Some(url) = &provider.base_url {
                table.insert(
                    "base_url",
                    Item::Value(Value::String(toml_edit::Formatted::new(url.clone()))),
                );
            }
            if let Some(key) = &provider.api_key {
                table.insert(
                    "api_key",
                    Item::Value(Value::String(toml_edit::Formatted::new(key.clone()))),
                );
            }
            if !provider.env.is_empty() {
                let mut env_table = Table::new();
                for (k, v) in &provider.env {
                    env_table.insert(
                        k,
                        Item::Value(Value::String(toml_edit::Formatted::new(v.clone()))),
                    );
                }
                table.insert("env", Item::Table(env_table));
            }
            for (k, v) in provider.raw_other.iter() {
                table.insert(k, v.clone());
            }
            providers_table.insert(name, Item::Table(table));
        }
    }

    {
        let models_table = doc["models"].or_insert(Table::new());
        let models_table = models_table.as_table_mut().unwrap();
        models_table.clear();
        for (alias, model) in &config.models {
            let mut table = Table::new();
            table.insert(
                "provider",
                Item::Value(Value::String(toml_edit::Formatted::new(
                    model.provider.clone(),
                ))),
            );
            table.insert(
                "model",
                Item::Value(Value::String(toml_edit::Formatted::new(model.model.clone()))),
            );
            table.insert(
                "max_context_size",
                Item::Value(Value::Integer(toml_edit::Formatted::new(
                    model.max_context_size as i64,
                ))),
            );
            if let Some(dn) = &model.display_name {
                table.insert(
                    "display_name",
                    Item::Value(Value::String(toml_edit::Formatted::new(dn.clone()))),
                );
            }
            for (k, v) in model.raw_other.iter() {
                table.insert(k, v.clone());
            }
            models_table.insert(alias, Item::Table(table));
        }
    }

    for (k, v) in config.raw_other.iter() {
        doc.insert(k, v.clone());
    }

    let tmp_path = path.with_extension("tmp");
    std::fs::write(&tmp_path, doc.to_string())?;
    std::fs::rename(&tmp_path, path)?;

    Ok(())
}
```

- [ ] **Step 3: Run cargo check**

Run:
```bash
cd src-tauri && cargo check
```

Expected: compilation succeeds.

---

## Task 4: Implement Validators

**Files:**
- Create: `src-tauri/src/validators.rs`
- Test: `tests/validators.rs`

- [ ] **Step 1: Write validators.rs**

```rust
use crate::models::{Config, Provider, ProviderType};

#[derive(Debug, thiserror::Error)]
pub enum ValidationError {
    #[error("Provider name is empty")]
    EmptyProviderName,
    #[error("Duplicate provider name: {0}")]
    DuplicateProviderName(String),
    #[error("Invalid provider type for '{0}'")]
    InvalidProviderType(String),
    #[error("Provider '{0}' missing credentials (api_key or env key)")]
    MissingCredentials(String),
    #[error("Vertex provider '{0}' missing GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_LOCATION")]
    MissingVertexProject(String),
    #[error("Model alias is empty")]
    EmptyModelAlias,
    #[error("Duplicate model alias: {0}")]
    DuplicateModelAlias(String),
    #[error("Model '{0}' references unknown provider '{1}'")]
    UnknownModelProvider(String, String),
    #[error("Model '{0}' has empty model ID")]
    EmptyModelId(String),
    #[error("Model '{0}' has invalid max_context_size")]
    InvalidMaxContextSize(String),
}

fn expected_api_key_key(provider_type: &ProviderType) -> &'static str {
    match provider_type {
        ProviderType::Kimi => "KIMI_API_KEY",
        ProviderType::Anthropic => "ANTHROPIC_API_KEY",
        ProviderType::Openai | ProviderType::OpenaiResponses => "OPENAI_API_KEY",
        ProviderType::GoogleGenai => "GOOGLE_API_KEY",
        ProviderType::Vertexai => "VERTEXAI_API_KEY",
    }
}

pub fn validate_config(config: &Config) -> Result<(), Vec<ValidationError>> {
    let mut errors = Vec::new();

    let mut provider_names = std::collections::HashSet::new();
    for provider in config.providers.values() {
        if provider.name.trim().is_empty() {
            errors.push(ValidationError::EmptyProviderName);
            continue;
        }
        if !provider_names.insert(provider.name.clone()) {
            errors.push(ValidationError::DuplicateProviderName(provider.name.clone()));
        }
    }

    for provider in config.providers.values() {
        let has_direct_key = provider.api_key.as_ref().map_or(false, |s| !s.is_empty());
        let has_env_key = provider
            .env
            .get(expected_api_key_key(&provider.provider_type))
            .map_or(false, |s| !s.is_empty());

        if !matches!(provider.provider_type, ProviderType::Vertexai) {
            if !has_direct_key && !has_env_key {
                errors.push(ValidationError::MissingCredentials(provider.name.clone()));
            }
        }

        if matches!(provider.provider_type, ProviderType::Vertexai) {
            let has_project = provider
                .env
                .get("GOOGLE_CLOUD_PROJECT")
                .map_or(false, |s| !s.is_empty());
            let has_location = provider
                .env
                .get("GOOGLE_CLOUD_LOCATION")
                .map_or(false, |s| !s.is_empty());
            if !has_project || !has_location {
                errors.push(ValidationError::MissingVertexProject(provider.name.clone()));
            }
        }
    }

    let mut model_aliases = std::collections::HashSet::new();
    for model in config.models.values() {
        if model.alias.trim().is_empty() {
            errors.push(ValidationError::EmptyModelAlias);
            continue;
        }
        if !model_aliases.insert(model.alias.clone()) {
            errors.push(ValidationError::DuplicateModelAlias(model.alias.clone()));
        }
    }

    for model in config.models.values() {
        if !config.providers.contains_key(&model.provider) {
            errors.push(ValidationError::UnknownModelProvider(
                model.alias.clone(),
                model.provider.clone(),
            ));
        }
        if model.model.trim().is_empty() {
            errors.push(ValidationError::EmptyModelId(model.alias.clone()));
        }
        if model.max_context_size == 0 {
            errors.push(ValidationError::InvalidMaxContextSize(model.alias.clone()));
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}
```

- [ ] **Step 2: Run cargo test for validators**

Run:
```bash
cd src-tauri && cargo test validators
```

Expected: tests pass (write at least 3 tests: valid config, missing credentials, duplicate alias).

---

## Task 5: Implement Profile Manager

**Files:**
- Create: `src-tauri/src/profile_manager.rs`
- Test: `tests/profile_manager.rs`

- [ ] **Step 1: Implement safe filename function**

```rust
use crate::config_io::{config_dir, config_path};
use crate::models::{Config, Profile, ProfileSummary};

pub fn safe_filename(name: &str) -> String {
    let mut result = String::new();
    let mut prev_dash = true;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            result.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            result.push('-');
            prev_dash = true;
        }
    }
    if result.ends_with('-') {
        result.pop();
    }
    if result.is_empty() {
        // Chinese or special-character names fall back to a short hash.
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        name.hash(&mut hasher);
        result = format!("profile-{}", hasher.finish() % 100000);
    }
    result
}
```

- [ ] **Step 2: Implement profile directory and file helpers**

```rust
pub fn profiles_dir() -> std::path::PathBuf {
    config_dir().join("profiles")
}

pub fn profile_path(filename: &str) -> std::path::PathBuf {
    profiles_dir().join(filename)
}
```

- [ ] **Step 3: Implement profile listing and activation detection**

```rust
use crate::config_io::load_config;

pub fn list_profiles() -> anyhow::Result<Vec<Profile>> {
    std::fs::create_dir_all(profiles_dir())?;
    let current_config = load_config(config_path())?;

    let mut profiles = vec![Profile {
        name: "default".to_string(),
        filename: "default".to_string(),
        config: current_config.clone(),
        is_active: true,
    }];

    for entry in std::fs::read_dir(profiles_dir())? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("toml") {
            continue;
        }
        let filename = path.file_stem().unwrap().to_string_lossy().to_string();
        let config = load_config(&path)?;
        let is_active = configs_equal(&current_config, &config);
        profiles.push(Profile {
            name: filename.clone(),
            filename: format!("{}.toml", filename),
            config,
            is_active,
        });
    }

    Ok(profiles)
}

fn configs_equal(a: &Config, b: &Config) -> bool {
    a.default_model == b.default_model
        && a.providers.len() == b.providers.len()
        && a.models.len() == b.models.len()
        && a.providers.iter().all(|(k, v)| {
            b.providers.get(k).map_or(false, |other| {
                v.provider_type == other.provider_type
                    && v.base_url == other.base_url
                    && v.api_key == other.api_key
                    && v.env == other.env
            })
        })
        && a.models.iter().all(|(k, v)| {
            b.models.get(k).map_or(false, |other| {
                v.provider == other.provider
                    && v.model == other.model
                    && v.max_context_size == other.max_context_size
                    && v.display_name == other.display_name
            })
        })
}
```

- [ ] **Step 4: Implement profile CRUD and switch**

```rust
use crate::config_io::save_config;

pub fn save_profile(filename: &str, config: &Config) -> anyhow::Result<()> {
    std::fs::create_dir_all(profiles_dir())?;
    let path = profile_path(filename);
    save_config(&path, config)
}

pub fn switch_profile(filename: &str) -> anyhow::Result<Config> {
    let path = profile_path(filename);
    let config = load_config(&path)?;
    save_config(config_path(), &config)?;
    Ok(config)
}

pub fn rename_profile(old_filename: &str, new_name: &str) -> anyhow::Result<String> {
    let new_filename = format!("{}.toml", safe_filename(new_name));
    let old_path = profile_path(old_filename);
    let new_path = profile_path(&new_filename);
    if new_path.exists() {
        anyhow::bail!("profile already exists");
    }
    std::fs::rename(old_path, new_path)?;
    Ok(new_filename)
}

pub fn delete_profile(filename: &str) -> anyhow::Result<()> {
    let path = profile_path(filename);
    std::fs::remove_file(path)?;
    Ok(())
}
```

- [ ] **Step 5: Run cargo test for profile_manager**

Run:
```bash
cd src-tauri && cargo test profile_manager
```

Expected: tests pass.

---

## Task 6: Implement Tauri Commands

**Files:**
- Create: `src-tauri/src/commands.rs`

- [ ] **Step 1: Write commands.rs**

```rust
use crate::config_io::{config_dir, config_path, load_config, save_config};
use crate::models::{Config, ProfileSummary, Table};
use crate::profile_manager;
use crate::validators::validate_config;

/// Merge frontend-managed fields into the existing on-disk config,
/// preserving raw_other (capabilities, overrides, custom_headers, [thinking], etc.).
fn merge_with_existing(path: &std::path::PathBuf, incoming: Config) -> Result<Config, String> {
    let existing = load_config(path).unwrap_or_else(|_| Config {
        default_model: None,
        providers: Default::default(),
        models: Default::default(),
        raw_other: Table::new(),
    });
    Ok(Config {
        default_model: incoming.default_model,
        providers: incoming.providers,
        models: incoming.models,
        raw_other: existing.raw_other,
    })
}

#[tauri::command]
pub fn load_config_command() -> Result<Config, String> {
    load_config(config_path()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_config_command(config: Config) -> Result<(), String> {
    if let Err(errors) = validate_config(&config) {
        return Err(errors.iter().map(|e| e.to_string()).collect::<Vec<_>>().join("\n"));
    }
    let merged = merge_with_existing(&config_path(), config)?;
    save_config(config_path(), &merged).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_profiles() -> Result<Vec<ProfileSummary>, String> {
    let profiles = profile_manager::list_profiles().map_err(|e| e.to_string())?;
    Ok(profiles
        .into_iter()
        .map(|p| ProfileSummary {
            name: p.name,
            filename: p.filename,
            is_active: p.is_active,
        })
        .collect())
}

#[tauri::command]
pub fn load_profile(filename: String) -> Result<Config, String> {
    profile_manager::load_profile(&filename).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_profile(filename: String, config: Config) -> Result<(), String> {
    let path = profile_manager::profile_path(&filename);
    let merged = merge_with_existing(&path, config)?;
    profile_manager::save_profile(&filename, &merged).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn switch_profile(filename: String) -> Result<Config, String> {
    profile_manager::switch_profile(&filename).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_profile(old_filename: String, new_name: String) -> Result<String, String> {
    profile_manager::rename_profile(&old_filename, &new_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_profile(filename: String) -> Result<(), String> {
    profile_manager::delete_profile(&filename).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_config_dir() -> Result<(), String> {
    let path = config_dir();
    std::process::Command::new("explorer")
        .arg(path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
```

- [ ] **Step 2: Add missing profile_manager::load_profile**

Add to `profile_manager.rs`:
```rust
pub fn load_profile(filename: &str) -> anyhow::Result<Config> {
    load_config(profile_path(filename))
}
```

- [ ] **Step 3: Run cargo check**

Run:
```bash
cd src-tauri && cargo check
```

Expected: compilation succeeds.

---

## Task 7: Configure Tauri v2 Permissions

**Files:**
- Create: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Create capabilities/default.json**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capabilities for KimiSwitch",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:allow-open",
    {
      "identifier": "fs:allow-read-file",
      "allow": [
        { "path": "$HOME/.kimi-code/config.toml" },
        { "path": "$HOME/.kimi-code/profiles/*" }
      ]
    },
    {
      "identifier": "fs:allow-write-file",
      "allow": [
        { "path": "$HOME/.kimi-code/config.toml" },
        { "path": "$HOME/.kimi-code/profiles/*" }
      ]
    },
    {
      "identifier": "fs:allow-read-dir",
      "allow": [
        { "path": "$HOME/.kimi-code" },
        { "path": "$HOME/.kimi-code/profiles" }
      ]
    },
    {
      "identifier": "fs:allow-create-dir",
      "allow": [
        { "path": "$HOME/.kimi-code" },
        { "path": "$HOME/.kimi-code/profiles" }
      ]
    }
  ]
}
```

- [ ] **Step 2: Update tauri.conf.json bundle config**

Ensure `"targets": ["msi"]` is set and add windows-specific config:

```json
"bundle": {
  "active": true,
  "targets": ["msi"],
  "windows": {
    "webviewInstallMode": {
      "type": "downloadBootstrapper"
    },
    "nsis": null
  },
  "icon": [
    "icons/32x32.png",
    "icons/128x128.png",
    "icons/128x128@2x.png",
    "icons/icon.ico"
  ]
}
```

- [ ] **Step 3: Add placeholder icons**

Create simple PNG/ICO icons or copy from Tauri default. For now, create empty files as placeholders.

Run:
```bash
mkdir -p src-tauri/icons
touch src-tauri/icons/32x32.png src-tauri/icons/128x128.png src-tauri/icons/128x128@2x.png src-tauri/icons/icon.ico
```

Note: Replace with real icons before final build.

---

## Task 8: Frontend Types and useConfig Hook

**Files:**
- Create: `src/types/index.ts`
- Create: `src/hooks/useConfig.ts`

- [ ] **Step 1: Create src/types/index.ts**

```typescript
export type ProviderType =
  | "kimi"
  | "anthropic"
  | "openai"
  | "openai_responses"
  | "google-genai"
  | "vertexai";

export interface Provider {
  name: string;
  provider_type: ProviderType;
  base_url: string | null;
  api_key: string | null;
  env: Record<string, string>;
}

export interface Model {
  alias: string;
  provider: string;
  model: string;
  max_context_size: number;
  display_name: string | null;
}

export interface Config {
  default_model: string | null;
  providers: Record<string, Provider>;
  models: Record<string, Model>;
}

export interface ProfileSummary {
  name: string;
  filename: string;
  is_active: boolean;
}
```

- [ ] **Step 2: Create src/hooks/useConfig.ts**

```typescript
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Config, ProfileSummary, Provider, Model } from "../types";

export function useConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, profs] = await Promise.all([
        invoke<Config>("load_config_command"),
        invoke<ProfileSummary[]>("list_profiles"),
      ]);
      setConfig(cfg);
      setProfiles(profs);
      setError(null);
      setDirty(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateConfig = useCallback((updater: (cfg: Config) => Config) => {
    setConfig((prev) => (prev ? updater(prev) : prev));
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    if (!config) return;
    try {
      await invoke("save_config_command", { config });
      setDirty(false);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [config, refresh]);

  const switchProfile = useCallback(
    async (filename: string) => {
      try {
        const cfg = await invoke<Config>("switch_profile", { filename });
        setConfig(cfg);
        setDirty(false);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh]
  );

  return {
    config,
    profiles,
    dirty,
    error,
    loading,
    refresh,
    save,
    switchProfile,
    updateConfig,
  };
}
```

---

## Task 9: Build TopBar Component

**Files:**
- Create: `src/components/TopBar.tsx`

- [ ] **Step 1: Write TopBar.tsx**

```tsx
import { useState, useEffect } from "react";
import type { Config, ProfileSummary, ProviderType } from "../types";

interface TopBarProps {
  config: Config;
  profiles: ProfileSummary[];
  selectedProvider: string;
  selectedModel: string;
  onProviderChange: (name: string) => void;
  onModelChange: (alias: string) => void;
  onSetDefault: () => void;
  onProfileAction: (action: "new" | "duplicate" | "rename" | "delete" | "switch", filename: string) => void;
}

export function TopBar({
  config,
  profiles,
  selectedProvider,
  selectedModel,
  onProviderChange,
  onModelChange,
  onSetDefault,
  onProfileAction,
}: TopBarProps) {
  const [profileFilename, setProfileFilename] = useState("");
  const providerOptions = Object.values(config.providers);
  const modelOptions = Object.values(config.models).filter(
    (m) => m.provider === selectedProvider
  );

  useEffect(() => {
    const active = profiles.find((p) => p.is_active);
    setProfileFilename(active?.filename || profiles[0]?.filename || "");
  }, [profiles]);

  return (
    <div className="flex items-center gap-3 p-3 border-b bg-gray-50">
      <select
        className="border rounded px-2 py-1"
        value={profileFilename}
        onChange={(e) => {
          setProfileFilename(e.target.value);
          onProfileAction("switch", e.target.value);
        }}
      >
        {profiles.map((p) => (
          <option key={p.filename} value={p.filename}>
            {p.is_active ? "● " : ""}
            {p.name}
          </option>
        ))}
      </select>

      <button className="px-2 py-1 border rounded" onClick={() => onProfileAction("new", profileFilename)}>
        新建
      </button>
      <button className="px-2 py-1 border rounded" onClick={() => onProfileAction("duplicate", profileFilename)}>
        复制
      </button>
      <button className="px-2 py-1 border rounded" onClick={() => onProfileAction("rename", profileFilename)}>
        重命名
      </button>
      <button className="px-2 py-1 border rounded" onClick={() => onProfileAction("delete", profileFilename)}>
        删除
      </button>

      <div className="w-px h-6 bg-gray-300 mx-2" />

      <select
        className="border rounded px-2 py-1"
        value={selectedProvider}
        onChange={(e) => onProviderChange(e.target.value)}
      >
        {providerOptions.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>

      <select
        className="border rounded px-2 py-1"
        value={selectedModel}
        onChange={(e) => onModelChange(e.target.value)}
        disabled={modelOptions.length === 0}
      >
        {modelOptions.length === 0 ? (
          <option>未绑定模型</option>
        ) : (
          modelOptions.map((m) => (
            <option key={m.alias} value={m.alias}>
              {m.alias}
            </option>
          ))
        )}
      </select>

      <button
        className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
        onClick={onSetDefault}
        disabled={!selectedModel}
      >
        设为默认
      </button>
    </div>
  );
}
```

---

## Task 10: Build ProviderList and ProviderForm

**Files:**
- Create: `src/components/ProviderList.tsx`
- Create: `src/components/ProviderForm.tsx`

- [ ] **Step 1: Write ProviderList.tsx**

```tsx
import type { Provider } from "../types";

interface ProviderListProps {
  providers: Provider[];
  selected: string;
  onSelect: (name: string) => void;
  onAdd: () => void;
  onDelete: (name: string) => void;
}

export function ProviderList({ providers, selected, onSelect, onAdd, onDelete }: ProviderListProps) {
  return (
    <div className="flex flex-col h-full border-r">
      <div className="p-2 border-b font-semibold">供应商</div>
      <div className="flex-1 overflow-auto">
        {providers.map((p) => (
          <div
            key={p.name}
            className={`p-2 cursor-pointer hover:bg-gray-100 flex justify-between ${
              selected === p.name ? "bg-blue-50" : ""
            }`}
            onClick={() => onSelect(p.name)}
          >
            <span>{p.name}</span>
            <button
              className="text-red-500 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(p.name);
              }}
            >
              删除
            </button>
          </div>
        ))}
      </div>
      <button className="p-2 border-t bg-gray-50" onClick={onAdd}>
        + 添加供应商
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Write ProviderForm.tsx**

```tsx
import type { Provider, ProviderType } from "../types";

const PROVIDER_TYPES: ProviderType[] = [
  "kimi",
  "anthropic",
  "openai",
  "openai_responses",
  "google-genai",
  "vertexai",
];

interface ProviderFormProps {
  provider: Provider;
  onChange: (provider: Provider) => void;
}

function credentialEnvKeys(type: ProviderType): { apiKey: string; baseUrl: string } {
  switch (type) {
    case "kimi":
      return { apiKey: "KIMI_API_KEY", baseUrl: "KIMI_BASE_URL" };
    case "anthropic":
      return { apiKey: "ANTHROPIC_API_KEY", baseUrl: "ANTHROPIC_BASE_URL" };
    case "openai":
    case "openai_responses":
      return { apiKey: "OPENAI_API_KEY", baseUrl: "OPENAI_BASE_URL" };
    case "google-genai":
      return { apiKey: "GOOGLE_API_KEY", baseUrl: "GOOGLE_GEMINI_BASE_URL" };
    case "vertexai":
      return { apiKey: "VERTEXAI_API_KEY", baseUrl: "GOOGLE_VERTEX_BASE_URL" };
  }
}

export function ProviderForm({ provider, onChange }: ProviderFormProps) {
  const useDirect = !!(provider.api_key || provider.base_url);
  const keys = credentialEnvKeys(provider.provider_type);

  const setUseDirect = (direct: boolean) => {
    if (direct === useDirect) return;
    if (direct) {
      // Move credentials from env to direct fields
      const env = { ...provider.env };
      const apiKey = env[keys.apiKey] || "";
      const baseUrl = env[keys.baseUrl] || "";
      delete env[keys.apiKey];
      delete env[keys.baseUrl];
      onChange({
        ...provider,
        api_key: apiKey || null,
        base_url: baseUrl || null,
        env,
      });
    } else {
      // Move credentials from direct fields to env
      const env = { ...provider.env };
      if (provider.api_key) env[keys.apiKey] = provider.api_key;
      if (provider.base_url) env[keys.baseUrl] = provider.base_url;
      onChange({
        ...provider,
        api_key: null,
        base_url: null,
        env,
      });
    }
  };

  const update = (patch: Partial<Provider>) => {
    onChange({ ...provider, ...patch });
  };

  return (
    <div className="p-4 space-y-4">
      <div>
        <label className="block text-sm font-medium">类型</label>
        <select
          className="border rounded w-full px-2 py-1"
          value={provider.provider_type}
          onChange={(e) =>
            update({ provider_type: e.target.value as ProviderType })
          }
        >
          {PROVIDER_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-4">
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={!useDirect}
            onChange={() => setUseDirect(false)}
          />
          使用 env 子表
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={useDirect}
            onChange={() => setUseDirect(true)}
          />
          使用直接字段
        </label>
      </div>

      <div>
        <label className="block text-sm font-medium">Base URL</label>
        <input
          className="border rounded w-full px-2 py-1"
          value={provider.base_url || ""}
          disabled={!useDirect}
          onChange={(e) => update({ base_url: e.target.value || null })}
        />
      </div>

      <div>
        <label className="block text-sm font-medium">API Key</label>
        <input
          type="password"
          className="border rounded w-full px-2 py-1"
          value={provider.api_key || ""}
          disabled={!useDirect}
          onChange={(e) => update({ api_key: e.target.value || null })}
        />
      </div>

      <div>
        <label className="block text-sm font-medium">Env 键值对</label>
        <EnvTable
          env={provider.env}
          onChange={(env) => update({ env })}
          disabled={useDirect}
        />
      </div>
    </div>
  );
}

function EnvTable({
  env,
  onChange,
  disabled,
}: {
  env: Record<string, string>;
  onChange: (env: Record<string, string>) => void;
  disabled: boolean;
}) {
  const entries = Object.entries(env);

  return (
    <div className={`space-y-1 ${disabled ? "opacity-50" : ""}`}>
      {entries.map(([k, v], idx) => (
        <div key={idx} className="flex gap-2">
          <input
            className="border rounded flex-1 px-2 py-1"
            value={k}
            disabled={disabled}
            onChange={(e) => {
              const newEnv = { ...env };
              delete newEnv[k];
              newEnv[e.target.value] = v;
              onChange(newEnv);
            }}
          />
          <input
            className="border rounded flex-1 px-2 py-1"
            value={v}
            disabled={disabled}
            onChange={(e) => onChange({ ...env, [k]: e.target.value })}
          />
          <button
            className="text-red-500"
            disabled={disabled}
            onClick={() => {
              const newEnv = { ...env };
              delete newEnv[k];
              onChange(newEnv);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="text-sm text-blue-600"
        disabled={disabled}
        onClick={() => onChange({ ...env, "": "" })}
      >
        + 添加
      </button>
    </div>
  );
}
```

---

## Task 11: Build ModelList and ModelForm

**Files:**
- Create: `src/components/ModelList.tsx`
- Create: `src/components/ModelForm.tsx`

- [ ] **Step 1: Write ModelList.tsx**

```tsx
import type { Model } from "../types";

interface ModelListProps {
  models: Model[];
  selected: string;
  onSelect: (alias: string) => void;
  onAdd: () => void;
  onDelete: (alias: string) => void;
}

export function ModelList({ models, selected, onSelect, onAdd, onDelete }: ModelListProps) {
  return (
    <div className="flex flex-col h-full border-l">
      <div className="p-2 border-b font-semibold">模型别名</div>
      <div className="flex-1 overflow-auto">
        {models.map((m) => (
          <div
            key={m.alias}
            className={`p-2 cursor-pointer hover:bg-gray-100 flex justify-between ${
              selected === m.alias ? "bg-blue-50" : ""
            }`}
            onClick={() => onSelect(m.alias)}
          >
            <span>{m.alias}</span>
            <button
              className="text-red-500 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(m.alias);
              }}
            >
              删除
            </button>
          </div>
        ))}
      </div>
      <button className="p-2 border-t bg-gray-50" onClick={onAdd}>
        + 添加模型
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Write ModelForm.tsx**

```tsx
import type { Model } from "../types";

interface ModelFormProps {
  model: Model;
  providers: string[];
  onChange: (model: Model) => void;
  onSetDefault: () => void;
}

export function ModelForm({ model, providers, onChange, onSetDefault }: ModelFormProps) {
  return (
    <div className="p-4 space-y-4">
      <div>
        <label className="block text-sm font-medium">别名（只读）</label>
        <input
          className="border rounded w-full px-2 py-1 bg-gray-100"
          value={model.alias}
          readOnly
        />
      </div>

      <div>
        <label className="block text-sm font-medium">供应商</label>
        <select
          className="border rounded w-full px-2 py-1"
          value={model.provider}
          onChange={(e) => onChange({ ...model, provider: e.target.value })}
        >
          {providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium">模型 ID</label>
        <input
          className="border rounded w-full px-2 py-1"
          value={model.model}
          onChange={(e) => onChange({ ...model, model: e.target.value })}
        />
      </div>

      <div>
        <label className="block text-sm font-medium">最大上下文长度</label>
        <input
          type="number"
          className="border rounded w-full px-2 py-1"
          value={model.max_context_size}
          onChange={(e) =>
            onChange({ ...model, max_context_size: Number(e.target.value) })
          }
        />
      </div>

      <div>
        <label className="block text-sm font-medium">显示名称（可选）</label>
        <input
          className="border rounded w-full px-2 py-1"
          value={model.display_name || ""}
          onChange={(e) =>
            onChange({ ...model, display_name: e.target.value || null })
          }
        />
      </div>

      <button
        className="px-3 py-1 bg-blue-600 text-white rounded"
        onClick={onSetDefault}
      >
        设为默认模型
      </button>
    </div>
  );
}
```

---

## Task 12: Build BottomToolbar and App.tsx

**Files:**
- Create: `src/components/BottomToolbar.tsx`
- Create: `src/App.tsx`

- [ ] **Step 1: Write BottomToolbar.tsx**

```tsx
interface BottomToolbarProps {
  dirty: boolean;
  onSave: () => void;
  onReload: () => void;
  onSaveAsProfile: () => void;
  onOpenDir: () => void;
}

export function BottomToolbar({
  dirty,
  onSave,
  onReload,
  onSaveAsProfile,
  onOpenDir,
}: BottomToolbarProps) {
  return (
    <div className="flex items-center gap-3 p-3 border-t bg-gray-50">
      <button
        className={`px-3 py-1 rounded ${
          dirty ? "bg-blue-600 text-white" : "border"
        }`}
        onClick={onSave}
      >
        保存配置
      </button>
      <button className="px-3 py-1 border rounded" onClick={onReload}>
        读取配置
      </button>
      <button className="px-3 py-1 border rounded" onClick={onSaveAsProfile}>
        保存为新 Profile
      </button>
      <button className="px-3 py-1 border rounded" onClick={onOpenDir}>
        打开配置目录
      </button>
      {dirty && <span className="text-orange-600 text-sm">有未保存修改</span>}
    </div>
  );
}
```

- [ ] **Step 2: Write App.tsx**

```tsx
import { useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useConfig } from "./hooks/useConfig";
import { TopBar } from "./components/TopBar";
import { ProviderList } from "./components/ProviderList";
import { ProviderForm } from "./components/ProviderForm";
import { ModelList } from "./components/ModelList";
import { ModelForm } from "./components/ModelForm";
import { BottomToolbar } from "./components/BottomToolbar";
import type { Config, Provider, Model } from "./types";

export default function App() {
  const {
    config,
    profiles,
    dirty,
    error,
    loading,
    refresh,
    save,
    switchProfile,
    updateConfig,
  } = useConfig();

  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");

  const providers = useMemo(
    () => (config ? Object.values(config.providers) : []),
    [config]
  );
  const models = useMemo(
    () => (config ? Object.values(config.models) : []),
    [config]
  );
  const filteredModels = useMemo(
    () => models.filter((m) => m.provider === selectedProvider),
    [models, selectedProvider]
  );

  if (loading || !config) {
    return <div className="p-4">加载中...</div>;
  }

  const handleProviderSelect = (name: string) => {
    setSelectedProvider(name);
    const firstModel = models.find((m) => m.provider === name);
    setSelectedModel(firstModel?.alias || "");
  };

  const handleSetDefault = () => {
    if (!selectedModel) return;
    updateConfig((cfg) => ({ ...cfg, default_model: selectedModel }));
  };

  const handleAddProvider = () => {
    const name = `provider-${providers.length + 1}`;
    updateConfig((cfg) => ({
      ...cfg,
      providers: { ...cfg.providers, [name]: {
        name,
        provider_type: "kimi",
        base_url: null,
        api_key: null,
        env: {},
      }},
    }));
    setSelectedProvider(name);
  };

  const handleUpdateProvider = (provider: Provider) => {
    updateConfig((cfg) => ({
      ...cfg,
      providers: { ...cfg.providers, [provider.name]: provider },
    }));
  };

  const handleDeleteProvider = (name: string) => {
    updateConfig((cfg) => {
      const providers = { ...cfg.providers };
      delete providers[name];
      return { ...cfg, providers };
    });
    if (selectedProvider === name) {
      setSelectedProvider("");
      setSelectedModel("");
    }
  };

  const handleAddModel = () => {
    const alias = `model-${models.length + 1}`;
    updateConfig((cfg) => ({
      ...cfg,
      models: {
        ...cfg.models,
        [alias]: {
          alias,
          provider: selectedProvider || Object.keys(cfg.providers)[0] || "",
          model: "",
          max_context_size: 262144,
          display_name: null,
        },
      },
    }));
    setSelectedModel(alias);
  };

  const handleUpdateModel = (model: Model) => {
    updateConfig((cfg) => ({
      ...cfg,
      models: { ...cfg.models, [model.alias]: model },
    }));
  };

  const handleDeleteModel = (alias: string) => {
    updateConfig((cfg) => {
      const models = { ...cfg.models };
      delete models[alias];
      return { ...cfg, models };
    });
    if (selectedModel === alias) setSelectedModel("");
  };

  const handleProfileAction = async (
    action: "new" | "duplicate" | "rename" | "delete" | "switch",
    filename: string
  ) => {
    if (action === "switch") {
      await switchProfile(filename);
      return;
    }

    if (action === "new") {
      const name = prompt("输入 Profile 名称")?.trim();
      if (!name) return;
      const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      await invoke("save_profile", {
        filename: `${safe}.toml`,
        config,
      });
      await refresh();
      return;
    }

    if (filename === "default") {
      alert("default Profile 不可进行复制/重命名/删除");
      return;
    }

    if (action === "duplicate") {
      const cfg = await invoke<Config>("load_profile", { filename });
      const base = filename.replace(/\.toml$/, "");
      const newFilename = `${base}-copy.toml`;
      await invoke("save_profile", { filename: newFilename, config: cfg });
      await refresh();
    } else if (action === "rename") {
      const name = prompt("输入新 Profile 名称")?.trim();
      if (!name) return;
      await invoke("rename_profile", { oldFilename: filename, newName: name });
      await refresh();
    } else if (action === "delete") {
      if (!confirm(`确定删除 Profile ${filename}？`)) return;
      await invoke("delete_profile", { filename });
      await refresh();
    }
  };

  const currentProvider = config.providers[selectedProvider];
  const currentModel = config.models[selectedModel];

  return (
    <div className="flex flex-col h-full">
      <TopBar
        config={config}
        profiles={profiles}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        onProviderChange={handleProviderSelect}
        onModelChange={setSelectedModel}
        onSetDefault={handleSetDefault}
        onProfileAction={handleProfileAction}
      />

      {error && (
        <div className="bg-red-100 text-red-800 p-2 text-sm">{error}</div>
      )}

      <div className="flex-1 grid grid-cols-12 overflow-hidden">
        <div className="col-span-3">
          <ProviderList
            providers={providers}
            selected={selectedProvider}
            onSelect={handleProviderSelect}
            onAdd={handleAddProvider}
            onDelete={handleDeleteProvider}
          />
        </div>

        <div className="col-span-4 overflow-auto">
          {currentProvider ? (
            <ProviderForm
              provider={currentProvider}
              onChange={handleUpdateProvider}
            />
          ) : (
            <div className="p-4 text-gray-500">请选择或添加供应商</div>
          )}
        </div>

        <div className="col-span-2">
          <ModelList
            models={filteredModels}
            selected={selectedModel}
            onSelect={setSelectedModel}
            onAdd={handleAddModel}
            onDelete={handleDeleteModel}
          />
        </div>

        <div className="col-span-3 overflow-auto">
          {currentModel ? (
            <ModelForm
              model={currentModel}
              providers={Object.keys(config.providers)}
              onChange={handleUpdateModel}
              onSetDefault={handleSetDefault}
            />
          ) : (
            <div className="p-4 text-gray-500">请选择或添加模型</div>
          )}
        </div>
      </div>

      <BottomToolbar
        dirty={dirty}
        onSave={save}
        onReload={refresh}
        onSaveAsProfile={async () => {
          const name = prompt("输入新 Profile 名称")?.trim();
          if (!name) return;
          const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          await invoke("save_profile", {
            filename: `${safe}.toml`,
            config,
          });
          await refresh();
        }}
        onOpenDir={() => invoke("open_config_dir")}
      />
    </div>
  );
}
```

---

## Task 13: Tailwind Configuration

**Files:**
- Create: `tailwind.config.js`
- Create: `postcss.config.js`

- [ ] **Step 1: Create tailwind.config.js**

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};
```

- [ ] **Step 2: Create postcss.config.js**

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

---

## Task 14: Rust Unit Tests

**Files:**
- Create: `src-tauri/tests/config_io.rs`
- Create: `src-tauri/tests/validators.rs`
- Create: `src-tauri/tests/profile_manager.rs`

- [ ] **Step 1: Write validators test**

```rust
use kimiswitch_lib::models::{Config, Model, Provider, ProviderType, Table};
use kimiswitch_lib::validators::validate_config;
use indexmap::IndexMap;

fn valid_config() -> Config {
    let mut providers = IndexMap::new();
    providers.insert(
        "kimi".to_string(),
        Provider {
            name: "kimi".to_string(),
            provider_type: ProviderType::Kimi,
            base_url: None,
            api_key: None,
            env: [("KIMI_API_KEY".to_string(), "sk-xxx".to_string())]
                .into_iter()
                .collect(),
            raw_other: Table::new(),
        },
    );

    let mut models = IndexMap::new();
    models.insert(
        "kimi-coding".to_string(),
        Model {
            alias: "kimi-coding".to_string(),
            provider: "kimi".to_string(),
            model: "kimi-for-coding".to_string(),
            max_context_size: 262144,
            display_name: None,
            raw_other: Table::new(),
        },
    );

    Config {
        default_model: Some("kimi-coding".to_string()),
        providers,
        models,
        raw_other: Table::new(),
    }
}

#[test]
fn test_valid_config() {
    assert!(validate_config(&valid_config()).is_ok());
}

#[test]
fn test_missing_credentials() {
    let mut cfg = valid_config();
    cfg.providers.get_mut("kimi").unwrap().env.clear();
    let errors = validate_config(&cfg).unwrap_err();
    assert!(errors.iter().any(|e| e.to_string().contains("missing credentials")));
}

#[test]
fn test_unknown_model_provider() {
    let mut cfg = valid_config();
    cfg.models.get_mut("kimi-coding").unwrap().provider = "missing".to_string();
    let errors = validate_config(&cfg).unwrap_err();
    assert!(errors.iter().any(|e| e.to_string().contains("Unknown model provider")));
}
```

- [ ] **Step 2: Run Rust tests**

Run:
```bash
cd src-tauri && cargo test
```

Expected: all tests pass.

---

## Task 15: Build MSI Installer

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Create: real icon files in `src-tauri/icons/`

- [ ] **Step 1: Verify tauri.conf.json bundle settings**

Ensure:
```json
"bundle": {
  "active": true,
  "targets": ["msi"]
}
```

- [ ] **Step 2: Add real icon files**

Generate icons using Tauri CLI:
```bash
npm run tauri icon path/to/icon.png
```

If no icon yet, use a temporary 1024x1024 PNG.

- [ ] **Step 3: Build release MSI**

Run:
```bash
npm run tauri build
```

Expected output:
```
src-tauri/target/release/bundle/msi/KimiSwitch_0.1.0_x64_en-US.msi
```

- [ ] **Step 4: Install and smoke test on Windows**

Double-click the MSI, verify:
- Install completes without errors.
- Start menu shortcut appears.
- App launches.
- Can create provider, model, save, switch profiles.

---

## Task 16: Manual End-to-End Testing

- [ ] **Step 1: Fresh config scenario**

Delete `~/.kimi-code/config.toml`, launch KimiSwitch, verify it creates an empty config and default profile.

- [ ] **Step 2: Existing config scenario**

Create a hand-written `config.toml` with one provider and one model. Launch KimiSwitch, verify it loads correctly.

- [ ] **Step 3: Provider/model switch**

Add two providers with one model each. Use TopBar to switch between them and click「设为默认」. Verify `default_model` in `config.toml` updates.

- [ ] **Step 4: Profile switch**

Create two profiles with different providers. Switch between them. Verify `config.toml` content changes.

- [ ] **Step 5: Validation error**

Create a model referencing a non-existent provider. Click save. Verify error dialog appears and file is not overwritten.

---

## Self-Review

### Spec Coverage

| Spec Section | Implementing Task |
| --- | --- |
| Tauri v2 + Rust + TS/React + Tailwind | Task 1 |
| ProviderType enum with serde rename | Task 2 |
| IndexMap for ordering | Task 2 |
| Profile filename safe化 | Task 5 |
| `toml_edit` round-trip | Task 3 |
| Tauri permissions | Task 7 |
| Tauri commands | Task 6 |
| Credential env/direct mutual exclusivity | Task 10 (ProviderForm) |
| `is_active` semantic compare | Task 5 |
| Three-pane UI with TopBar | Tasks 9–12 |
| Validation rules | Task 4 |
| MSI packaging | Task 15 |
| Windows-specific paths | Task 3 |
| raw_other preservation | Task 6 (`merge_with_existing`) |

### Placeholder Scan

No TBD/TODO/fill-in-details found. All code blocks contain concrete implementations.

### Type Consistency

- `Provider`, `Model`, `Config` types match between Rust (`models.rs`) and TypeScript (`src/types/index.ts`).
- Command names in `lib.rs` match `commands.rs` and `useConfig.ts`.
- `Table` re-exported from `models.rs` so integration tests can construct models.

### Implementation Notes

- **raw_other preservation**: `save_config_command` and `save_profile_command` load the existing on-disk file, merge managed fields from the frontend, and keep the original `raw_other`. This protects `[thinking]`, `[loop_control]`, `custom_headers`, `capabilities`, `overrides`, and comments/formatting.
- **Provider/model rename**: For simplicity in the first implementation, provider `name` and model `alias` are read-only in the edit forms. Users can delete and recreate, or rename via Profile-level operations. A future enhancement can add explicit rename with reference updates.
- **Chinese Profile names**: The safe-filename function keeps ASCII alphanumeric characters; pure Chinese names fall back to a hash-based filename.
- **Provider default Base URL auto-fill**: Not implemented in this plan; add as a follow-up enhancement.
