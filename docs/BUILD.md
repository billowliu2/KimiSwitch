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

Unsigned (no Developer ID account): downloaded copies are blocked by Gatekeeper.
For end users, attach `install-macos.sh` (auto-uploaded to each Release) or instruct:
right-click → Open, or `xattr -cr "/Applications/Kimi Switch.app"`.

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
