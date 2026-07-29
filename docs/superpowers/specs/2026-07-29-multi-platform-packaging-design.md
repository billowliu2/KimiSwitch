# Kimi Switch 多平台打包 — 设计

**日期**：2026-07-29
**状态**：待用户审查
**关联 issue / 任务**：新增 macOS + Linux 打包支持（gh Actions 为主 + Docker 本地调 Linux）

---

## 1. 背景与目标

Kimi Switch 是 Tauri 2.x 桌面配置管理器，目前仅支持 Windows MSI（`tauri.conf.json` 中 `bundle.targets: ["msi"]`）。本次改动让同一份代码可同时构建 Windows / macOS / Linux 三平台，整理出能在 GitHub Releases 上统一发布的工作流。

成功标准：
- `git tag v0.7.0 && git push origin v0.7.0` → GitHub Actions 自动产出 6 个资产（`.msi` + `.dmg` + `.app` + `.deb` + `.AppImage` + `.rpm`），全部挂到 v0.7.0 Release
- 开发者本机 Windows + Docker 可本地调 Linux 三种格式
- 应用内"检查更新"按 OS 自动选对应 asset 下载
- 不回归现有 Windows 用户的体验

## 2. 决策（已与用户确认）

| 决策点 | 选定 |
|--------|------|
| 构建策略 | GH Actions 为主（tauri-action）+ Docker 本地调 Linux |
| macOS 签名 | 不签名 / 跳过公证（用户在 README 中被告知右键 → 打开绕过 Gatekeeper） |
| Linux 格式 | deb + AppImage + rpm（全部覆盖） |
| Release 触发 | tag 推送触发 + tag / package.json / Cargo.toml / tauri.conf.json 四处版本一致性检查 |
| Update checker | 按 OS + 扩展名自动选 asset（Windows: .msi，macOS: .dmg，Linux: .AppImage） |

## 3. 架构

### 3.1 发布流

```
git tag v0.7.0 && git push origin v0.7.0
        │
        ▼
GH Actions: version-check job
        │  (tag == package.json == Cargo.toml == tauri.conf.json ?)
        ▼
3 个并行 jobs 同时 build：
  ubuntu-latest    → .deb / .AppImage / .rpm
  macos-latest     → .app + .dmg（无签名）
  windows-latest   → .msi
        │
        ▼
tauri-action 自动收集 artifacts → 上传到 GitHub Release v0.7.0
```

### 3.2 本地调试流

```
Developer on Windows
        │
        ▼
docker compose run --rm build-linux
        │
        ▼
ubuntu 22.04 容器内
  apt-get install webkit2gtk-4.1 librsvg2-dev
  cargo install tauri-cli
  npm ci && npm run build
  cargo tauri build --bundles deb,appimage,rpm
        │
        ▼
src-tauri/target/release/bundle/
  ├── deb/KimiSwitch_0.7.0_amd64.deb
  ├── appimage/KimiSwitch_0.7.0_amd64.AppImage
  └── rpm/KimiSwitch-0.7.0-1.x86_64.rpm
```

### 3.3 用户更新流

```
App 启动 / 每 8h / 手动
        │
        ▼
GET https://api.github.com/repos/billowliu2/KimiSwitch/releases?per_page=1
        │
        ▼
解析 JSON，按 OS 过滤 assets
        │
        ▼
? update_available → footer 弹提示
        │
        ▼
用户点"下载" → 后端流式下载到 temp_dir()/KimiSwitch_update.<ext>
        │
        ▼
open_installer(path) → 系统默认 handler 打开
  Windows: 启动 MSI 安装
  macOS:   挂载 .dmg，用户拖入 Applications
  Linux:   AppImage 直接 chmod +x 跑；deb/rpm 走系统包管理器
```

## 4. 文件 / 代码变更

### 4.1 新增

| 路径 | 目的 |
|------|------|
| `.github/workflows/release.yml` | GH Actions 工作流（version-check + 3 平台矩阵） |
| `Dockerfile` | Ubuntu 22.04 + webkit2gtk-4.1 + librsvg2 + cargo + node，构建工具链 |
| `docker-compose.yml` | `docker compose run --rm build-linux` 一行起 |
| `scripts/check-version.sh` | 校验 tag / package.json / Cargo.toml / tauri.conf.json 四处版本号一致 |
| `docs/BUILD.md` | 本地 Docker 构建、平台差异、签名状态说明 |

### 4.2 修改

| 路径 | 改动 |
|------|------|
| `src-tauri/tauri.conf.json` | `bundle.targets: ["msi"]` → `"all"`；icon 列表追加 macOS 专用 `.icns`；加 `macOS.minimumSystemVersion: "10.15"` |
| `src-tauri/src/main.rs` | `windows_subsystem = "windows"` 改为仅 Windows 启用（macOS / Linux 仍 console subsystem） |
| `src-tauri/src/commands.rs` | `download_update` 临时文件名按 OS 走；`check_for_update` 按 OS 过滤 asset |
| `README.md` | 三平台下载链接；Docker 调试一节；GH Actions 状态徽章 |
| `README_EN.md` | 同上英文版 |

### 4.3 核心 Rust 实现

