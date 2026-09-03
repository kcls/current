#!/bin/bash
# Deploy Current's own e2e/dev test data: the SQL fixtures that live in
# Current's database (src/test-data/[0-9]*.sql, incidents and the review
# chain). Idempotent; re-running is always safe.
#
# The other half of the test data -- the e2e user accounts and their role
# grants in src/test-data/fixtures.json -- is platform data, so it is
# applied from the odo checkout alongside the registration manifest:
#
#   cd /path/to/odo
#   ./scripts/load-data-manifest.sh /path/to/current/src/test-data/fixtures.json
#
# That is not run from here on purpose. The odo-registration account
# ships disabled with a password nobody holds, and odo's load-data-manifest.sh
# is what enables it for the length of a run, so Current never holds
# registration credentials.
#
# Prerequisites: platform seed deployed and Current registered (see the
# README, "Register Current With Odo").
#
# Connection details for Current's database resolve from the current-api
# secret (DATABASE_URL); PG* environment variables act as overrides.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="$PROJECT_ROOT/src/test-data"

source "$SCRIPT_DIR/common.sh"

# Fills and exports PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD.
init_pg_connection || exit 1

cd "$DATA_DIR"

# Review chain fixtures - incidents schema, Current's database
echo "Applying SQL fixtures to: $PGUSER@$PGHOST:$PGPORT/$PGDATABASE"
for f in [0-9]*.sql; do
    echo "  applying $f"
    psql -q -v ON_ERROR_STOP=1 -f "$f"
done

echo "Current test data deployed."
