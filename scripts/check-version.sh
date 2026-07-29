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
