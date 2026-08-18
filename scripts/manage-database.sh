#!/bin/bash
# Script to manage the Current PostgreSQL database and Sqitch migrations
#
# Connection settings (in order of precedence):
#   1. Environment variables: PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
#   2. Kubernetes secret: current-api in odo-pub namespace
#   3. Defaults: localhost:5432 (for host/port only)
#
# setup-dev-database and update-password assume the odo platform's
# containerized dev postgres: pass its bootstrap superuser (the odo
# database account) as ADMIN_PGUSER / ADMIN_PGPASSWORD, e.g.
#
#   ADMIN_PGUSER=odo ADMIN_PGPASSWORD=demo123 \
#       ./scripts/manage-database.sh setup-dev-database
#
# For anything else (host-local postgres, managed servers), create the
# role and database by hand — see the project docs.

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
    echo "  setup-dev-database  Create Current's role, database, and sqitch schema"
    echo "                      on the containerized dev postgres (needs ADMIN_PG*)"
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
    echo "  ADMIN_PGUSER/ADMIN_PGPASSWORD The containerized dev postgres bootstrap"
    echo "                            superuser (the odo database account), required by"
    echo "                            setup-dev-database and update-password resets"
    echo "                            (+ optional ADMIN_PGHOST/ADMIN_PGPORT overrides)"
    echo "  DRY_RUN=true              Show what would be done without making changes"
    echo "  NAMESPACE=name            Kubernetes namespace for secrets (default: odo-pub)"
    echo "  SQITCH_SCHEMA_DIR=/path   Override schema directory (default: $SQITCH_SCHEMA_DIR)"
    echo
    echo "Note: Database credentials are retrieved from Kubernetes secret by default"
    echo "      but can be overridden with environment variables"
    exit 1
}

# The admin connection: the containerized dev postgres bootstrap
# superuser, supplied via ADMIN_PGUSER/ADMIN_PGPASSWORD. Host/port
# default to Current's own resolved endpoint (the same server).
require_admin_credentials() {
    if [ -z "${ADMIN_PGUSER:-}" ] || [ -z "${ADMIN_PGPASSWORD:-}" ]; then
        echo -e "${RED}ADMIN_PGUSER / ADMIN_PGPASSWORD are required.${NC}"
        echo "Pass the containerized dev postgres bootstrap superuser (the odo"
        echo "database account), e.g.:"
        echo "  ADMIN_PGUSER=odo ADMIN_PGPASSWORD=demo123 $0 $COMMAND"
        echo "For other postgres setups, see the project docs."
        return 1
    fi
    ADMIN_PGHOST="${ADMIN_PGHOST:-$PGHOST}"
    ADMIN_PGPORT="${ADMIN_PGPORT:-$PGPORT}"
    echo -e "${BLUE}Admin connection: ${ADMIN_PGUSER}@${ADMIN_PGHOST}:${ADMIN_PGPORT}${NC}"
}

# Run SQL over the admin connection (against the maintenance database
# unless another is given).
admin_psql() {
    local sql="$1"
    local db="${2:-postgres}"

    if [[ "$DRY_RUN" == "true" ]]; then
        echo -e "${YELLOW}[DRY RUN] Would execute (admin):${NC}"
        echo "$sql"
        return
    fi

    PGPASSWORD="$ADMIN_PGPASSWORD" psql -h "$ADMIN_PGHOST" -p "$ADMIN_PGPORT" \
        -U "$ADMIN_PGUSER" -d "$db" -c "$sql"
}

