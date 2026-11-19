#!/bin/bash
set -euo pipefail

# Regenerate the screenshots used by the user docs in docs/.
#
# Each feature has a Playwright capture under tests/e2e/docs-capture/
# (<feature>.capture.ts) that creates its own demo data, drives the UI and
# writes PNGs to docs/generated/<feature>/. The Markdown pages are written by
# hand and reference those images by name, so a rerun refreshes pictures
# without touching text; review the image diff before committing.
#
# Run against a seeded dev/test deployment (e2e users and demo org tree),
# never a live site: captures create and delete incidents and may add a
# review chain at Lakeside Branch.
#
# Usage:
#   scripts/capture-docs.sh                  # every feature
#   scripts/capture-docs.sh incident-move    # one feature
#   BASE_URL=http://host:port scripts/capture-docs.sh
#
# BASE_URL defaults to http://localhost:30080 (the dev cluster gateway).

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT/tests/e2e"

if [ ! -d node_modules ]; then
    echo "tests/e2e/node_modules missing; run 'npm install' in tests/e2e first" >&2
    exit 1
fi

args=()
if [ $# -gt 0 ]; then
    for feature in "$@"; do
        spec="docs-capture/$feature.capture.ts"
        if [ ! -f "$spec" ]; then
            echo "no capture for '$feature' ($spec)" >&2
            exit 1
        fi
        args+=("$spec")
    done
fi

npx playwright test -c docs-capture.config.ts "${args[@]}"

echo
echo "Images written under docs/generated/. Changed:"
git -C "$REPO_ROOT" status --short -- docs/generated
