#!/bin/bash
# Script to manage the Current PostgreSQL database and Sqitch migrations
#
# Connection settings (in order of precedence):
#   1. Environment variables: PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
#   2. Kubernetes secret: current-api in odo-pub namespace (DATABASE_URL)
#   3. Defaults: localhost:5432 (for host/port only)
#
# This script does NOT create Current's role or database. PostgreSQL runs
# outside the cluster and Current does not own it, so the role and an
# empty database it owns are created on the server first — see the README.
# Everything here runs as Current's own account against that database.

set -e

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source common database functions
source "$SCRIPT_DIR/common.sh"

# Default values
COMMAND=${1:-help}
DRY_RUN=${DRY_RUN:-false}
NAMESPACE=${NAMESPACE:-odo-pub}

# Sqitch directories
SQITCH_DIR="${SQITCH_DIR:-$PROJECT_ROOT/src/sqitch}"
SQITCH_SCHEMA_DIR="${SQITCH_SCHEMA_DIR:-$SQITCH_DIR/current}"

# Function to show usage
usage() {
    echo -e "${BLUE}Usage: $0 [command] [options]${NC}"
    echo
    echo "Database Commands:"
    echo "  update-password     Update database user password only"
    echo
    echo "Schema Commands:"
    echo "  deploy [target]  Deploy database schema changes to target (or HEAD)"
    echo "  revert-to [target] Revert database schema changes to target"
    echo "  revert-all       Revert all database schema changes"
    echo "  revert-last      Revert the most recent update"
    echo "  status           Show current schema deployment status"
    echo "  verify           Verify deployed schema changes"
    echo "  log              Show schema deployment history"
    echo
    echo "Test Data Commands:"
    echo "  deploy-test      Deploy test data (idempotent SQL + API fixtures, src/test-data/)"
    echo
    echo "Database Admin Commands:"
    echo "  purge-all        Drop all application schemas (prompts for confirmation)"
    echo
    echo "Environment variables:"
    echo "  PGHOST=hostname           Override database host (default: from the secret)"
    echo "  PGPORT=port               Override database port (default: from the secret)"
    echo "  PGDATABASE=dbname         Override database name (default: from secret)"
    echo "  PGUSER=username           Override database user (default: from secret)"
    echo "  PGPASSWORD=password       Override database password (default: from secret)"
    echo "  DRY_RUN=true              Show what would be done without making changes"
    echo "  NAMESPACE=name            Kubernetes namespace for secrets (default: odo-pub)"
    echo "  SQITCH_SCHEMA_DIR=/path   Override schema directory (default: $SQITCH_SCHEMA_DIR)"
    echo
    echo "Note: Database credentials are retrieved from Kubernetes secret by default"
    echo "      but can be overridden with environment variables"
    exit 1
}

# Initialize PostgreSQL connection parameters
if ! init_pg_connection "$NAMESPACE"; then
    exit 1
fi

# Alias for backward compatibility
connect() {
    connect_psql
}

# Run SQL as Current's own account.
execute_psql() {
    local sql="$1"
    local db="${2:-$PGDATABASE}"

    if [[ "$DRY_RUN" == "true" ]]; then
        echo -e "${YELLOW}[DRY RUN] Would execute:${NC}"
        echo "$sql"
        return
    fi

    PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$db" -c "$sql"
}

# Function to run sqitch command
run_sqitch() {
    local sqitch_dir="$1"
    local sqitch_command="$2"
    shift 2
    local sqitch_args="$@"
    
    # Check if sqitch is available
    if ! command -v sqitch &> /dev/null; then
        echo -e "${RED}sqitch command not found${NC}"
        echo "Please install sqitch: https://sqitch.org"
        exit 1
    fi
    
    # Check if sqitch directory exists
    if [ ! -d "$sqitch_dir" ]; then
        echo -e "${RED}Sqitch directory not found: $sqitch_dir${NC}"
        exit 1
    fi
    
    # Build database URI
    local db_uri="db:pg://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}"

    echo -e "${BLUE}Running sqitch $sqitch_command $sqitch_args in $sqitch_dir${NC}"

    if [[ "$DRY_RUN" == "true" ]]; then
        echo -e "${YELLOW}[DRY RUN] Would execute:${NC}"
        echo "cd $sqitch_dir && sqitch $sqitch_command --target $db_uri $sqitch_args"
        return
    fi

    # Run sqitch command
    cd "$sqitch_dir"
    sqitch $sqitch_command --target "$db_uri" $sqitch_args
}

# Schema commands
sqitch_deploy() {
    local target="${2:-HEAD}"
    echo -e "\n${YELLOW}Deploying database schema changes${NC}"
    run_sqitch "$SQITCH_SCHEMA_DIR" deploy $target
    echo -e "${GREEN}Schema deployment completed successfully${NC}"
}

