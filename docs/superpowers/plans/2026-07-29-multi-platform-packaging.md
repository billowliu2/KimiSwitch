# Kimi Switch Multi-Platform Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add macOS + Linux packaging support on top of existing Windows MSI; release driven by GitHub Actions tag-push workflow.

**Architecture:** Source-level changes are minimal (Tauri config tweaks + platform-conditional Rust + asset picker). Build infrastructure is the heavy lifting: one GH Actions workflow (version-check + 3-platform matrix using `tauri-action`) and a local Docker setup for Linux dev iteration.

**Tech Stack:** Tauri 2.x, Rust 2021, React 18 + TypeScript 5.5, GitHub Actions (`tauri-apps/tauri-action`), Docker (Ubuntu 22.04 + webkit2gtk-4.1), bash.

## Global Constraints

- macOS assets: `.app` + `.dmg`, **unsigned** (no Apple Developer ID provided)
- Linux assets: `.deb` + `.AppImage` + `.rpm` (all three)
- Windows assets: `.msi` (existing)
- Bundle target string in `tauri.conf.json`: `"all"` (allow per-platform build)
- macOS minimum system version: `10.15`
- Update checker picks asset by file extension: `.msi` / `.dmg` / `.AppImage`
- Temp filename for downloaded installer: `KimiSwitch_update.<ext>` (ext from OS)
- Version consistency: `git tag` must equal `package.json:version` = `Cargo.toml:version` = `tauri.conf.json:version`
- Cargo behavior: keep `tauri = "2.0.0"`, `tauri-plugin-opener = "2.0.0"`, `tauri-plugin-single-instance = "2.0.0"`
- No new lint failures; no new dependencies beyond what's already in `Cargo.toml`
- Spec location: `docs/superpowers/specs/2026-07-29-multi-platform-packaging-design.md`

---

## Task 1: Tauri config — bundle targets and macOS section

**Files:**
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: existing Windows-only config
- Produces: `bundle.targets = "all"`, `bundle.macOS.minimumSystemVersion`, expanded icon list

- [ ] **Step 1: Update `tauri.conf.json`**

Replace the existing `bundle` block with:

```json
{
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.ico",
      "icons/icon.icns"
    ],
    "windows": {
      "webviewInstallMode": {
        "type": "downloadBootstrapper"
      },
      "nsis": null
    },
    "macOS": {
      "minimumSystemVersion": "10.15"
    },
    "linux": {
      "deb": {
        "depends": []
      },
      "appimage": {
        "bundleMediaFramework": false
      }
    }
  }
}
```

- [ ] **Step 2: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8'))"`
Expected: no output (silent success)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat(bundle): enable all-platform targets + macOS/Linux config"
```

---

## Task 2: Platform-conditional `windows_subsystem` in main.rs

**Files:**
- Modify: `src-tauri/src/main.rs:1`

**Interfaces:**
- Consumes: existing `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`
- Produces: Windows-only windows_subsystem; macOS/Linux keep console subsystem so logs are visible

- [ ] **Step 1: Replace the directive at line 1**

Replace:
```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
```

With:
```rust
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]
```

- [ ] **Step 2: Verify Windows build still compiles**

Run: `cd src-tauri && cargo check --message-format=short 2>&1 | tail -5`
Expected: `Finished \`dev\` profile [unoptimized + debuginfo] target(s)` with no errors

- [ ] **Step 3: Verify Linux target compiles (cross-check)**

Run: `cd src-tauri && cargo check --target x86_64-unknown-linux-gnu --message-format=short 2>&1 | tail -5`
Expected: finishes clean (may need `rustup target add x86_64-unknown-linux-gnu` first; if rustup target is missing, run that and retry)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "fix(build): only set windows_subsystem on Windows targets"
```

---

## Task 3: TDD — platform-aware asset picker

**Files:**
- Modify: `src-tauri/src/commands.rs` (append at end)

**Interfaces:**
- Produces (public to module): `fn pick_asset_for_current_os(assets: &[serde_json::Value]) -> Option<String>`
- Pure function, no side effects; testable in isolation

- [ ] **Step 1: Write failing tests**

Add to the end of `src-tauri/src/commands.rs`:

```rust
#[cfg(test)]
mod asset_picker_tests {
    use super::*;
    use serde_json::json;

    fn assets(names: &[&str]) -> Vec<serde_json::Value> {
        names
            .iter()
            .map(|n| {
                json!({
                    "name": n,
                    "browser_download_url": format!("https://example.com/{n}"),
                })
            })
            .collect()
    }

