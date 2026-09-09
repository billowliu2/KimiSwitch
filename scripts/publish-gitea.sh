#!/usr/bin/env bash
# Publish a release (notes + assets) to the domestic Gitea mirror
# (git.codingplan.site/admin/KimiCodeSwitch).
#
# Usage: publish-gitea.sh <tag> <asset> [asset...]
#   tag    : e.g. v0.7.15; notes read from release-notes-<tag>.md
#   assets : files to attach (MSI, install-macos.sh, ...)
#
# Auth: reuses the stored git credential for git.codingplan.site
# (`git credential fill`); the secret never appears in argv or output.
set -euo pipefail

GITEA="https://git.codingplan.site/api/v1"
REPO="admin/KimiCodeSwitch"
TAG="${1:?usage: publish-gitea.sh <tag> <asset> [asset...]}"
shift

NOTES_FILE="release-notes-${TAG}.md"
json_escape() {
  python - "$1" <<'PYEOF'
import json, sys
print(json.dumps(open(sys.argv[1], encoding="utf-8").read()))
PYEOF
}
if [[ -f "$NOTES_FILE" ]]; then
  BODY=$(json_escape "$NOTES_FILE")
else
  BODY="\"${TAG}\""
fi

# Resolve stored git credential for this host (no secret echoed).
CRED=$(printf 'protocol=https\nhost=git.codingplan.site\n\n' | git credential fill)
USER=$(grep '^username=' <<<"$CRED" | cut -d= -f2-)
PASS=$(grep '^password=' <<<"$CRED" | cut -d= -f2-)
[[ -n "$USER" && -n "$PASS" ]] || { echo "no stored credential for git.codingplan.site" >&2; exit 1; }
AUTH=(-u "$USER:$PASS")

# Create (or reuse) the release for this tag.
EXISTING=$(curl -sf --max-time 20 "${AUTH[@]}" "$GITEA/repos/$REPO/releases/tags/$TAG" || true)
if [[ -n "$EXISTING" && "$EXISTING" != *"message"* ]]; then
  RELEASE_ID=$(grep -o '"id":[0-9]*' <<<"$EXISTING" | head -1 | cut -d: -f2)
  echo "release $TAG exists (id=$RELEASE_ID), attaching assets"
else
  CREATED=$(curl -sf --max-time 20 "${AUTH[@]}" \
    -H 'Content-Type: application/json' -X POST \
    -d "{\"tag_name\":\"$TAG\",\"name\":\"$TAG\",\"body\":$BODY,\"draft\":false,\"prerelease\":false}" \
    "$GITEA/repos/$REPO/releases")
  RELEASE_ID=$(grep -o '"id":[0-9]*' <<<"$CREATED" | head -1 | cut -d: -f2)
  echo "created release $TAG (id=$RELEASE_ID)"
fi

for ASSET in "$@"; do
  [[ -f "$ASSET" ]] || { echo "skip missing asset: $ASSET" >&2; continue; }
  NAME=$(basename "$ASSET")
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 600 "${AUTH[@]}" \
    -F "attachment=@$ASSET" \
    "$GITEA/repos/$REPO/releases/$RELEASE_ID/assets?name=$NAME")
  echo "upload $NAME -> HTTP $CODE"
  [[ "$CODE" == 2* ]] || { echo "upload failed: $NAME" >&2; exit 1; }
done

echo "done: https://git.codingplan.site/$REPO/releases/tag/$TAG"
