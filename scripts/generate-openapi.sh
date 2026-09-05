#!/bin/bash
set -e

# Regenerate the committed OpenAPI spec for Current.
#
# The spec is produced at compile time from the service's utoipa ApiDoc via
# `--dump-openapi`, which writes the file and exits before any startup work.
# It never contacts a running service or a database.
#
# Usage:
#   scripts/generate-openapi.sh          # regenerate the spec
#   scripts/generate-openapi.sh --check  # fail if regenerating would change it (CI)

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

OPENAPI_DIR="openapi"

# service name -> cargo manifest lives at src/rust/<name>
SERVICES=(current)

CHECK_MODE=0
[ "${1:-}" = "--check" ] && CHECK_MODE=1

mkdir -p "$OPENAPI_DIR"

echo "Dumping OpenAPI specs..."
for svc in "${SERVICES[@]}"; do
    cargo run --quiet --manifest-path "src/rust/$svc/Cargo.toml" --bin "$svc" -- \
        --dump-openapi "$OPENAPI_DIR/$svc.json"
done

# The incident-tracker UI hand-writes its API layer (no generated types), so
# there is nothing to regenerate here. If that changes, generate them above
# and add the output directory to the check below.

if [ "$CHECK_MODE" = "1" ]; then
    if ! git diff --quiet -- "$OPENAPI_DIR" 2>/dev/null; then
        echo >&2
        echo "ERROR: the committed OpenAPI spec is out of date." >&2
        echo "Run scripts/generate-openapi.sh and commit the result." >&2
        git --no-pager diff --stat -- "$OPENAPI_DIR" >&2
        exit 1
    fi
    echo "OpenAPI spec is up to date."
fi