# Query a scalar over the admin connection.
admin_query() {
    local sql="$1"
    local db="${2:-postgres}"

    PGPASSWORD="$ADMIN_PGPASSWORD" psql -h "$ADMIN_PGHOST" -p "$ADMIN_PGPORT" \
        -U "$ADMIN_PGUSER" -d "$db" -tAc "$sql" 2>/dev/null
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

# Check if the role exists (admin connection).
role_exists() {
    [ "$(admin_query "SELECT 1 FROM pg_roles WHERE rolname='$1'")" == "1" ]
}

# Function to check if schema exists
schema_exists() {
    local schema=$1
    local result

    result=$(PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -tAc "SELECT 1 FROM pg_namespace WHERE nspname='$schema'" 2>/dev/null)

    [ "$result" == "1" ]
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

# Create Current's role, database, and sqitch schema on the
# containerized dev postgres.
setup_dev_database() {
    echo -e "\n${YELLOW}Setting up the Current dev database${NC}"

    # If Current's own credentials already work, the role and database
    # exist — nothing to bootstrap.
    if test_connection; then
        echo -e "${GREEN}Connected as '$PGUSER'; role and database already exist${NC}"
    else
        require_admin_credentials || exit 1

        # The role owns its database but is deliberately NOT a
        # superuser: it shares the containerized postgres with the odo
        # database, and this keeps Current out of it.
        if role_exists "$PGUSER"; then
            echo -e "${BLUE}Role '$PGUSER' exists${NC}"
            echo -e "${GREEN}Syncing its password with the secret${NC}"
            admin_psql "ALTER ROLE $PGUSER WITH LOGIN PASSWORD '$PGPASSWORD';"
        else
            echo -e "${GREEN}Creating role '$PGUSER'${NC}"
            admin_psql "CREATE ROLE $PGUSER WITH LOGIN PASSWORD '$PGPASSWORD';"
        fi

        if [ "$(admin_query "SELECT 1 FROM pg_database WHERE datname='$PGDATABASE'")" == "1" ]; then
            echo -e "${BLUE}Database '$PGDATABASE' already exists${NC}"
        else
            echo -e "${GREEN}Creating database '$PGDATABASE' owned by '$PGUSER'${NC}"
            admin_psql "CREATE DATABASE $PGDATABASE OWNER $PGUSER;"
        fi

        if ! test_connection; then
            echo -e "${RED}Failed to connect as '$PGUSER' after setup${NC}"
            exit 1
        fi
    fi

    # Create sqitch schema (as the database owner)
    echo -e "${GREEN}Setting up sqitch schema${NC}"

    # Create sqitch schema if doesn't exist
    if schema_exists "sqitch"; then
        echo -e "${BLUE}Schema 'sqitch' already exists${NC}"
        # Make sure user owns the schema
        echo -e "${GREEN}Ensuring user owns sqitch schema${NC}"
        execute_psql "ALTER SCHEMA sqitch OWNER TO $PGUSER;" "$PGDATABASE"
    else
        echo -e "${GREEN}Creating schema 'sqitch'${NC}"
        execute_psql "CREATE SCHEMA sqitch AUTHORIZATION $PGUSER;" "$PGDATABASE"
    fi

    echo -e "\n${GREEN}Database setup completed successfully!${NC}"
    echo -e "${YELLOW}Summary:${NC}"
    echo "  Database: $PGDATABASE"
    echo "  User: $PGUSER (owner)"
    echo "  Sqitch schema: created and configured"
    echo
    echo -e "${BLUE}Next steps:${NC}"
    echo "1. Run '$0 deploy' to apply database schema migrations"
}

# Function to update password only
update_password() {
    echo -e "\n${YELLOW}Updating password for user '$PGUSER'${NC}"

    # A role can change its own password; fall back to the admin
    # connection when the stored credentials no longer work.
    if test_connection; then
        echo -e "${GREEN}Successfully connected with existing credentials${NC}"
        execute_psql "ALTER ROLE $PGUSER WITH PASSWORD '$PGPASSWORD';"
    else
        echo -e "${YELLOW}Cannot connect with current credentials; resetting via admin${NC}"
        require_admin_credentials || exit 1

        if ! role_exists "$PGUSER"; then
            echo -e "${RED}Role '$PGUSER' does not exist${NC}"
            echo "Run '$0 setup-dev-database' first to create it"
            exit 1
        fi
        admin_psql "ALTER ROLE $PGUSER WITH LOGIN PASSWORD '$PGPASSWORD';"
    fi

    echo -e "\n${GREEN}Password updated!${NC}"
    echo -e "${YELLOW}Note: The password was retrieved from the Kubernetes secret${NC}"
}

# Main script logic
case "$COMMAND" in
    connect)
        connect
        ;;
    setup-dev-database)
        setup_dev_database
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
