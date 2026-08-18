#!/bin/bash
# Run selected test suites against the k3s cluster. Run from the project root.
#
# Which suites run is chosen explicitly with flags — at least one is required:
#   --db           pgtap database tests
#   --integration  Rust integration tests (Current, against the cluster)
#   --e2e          UI e2e tests (all Playwright projects)
#   --unit         Rust unit tests
#   --all          every suite above
#
# Requires the test dependencies (pg_prove/pgTAP, cargo, node + Playwright
# browsers) to be installed first.
#
# Usage:
#   scripts/run-tests.sh --db --integration --e2e   # the cluster suites
#   scripts/run-tests.sh --unit                     # just Rust unit tests
#   scripts/run-tests.sh --db --integration --e2e --unit   # everything
#
# Environment variables (all optional):
#   PGHOST/PGPORT  Override the database endpoint (default: resolved
#                  from the current-api secret)
#   PGPASSWORD   PostgreSQL password (default: read from k8s secrets)

set -e

# Suite selection (set by flags; at least one is required).
RUN_DB=false
RUN_INTEGRATION=false
RUN_E2E=false
RUN_UNIT=false

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Shared DB connection helpers (init_pg_connection parses DATABASE_URL).
source "$SCRIPT_DIR/common.sh"

# PGHOST/PGPORT are NOT pre-defaulted here: init_pg_connection resolves
# them from the secret's EXTERNAL_DATABASE_URL, and setting them first
# would override it. Export them only to override the secret.

print_section() {
    echo
    echo -e "${YELLOW}>>> $1${NC}"
    echo
}

resolve_pg_password() {
    if [[ -n "$PGPASSWORD" && -n "$PGHOST" && -n "$PGPORT" ]]; then
        return
    fi

    print_section "Reading PostgreSQL password from k8s secrets"

    # The shared resolver fills host/port/user/db/password from the
    # secret (EXTERNAL_DATABASE_URL preferred); any PG* env vars the
    # caller exported act as overrides.
    if ! init_pg_connection odo-pub; then
        echo -e "${RED}Error: could not read postgres password from k8s secrets.${NC}"
        echo "Set PGPASSWORD manually or check that the odo-pub current-api"
        echo "secret exists and contains a DATABASE_URL."
        exit 1
    fi

    echo "Connection resolved from odo-pub/current-api"
}

# ---------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------

run_cargo_tests() {
    print_section "Running Rust unit tests"

    cd "$PROJECT_ROOT/src/rust"

    cargo test --manifest-path current/Cargo.toml

    echo "Rust unit tests passed"
}

run_pgtap_tests() {
    print_section "Running pgtap tests"

    # Resolves its own connection from the secret; the PG* variables we
    # exported above (or the caller's overrides) take precedence.
    "$SCRIPT_DIR/run-db-tests.sh"

    echo "pgtap tests passed"
}

run_integration_tests_suite() {
    print_section "Running Current integration tests"

    cd "$PROJECT_ROOT/src/integration-tests"
    cargo test

    echo "Current integration tests passed"
}

run_e2e_tests() {
    print_section "Running UI e2e tests"

    cd "$PROJECT_ROOT/src/e2e"

    # Run against the containerized/k3s UIs. All Playwright projects.
    BASE_URL=http://localhost:30080 npm run test

    echo "UI e2e tests passed"
}

usage() {
    echo "Usage: $0 [--db] [--integration] [--e2e] [--unit] [--all]"
    echo
    echo "Runs the selected test suites against the k3s cluster. Run from the"
    echo "project root. At least one suite flag is required."
    echo
    echo "Suites:"
    echo "  --db           pgtap database tests"
    echo "  --integration  Rust integration tests (odo)"
    echo "  --e2e          UI e2e tests (all Playwright projects)"
    echo "  --unit         Rust unit tests"
    echo "  --all          every suite above"
    echo "  --help, -h     Show this help"
    echo
    echo "Environment variables (all optional):"
    echo "  PGHOST/PGPORT  Override the endpoint (default: from the secret)"
    echo "  PGPASSWORD   PostgreSQL password (default: read from k8s secrets)"
}

print_results() {
    print_section "All Selected Tests Passed!"
    local ran=()
    [[ "$RUN_UNIT" == true ]] && ran+=("unit")
    [[ "$RUN_DB" == true ]] && ran+=("database")
    [[ "$RUN_INTEGRATION" == true ]] && ran+=("integration")
    [[ "$RUN_E2E" == true ]] && ran+=("e2e")
    echo -e "${GREEN}Completed: ${ran[*]}${NC}"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
    # Unit tests are the only suite that doesn't touch the cluster DB; resolve
    # the password only when a DB-touching suite is selected.
    if [[ "$RUN_DB" == true || "$RUN_INTEGRATION" == true || "$RUN_E2E" == true ]]; then
        resolve_pg_password
    fi

    [[ "$RUN_UNIT" == true ]] && run_cargo_tests
    [[ "$RUN_DB" == true ]] && run_pgtap_tests
    [[ "$RUN_INTEGRATION" == true ]] && run_integration_tests_suite
    [[ "$RUN_E2E" == true ]] && run_e2e_tests
    print_results
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
    case "$1" in
        --db)          RUN_DB=true; shift ;;
        --integration) RUN_INTEGRATION=true; shift ;;
        --e2e)         RUN_E2E=true; shift ;;
        --unit)        RUN_UNIT=true; shift ;;
        --all)
            RUN_DB=true
            RUN_INTEGRATION=true
            RUN_E2E=true
            RUN_UNIT=true
            shift
            ;;
        --help|-h)     usage; exit 0 ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}" >&2
            echo "Try '$0 --help'." >&2
            exit 1
            ;;
    esac
done

# Require at least one suite.
if [[ "$RUN_DB" == false && "$RUN_INTEGRATION" == false && "$RUN_E2E" == false && "$RUN_UNIT" == false ]]; then
    echo -e "${RED}Error: no test suite selected.${NC}" >&2
    echo >&2
    usage >&2
    exit 1
fi

main