sqitch_revert() {
    local target="$2"
    if [ -z "$target" ]; then
        echo -e "${RED}Error: revert command requires a target${NC}"
        echo "Usage: $0 revert <target>"
        echo "Example: $0 revert @HEAD^ (revert last change)"
        exit 1
    fi
    
    echo -e "\n${YELLOW}Reverting database schema changes to $target${NC}"
    run_sqitch "$SQITCH_SCHEMA_DIR" revert $target
    echo -e "${GREEN}Schema revert completed successfully${NC}"
}

sqitch_revert_all() {
    echo -e "\n${YELLOW}Reverting all database schema changes${NC}"
    echo -e "${RED}WARNING: This will remove all deployed schema changes!${NC}"
    
    #run_sqitch "$SQITCH_SCHEMA_DIR" revert --to @ROOT
    run_sqitch "$SQITCH_SCHEMA_DIR" revert
    echo -e "${GREEN}All schema changes reverted successfully${NC}"
}

sqitch_status() {
    echo -e "\n${YELLOW}Checking schema deployment status${NC}"
    run_sqitch "$SQITCH_SCHEMA_DIR" status
}

sqitch_verify() {
    echo -e "\n${YELLOW}Verifying deployed schema changes${NC}"
    run_sqitch "$SQITCH_SCHEMA_DIR" verify
    echo -e "${GREEN}Schema verification completed${NC}"
}

sqitch_log() {
    echo -e "\n${YELLOW}Schema deployment history${NC}"
    run_sqitch "$SQITCH_SCHEMA_DIR" log
}

# Test data: API-driven fixtures plus idempotent SQL files applied in order
# (no sqitch, no revert -- reloading pairs with a full DB rebuild).
# See src/test-data/.
deploy_test_data() {
    echo -e "\n${YELLOW}Deploying test data${NC}"
    "$SCRIPT_DIR/deploy-test-data.sh"
    echo -e "${GREEN}Test data deployment completed successfully${NC}"
}

purge_all_schemas() {
    echo -e "\n${RED}WARNING: This will drop all application schemas in database '${PGDATABASE}'.${NC}"

    local schemas=(incidents sqitch audit)

    echo -e "${RED}Schemas that will be dropped: $schemas${NC}"
    read -r -p "Type 'purge' to confirm: " confirmation

    if [[ "$confirmation" != "purge" ]]; then
        echo -e "${YELLOW}Purge cancelled.${NC}"
        return
    fi

    echo -e "${YELLOW}Dropping application schemas...${NC}"
    for schema in "${schemas[@]}"; do
        echo -e "${BLUE}Dropping schema '$schema'${NC}"
        execute_psql "DROP SCHEMA IF EXISTS \"$schema\" CASCADE;" "$PGDATABASE"
    done

    echo -e "${GREEN}All application schemas dropped.${NC}"
}

# Function to update password only
update_password() {
    echo -e "\n${YELLOW}Updating password for user '$PGUSER'${NC}"

    # A role can change its own password, which is all Current can do:
    # it does not own the PostgreSQL server and holds no admin account
    # there.
    if ! test_connection; then
        echo -e "${RED}Cannot connect as '$PGUSER' with the credentials in the secret.${NC}"
        echo
        echo "Current can only change its own password, so the stored one has"
        echo "to work first. Reset it on the database server:"
        echo "  ALTER ROLE $PGUSER WITH PASSWORD '<the password in the secret>';"
        echo "or point the secret at the working password:"
        echo "  ./scripts/manage-secrets.sh update-db-url"
        exit 1
    fi

    echo -e "${GREEN}Successfully connected with existing credentials${NC}"
    execute_psql "ALTER ROLE $PGUSER WITH PASSWORD '$PGPASSWORD';"

    echo -e "\n${GREEN}Password updated!${NC}"
    echo -e "${YELLOW}Note: The password was retrieved from the Kubernetes secret${NC}"
}

# Main script logic
case "$COMMAND" in
    connect)
        connect
        ;;
    update-password)
        update_password
        ;;
    deploy)
        sqitch_deploy "$@"
        ;;
    revert-to)
        sqitch_revert "$@"
        ;;
    revert-last)
        sqitch_revert "" "@HEAD^"
        ;;
    revert-all)
        sqitch_revert_all
        ;;
    status)
        sqitch_status
        ;;
    verify)
        sqitch_verify
        ;;
    log)
        sqitch_log
        ;;
    deploy-test)
        deploy_test_data
        ;;
    purge-all)
        purge_all_schemas
        ;;
    -h|--help|help)
        usage
        ;;
    *)
        echo -e "${RED}Error: Unknown command '$COMMAND'${NC}"
        usage
        ;;
esac
