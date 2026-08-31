#!/bin/bash
# Deploy Current's e2e/dev test data (src/test-data/). Two steps, in order:
#
#   1. fixtures.json          - users (with passwords) + grants via the
#                               odo APIs (applied by odo-register)
#   2. 001_e2e_review_chain   - SQL against Current's database (incidents)
#
# Everything is idempotent; re-running is always safe. Current never
# connects to the odo database: everything platform-side goes through
# the odo APIs.
#
# Prerequisites: platform seed deployed, Current registered
# (scripts/odo-register.sh src/odo-registration/manifest.json).
#
# Connection details for Current's database resolve from the current-api
# secret (DATABASE_URL); PG* environment variables act as overrides.
# The odo-register step honors ODO_URL / REGISTRATION_USERNAME /
# REGISTRATION_PASSWORD.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="$PROJECT_ROOT/src/test-data"

source "$SCRIPT_DIR/common.sh"

# Fills and exports PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD.
init_pg_connection || exit 1

cd "$DATA_DIR"

# 1. API-created users + grants (idempotent, DB-agnostic)
"$SCRIPT_DIR/odo-register.sh" "$DATA_DIR/fixtures.json"

# 2. Review chain fixtures - incidents schema, Current's database
echo "Applying SQL fixtures to: $PGUSER@$PGHOST:$PGPORT/$PGDATABASE"
for f in [0-9]*.sql; do
    echo "  applying $f"
    psql -q -v ON_ERROR_STOP=1 -f "$f"
done

echo "Current test data deployed."