    #[test]
    fn windows_picks_msi() {
        let assets = assets(&["KimiSwitch_0.7.0_x64_en-US.msi", "KimiSwitch_0.7.0_aarch64.dmg", "KimiSwitch_0.7.0_amd64.AppImage"]);
        let url = pick_asset_for_current_os(&assets);
        assert_eq!(url.as_deref(), Some("https://example.com/KimiSwitch_0.7.0_x64_en-US.msi"));
    }

    #[test]
    fn macos_picks_dmg() {
        let assets = assets(&["KimiSwitch_0.7.0_x64_en-US.msi", "KimiSwitch_0.7.0_aarch64.dmg", "KimiSwitch_0.7.0_amd64.AppImage"]);
        let url = pick_asset_for_current_os(&assets);
        assert_eq!(url.as_deref(), Some("https://example.com/KimiSwitch_0.7.0_aarch64.dmg"));
    }

    #[test]
    fn linux_picks_appimage() {
        let assets = assets(&["KimiSwitch_0.7.0_x64_en-US.msi", "KimiSwitch_0.7.0_aarch64.dmg", "KimiSwitch_0.7.0_amd64.AppImage"]);
        let url = pick_asset_for_current_os(&assets);
        assert_eq!(url.as_deref(), Some("https://example.com/KimiSwitch_0.7.0_amd64.AppImage"));
    }

    #[test]
    fn missing_target_returns_none() {
        let assets = assets(&["KimiSwitch_0.7.0_x64_en-US.msi"]);
        let url = pick_asset_for_current_os(&assets);
        assert_eq!(url, None);
    }

