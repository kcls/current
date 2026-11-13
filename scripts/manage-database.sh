#!/bin/bash
# Manage Current's database and Sqitch migrations with odo's shared
# manage-database.sh, which reads this checkout's service-map.yaml
# (`database:`). Run with no arguments for its usage.
#
# Kept as a script here, rather than calling $ODO_HOME/scripts/... directly,
# because odo-deploy's site scripts run ./scripts/manage-database.sh inside
# the Current checkout.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/odo-home.sh"

ODO_PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)" ODO_INVOKED_AS="$0" \
    exec "$ODO_HOME/scripts/manage-database.sh" "$@"