```rust
// src-tauri/src/commands.rs

/// Pick the GitHub release asset matching the current OS by file extension.
/// Preference for Linux is AppImage (portable, no install). If the preferred
/// extension is not present, returns None so the UI can fall back to
/// "open release page" instead of guessing a less-preferred format.
fn pick_asset_for_current_os(assets: &[serde_json::Value]) -> Option<String> {
    let target_ext = match std::env::consts::OS {
        "macos" => "dmg",
        "linux" => "AppImage",
        "windows" => "msi",
        _ => return None,
    };
    assets.iter()
        .find(|a| a.get("name").and_then(|n| n.as_str())
             .map(|n| n.ends_with(target_ext)).unwrap_or(false))
        .and_then(|a| a.get("browser_download_url"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Build the platform-ext-specific temp filename for downloaded installer.
fn update_temp_filename() -> String {
    let ext = match std::env::consts::OS {
        "macos" => "dmg",
        "linux" => "AppImage",
        "windows" => "msi",
        _ => "bin",
    };
    format!("KimiSwitch_update.{ext}")
}
```

`main.rs` 调整：

```rust
// 旧
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// 新
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]
```

## 5. 错误处理

| 场景 | 处理 |
|------|------|
| tag 与 Cargo.toml 版本不一致 | workflow 立即 fail，输出 diff；不进入 build |
| GitHub Release 已有同名 asset | tauri-action 自动覆盖（默认行为） |
| Linux runner 缺 webkit2gtk 等系统包 | tauri-action 文档明确会自动 `apt-get install`；失败 bubble up |
| macOS 构建失败 | 失败 job 标红，其他平台不受影响；release 仍上传成功的资产 |
| 用户端 update check 网络失败 | 静默失败（`useUpdateCheck.ts` 已有 try/catch） |
| 本地 Docker 构建失败 | 多阶段 Dockerfile，失败 → 容器退出码 + 完整日志 |
| macOS 未签名 .dmg 被 Gatekeeper 拦 | README 明确"右键 → 打开"绕过；远期可加签名（独立设计） |

质量门：
- `cargo check --target x86_64-unknown-linux-gnu`（Docker 内）
- `npm run build`（前端）
- 不引入新的 lint 失败
- macOS unsigned 状态在 release body 里显式标注

## 6. 测试验证

### 6.1 本地构建验证

1. **单测 / lint**
   - `npm run lint`
   - `cargo check`
   - `cargo check --target x86_64-unknown-linux-gnu`（Docker 内）

2. **本地 Docker Linux 构建**
   - `docker compose build build-linux` → 容器构建成功
   - `docker compose run --rm build-linux` → 产出 3 个 Linux 包
   - `dpkg --info kimiswitch_0.7.0_amd64.deb` 确认 metadata
   - `file kimiswitch_0.7.0_amd64.AppImage` 确认 ELF 可执行

3. **Rust 单元测**
   - `pick_asset_for_current_os`：
     - `windows` + assets `[msi, dmg, AppImage]` → 选 msi
     - `macos` + assets `[msi, dmg, AppImage]` → 选 dmg
     - `linux` + assets `[msi, dmg, AppImage]` → 选 AppImage
     - 都不匹配 → 返回 None

### 6.2 GH Actions 端到端

- 推 test tag `v0.6.0-rc1`（prerelease，**不污染正式 v0.6.0**）
- 验证 3 个 jobs 都绿
- 验证 assets 上传到 GitHub Release

### 6.3 运行时手测（自动化跳过，仅文档化）

- macOS: 挂载 .dmg，拖入 Applications；启动确认（首次会被 Gatekeeper 拦，文档说明）
- Linux: AppImage `chmod +x && ./KimiSwitch_0.7.0_amd64.AppImage`；deb `sudo dpkg -i`；rpm `sudo rpm -i`
- Windows: 已有 MSI 流程，不回归

### 6.4 Update checker 联调

- App 内"检查更新" → 后端 fetch GH releases → 按 OS 选对 asset → 下载正确文件
- Linux 上 AppImage 装完后启动 app，update check 选 AppImage 而非其他格式

### 6.5 验收

- ✅ 三个平台都跑出可安装产物
- ✅ GH Actions 总耗时 < 30 分钟
- ✅ 版本不一致时 workflow 立即 fail
- ✅ Update checker 跨平台行为正确
- ✅ README 三平台下载链接齐全

## 7. 范围外（本次不做）

- macOS 代码签名 + notarization（用户已确认本期跳过；独立设计未来再加）
- 自动更新检查替换为 Tauri 官方 `tauri-plugin-updater`（本期仍用自定义 `check_for_update`）
- iOS / Android（已有 icon 资源，但本期不构建）
- 自动 changelog 生成（用 commit log + 手动整理）
- Linux 平台 snap / flatpak
- Linux 32 位 / ARM 构建（先 x86_64 就够了）

## 8. 风险与回退

| 风险 | 缓解 |
|------|------|
| macOS unsigned 限制分发 | README 引导用户绕过；后续可补签名 |
| GH Actions 30 分钟耗时不够 | 用 `tauri-action` 自带缓存；3 平台并行通常 10-15 分钟 |
| Docker 镜像构建慢 | 用 prebuilt `tauri-apps/tauri:2-jammy` 风格基础镜像（自维护一份）；接下来 PR 可替换 |
| 单元测 build 时间拖慢 | `pick_asset_for_current_os` 是纯函数，单测几百 ms；不会显著拖慢 CI |
| 用户升级后旧版检查更新路径被破坏 | 新逻辑兼容旧 release（只有一个 msi asset 时返回 None，UI 显示"请手动下载"） |