    #[test]
    fn empty_assets_returns_none() {
        let url = pick_asset_for_current_os(&[]);
        assert_eq!(url, None);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test asset_picker_tests --message-format=short 2>&1 | tail -10`
Expected: compile error `function \`pick_asset_for_current_os\` not found`

- [ ] **Step 3: Implement the function**

Add to `src-tauri/src/commands.rs` (above the test module):

```rust
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
    assets
        .iter()
        .find(|a| {
            a.get("name")
                .and_then(|n| n.as_str())
                .map(|n| n.ends_with(target_ext))
                .unwrap_or(false)
        })
        .and_then(|a| a.get("browser_download_url"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Build the platform-specific temp filename for the downloaded installer.
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test asset_picker_tests --message-format=short 2>&1 | tail -10`
Expected: `test result: ok. 5 passed; 0 failed`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(update): TDD platform-aware asset picker + tests"
```

---

## Task 4: Wire asset picker into `check_for_update` and `download_update`

**Files:**
- Modify: `src-tauri/src/commands.rs` (the `check_for_update` and `download_update` functions)

**Interfaces:**
- Consumes: `pick_asset_for_current_os` (Task 3) and `update_temp_filename` (Task 3)
- Produces: `check_for_update` returns `download_url` for the current OS only; `download_update` writes to a platform-specific filename

- [ ] **Step 1: Replace the asset-selection block in `check_for_update`**

In `check_for_update`, find the existing block:

```rust
    let download_url = first
        .get("assets")
        .and_then(|a| a.as_array())
        .and_then(|a| a.first())
        .and_then(|a| a.get("browser_download_url"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
```

Replace with:

```rust
    let download_url = first
        .get("assets")
        .and_then(|a| a.as_array())
        .and_then(|a| pick_asset_for_current_os(a));
```

- [ ] **Step 2: Replace the temp filename in `download_update`**

In `download_update`, find the existing line:

```rust
    let file_path = temp_dir.join("KimiSwitch_update.msi");
```

Replace with:

```rust
    let file_path = temp_dir.join(update_temp_filename());
```

- [ ] **Step 3: Verify on Windows**

Run: `cd src-tauri && cargo check --message-format=short 2>&1 | tail -5`
Expected: finishes clean

- [ ] **Step 4: Run the unit tests**

Run: `cd src-tauri && cargo test asset_picker_tests --message-format=short 2>&1 | tail -5`
Expected: `5 passed; 0 failed`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(update): use platform-aware asset and filename in update flow"
```

---

## Task 5: Version consistency check script

**Files:**
- Create: `scripts/check-version.sh`

**Interfaces:**
- Inputs: `expected_version` from CLI arg; reads `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`
- Output: exit 0 if all match, exit 1 otherwise (with diff to stderr)

- [ ] **Step 1: Write the script**

Create `scripts/check-version.sh`:

```bash
#!/usr/bin/env bash
# Verify that the version across the project matches the expected version.
# Usage: check-version.sh <expected>
# Reads:
#   package.json                  : root
#   src-tauri/Cargo.toml          : version field
#   src-tauri/tauri.conf.json     : version field
set -euo pipefail

EXPECTED="${1:-}"

if [ -z "$EXPECTED" ]; then
  echo "usage: check-version.sh <expected>" >&2
  exit 2
fi

# Strip leading 'v' for comparison (we expect semver without v)
EXPECTED_BARE="${EXPECTED#v}"

PKG_VERSION=$(node -p "require('./package.json').version")
CARGO_VERSION=$(grep -E '^version\s*=' src-tauri/Cargo.toml | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
TAURI_VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")

fail=0
check() {
  local label="$1"
  local actual="$2"
  if [ "$actual" != "$EXPECTED_BARE" ]; then
    echo "FAIL: $label = $actual (expected $EXPECTED_BARE)" >&2
    fail=1
  fi
}

check "package.json"               "$PKG_VERSION"
check "src-tauri/Cargo.toml"       "$CARGO_VERSION"
check "src-tauri/tauri.conf.json"  "$TAURI_VERSION"

if [ $fail -ne 0 ]; then
  exit 1
fi

echo "OK: all versions = $EXPECTED_BARE"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/check-version.sh`
Expected: no output

- [ ] **Step 3: Test happy path**

Run: `./scripts/check-version.sh v0.6.0`
Expected: `OK: all versions = 0.6.0`

- [ ] **Step 4: Test mismatch**

Run: `./scripts/check-version.sh v9.9.9`
Expected: 3 lines starting with `FAIL:` and exit code 1

- [ ] **Step 5: Commit**

```bash
git add scripts/check-version.sh
git commit -m "ci: add version-consistency check script"
```

---

## Task 6: GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Trigger: `push: tags: ['v*']`
- Two jobs: `version-check` (sequential) and `build` (matrix ubuntu/macos/windows)

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  version-check:
    name: Version consistency
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Verify tag matches package.json / Cargo.toml / tauri.conf.json
        run: |
          TAG="${GITHUB_REF_NAME}"
          chmod +x scripts/check-version.sh
          ./scripts/check-version.sh "$TAG"

  build:
    name: Build (${{ matrix.platform }})
    needs: version-check
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: ubuntu-latest
            args: --bundles deb,appimage,rpm
          - platform: macos-latest
            args: --bundles app,dmg
          - platform: windows-latest
            args: --bundles msi

    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - uses: actions/setup-rust@v1
        with:
          cache: true

      - name: Install Linux build dependencies
        if: matrix.platform == 'ubuntu-latest'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libappindicator3-dev \
            librsvg2-dev \
            patchelf \
            build-essential \
            curl \
            wget \
            file \
            libssl-dev \
            libgtk-3-dev \
            libayatana-appindicator3-dev

      - name: Build and upload release
        uses: tauri-apps/tauri-action@v0
        with:
          tagName: ${{ github.ref_name }}
          releaseName: ${{ github.ref_name }}
          releaseBody: |
            ## ${{ github.ref_name }}

            ### Downloads by platform

            - **Windows**: `.msi` installer
            - **macOS**: `.dmg` (unsigned — first launch needs right-click → Open) + `.app`
            - **Linux**: `.deb` / `.AppImage` / `.rpm`

            Full changelog: see commit history.
          releaseDraft: true
          prerelease: ${{ contains(github.ref_name, '-rc') || contains(github.ref_name, '-beta') || contains(github.ref_name, '-alpha') }}
          args: ${{ matrix.args }}
```

- [ ] **Step 2: Sanity-check the file is in place**

Run: `ls -la .github/workflows/release.yml && head -5 .github/workflows/release.yml`
Expected: file exists and the first line is `name: Release` (GitHub Actions will catch any YAML syntax errors at runtime)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add multi-platform release workflow on tag push"
```

---

## Task 7: Local Docker for Linux builds

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`

**Interfaces:**
- Input: source tree at `/workspace`
- Output: built packages at `/workspace/src-tauri/target/release/bundle/{deb,appimage,rpm}/`

- [ ] **Step 1: Create the Dockerfile**

Create `Dockerfile`:

```dockerfile
# Build Kimi Switch Linux packages (deb / AppImage / rpm) inside a clean
# Ubuntu 22.04 container. Used both locally (`docker compose run`) and as a
# reference for GH Actions' ubuntu-latest job.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV CARGO_TERM_COLOR=always
ENV RUSTUP_HOME=/usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo
ENV PATH=/usr/local/cargo/bin:$PATH

RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    build-essential \
    pkg-config \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libwebkit2gtk-4.1-dev \
    libsoup-3.0-dev \
    libjavascriptcoregtk-4.1-dev \
    patchelf \
    file \
    nodejs \
    npm \
    python3 \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal

RUN cargo install tauri-cli --version "^2.0" --locked

WORKDIR /workspace

CMD ["/bin/bash"]
```

- [ ] **Step 2: Create docker-compose.yml**

Create `docker-compose.yml`:

```yaml
services:
  build-linux:
    build: .
    container_name: kimiswitch-build-linux
    volumes:
      - .:/workspace
      - cargo-cache:/usr/local/cargo/registry
      - target-cache:/workspace/src-tauri/target
    working_dir: /workspace

volumes:
  cargo-cache:
  target-cache:
```

- [ ] **Step 3: Build the Docker image**

Run: `docker compose build build-linux 2>&1 | tail -10`
Expected: ends with `naming to docker.io/library/...build-linux  done` (or similar successful build output)

- [ ] **Step 4: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "ci: add Linux Docker build environment"
```

---

## Task 8: Build documentation

**Files:**
- Create: `docs/BUILD.md`

**Interfaces:**
- Audience: contributors who want to build the project locally
- Output: instructions for Windows / macOS / Linux local builds + Docker Linux build

- [ ] **Step 1: Write the doc**

Create `docs/BUILD.md`:

````markdown
# Build

Docker (Linux), native (any platform), and CI (multi-platform) build instructions.

## Local builds by host

### Windows (current primary dev environment)

Prerequisites: Rust stable, Node 20, Microsoft C++ Build Tools, WebView2.

```bash
npm ci
npm run tauri build -- --bundles msi
```

Output: `src-tauri/target/release/bundle/msi/`.

### macOS

Prerequisites: Xcode command-line tools, Rust stable, Node 20.

```bash
npm ci
npm run tauri build -- --bundles app,dmg
```

Output: `src-tauri/target/release/bundle/{macos,dmg}/`.

Unsigned: first launch requires right-click → Open to bypass Gatekeeper.

### Linux (native)

Prerequisites: see `Dockerfile` for the full apt-get list (webkit2gtk-4.1, librsvg2, etc.).

```bash
npm ci
npm run tauri build -- --bundles deb,appimage,rpm
```

Output: `src-tauri/target/release/bundle/{deb,appimage,rpm}/`.

### Linux via Docker (works on Windows / macOS too)

```bash
docker compose build build-linux
docker compose run --rm build-linux bash -c '
  npm ci &&
  npm run tauri build -- --bundles deb,appimage,rpm
'
```

Output is mounted back to `src-tauri/target/release/bundle/` on the host.

## CI: GitHub Actions

`.github/workflows/release.yml` runs on `git tag v* && git push origin v*`.

1. `version-check` runs `scripts/check-version.sh` to ensure tag matches `package.json`, `Cargo.toml`, `tauri.conf.json`.
2. Three parallel jobs build for `ubuntu-latest`, `macos-latest`, `windows-latest` using `tauri-action`.
3. Artifacts are uploaded to the GitHub Release (auto-draft for non-prerelease tags).

To cut a release:

```bash
# 1. Bump version in three places
#    package.json:               "version": "0.7.0"
#    src-tauri/Cargo.toml:       version = "0.7.0"
#    src-tauri/tauri.conf.json:  "version": "0.7.0"
# 2. Commit
git commit -am "chore(release): bump to v0.7.0"
# 3. Tag and push
git tag v0.7.0
git push origin v0.7.0
```

## Update checker asset selection

`src-tauri/src/commands.rs::pick_asset_for_current_os` picks the right asset by file extension:

| OS      | Extension  |
|---------|------------|
| Windows | `.msi`     |
| macOS   | `.dmg`     |
| Linux   | `.AppImage` (preferred; deb / rpm downloadable manually from the release page) |

If the preferred extension is missing, the UI falls back to opening the release page.
````

- [ ] **Step 2: Commit**

```bash
git add docs/BUILD.md
git commit -m "docs: build instructions for all platforms + Docker + CI"
```

---

## Task 9: README — multi-platform download links + workflow badge

**Files:**
- Modify: `README.md`
- Modify: `README_EN.md`

**Interfaces:**
- Adds a "下载" / "Downloads" section with three platform bullets
- Adds a build-from-source link to `docs/BUILD.md`
- Adds a GitHub Actions badge

- [ ] **Step 1: Add the badges (after the existing license badge)**

In `README.md`, locate the line:

```markdown
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
```

Add two new badges below it:

```markdown
[![Release](https://github.com/billowliu2/KimiSwitch/actions/workflows/release.yml/badge.svg)](https://github.com/billowliu2/KimiSwitch/releases/latest)
```

(Do the same in `README_EN.md`.)

- [ ] **Step 2: Add a "下载" section right after "这是什么"**

In `README.md`, after the paragraph immediately above `## 核心特性`, insert:

```markdown
## 下载

- **Windows**: [GitHub Releases](https://github.com/billowliu2/KimiSwitch/releases/latest) → `.msi`
- **macOS**: [GitHub Releases](https://github.com/billowliu2/KimiSwitch/releases/latest) → `.dmg`（**未签名** —— 首次启动请右键 → 打开绕过 Gatekeeper）
- **Linux**: [GitHub Releases](https://github.com/billowliu2/KimiSwitch/releases/latest) → `.deb` / `.AppImage` / `.rpm`

历史版本（v0.5.x 及之前）请前往 [git.codingplan.site 仓库](https://git.codingplan.site/admin/KimiCodeSwitch/releases)。

构建说明请见 [`docs/BUILD.md`](./docs/BUILD.md)。
```

In `README_EN.md`, insert the English equivalent:

```markdown
## Downloads

- **Windows**: [GitHub Releases](https://github.com/billowliu2/KimiSwitch/releases/latest) → `.msi`
- **macOS**: [GitHub Releases](https://github.com/billowliu2/KimiSwitch/releases/latest) → `.dmg` (**unsigned** — first launch needs right-click → Open to bypass Gatekeeper)
- **Linux**: [GitHub Releases](https://github.com/billowliu2/KimiSwitch/releases/latest) → `.deb` / `.AppImage` / `.rpm`

Historical versions (v0.5.x and earlier) live on the [git.codingplan.site repository](https://git.codingplan.site/admin/KimiCodeSwitch/releases).

Build instructions: [`docs/BUILD.md`](./docs/BUILD.md).
```

- [ ] **Step 3: Commit**

```bash
git add README.md README_EN.md
git commit -m "docs(readme): multi-platform downloads + workflow badge"
```

---

## Task 10: End-to-end test with a pre-release tag

**Files:**
- (No file changes — pure verification)

**Goal:** Confirm the GH Actions workflow actually produces all 6 assets. Use a pre-release tag so it doesn't pollute the main `v0.6.0` release.

- [ ] **Step 1: Confirm current version is in sync**

Run: `./scripts/check-version.sh v0.6.0`
Expected: `OK: all versions = 0.6.0`

- [ ] **Step 2: Push all un-pushed commits**

```bash
git push origin main
git push origin --tags
```

- [ ] **Step 3: Tag a pre-release on the current commit**

```bash
git tag v0.6.0-rc1
git push origin v0.6.0-rc1
```

- [ ] **Step 4: Watch the workflow run**

Open: https://github.com/billowliu2/KimiSwitch/actions

Expected: `version-check` job passes, then 3 `build` jobs run in parallel. Total time roughly 10-15 minutes per platform.

- [ ] **Step 5: Verify the pre-release**

Open: https://github.com/billowliu2/KimiSwitch/releases/tag/v0.6.0-rc1

Expected: 6 assets attached (`.msi`, `.dmg`, `.app`, `.deb`, `.AppImage`, `.rpm`); release marked as "Pre-release".

- [ ] **Step 6: Verify version mismatch fails the workflow**

On a clean branch, change only `package.json` version to `0.9.0`, commit, then:

```bash
git tag v0.6.0-rc2
git push origin v0.6.0-rc2
```

Open the new workflow run. Expected: `version-check` job fails with `FAIL: package.json = 0.9.0 (expected 0.6.0)`. Build jobs are skipped.

Then revert the package.json change and delete the rc2 tag:

```bash
git checkout main -- package.json
git tag -d v0.6.0-rc2
git push origin :refs/tags/v0.6.0-rc2
```

- [ ] **Step 7: Clean up the rc1 tag**

After verifying the rc1 assets are good, delete the pre-release to keep the release list clean:

```bash
git tag -d v0.6.0-rc1
git push origin :refs/tags/v0.6.0-rc1
# Then delete the GitHub Release via the web UI (or leave it as a historical rc)
```

- [ ] **Step 8: Final commit — none if Tasks 1-9 are clean**

If no edits were needed, no commit. Otherwise, commit any fixups.

---

## Summary

After all 10 tasks, the project ships with:
- macOS + Linux + Windows builds produced from a single `git tag v0.7.0` push
- Local Docker for Linux dev iteration
- Per-platform asset picker in the update checker
- README + BUILD docs covering all three platforms
- Version-consistency gate preventing drift between tag and the three version files
