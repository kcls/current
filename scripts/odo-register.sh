#!/bin/bash
# Run the odo-register tool (from the kcls/odo repo) against the given
# manifest(s). Installs the tool on first use via cargo from the odo git
# origin into .tools/ (gitignored); re-runs use the cached binary.
#
#   scripts/odo-register.sh src/odo-registration/manifest.json
#   scripts/odo-register.sh src/test-data/fixtures.json
#
# Environment (all optional):
#   ODO_GIT_URL     odo repo origin (default https://github.com/kcls/odo)
#   ODO_URL         gateway base (default http://localhost:30080)
#   REGISTRATION_USERNAME / REGISTRATION_PASSWORD

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TOOL="$PROJECT_ROOT/.tools/bin/odo-register"
ODO_GIT_URL="${ODO_GIT_URL:-https://github.com/kcls/odo}"

if [ ! -x "$TOOL" ]; then
    echo "Installing odo-register from $ODO_GIT_URL ..."
    cargo install odo-register --git "$ODO_GIT_URL" --branch main \
        --root "$PROJECT_ROOT/.tools" --quiet
fi

exec "$TOOL" "$@"
