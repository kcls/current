#!/bin/bash
# Manage Current's Kubernetes secrets (the current-api secret in odo-pub).
#
# The secret carries two connection URLs with the same credentials:
#   DATABASE_URL           in-cluster endpoint, consumed by the service
#   EXTERNAL_DATABASE_URL  host-reachable endpoint, resolved by dev
#                          tooling (manage-database.sh, run-tests.sh)
#
# Dev defaults live in k8s/services/current/secrets.yaml; this script
# patches individual values without disturbing the rest of the secret.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

SECRET_NAMESPACE=${NAMESPACE:-odo-pub}
SECRET_NAME="current-api"

COMMAND=${1:-help}

usage() {
    echo -e "${BLUE}Usage: $0 [command] [options]${NC}"
    echo
    echo "Commands:"
    echo "  show-secret              Show current secret values (passwords included)"
    echo "  update-db-url [url]          Set the in-cluster DATABASE_URL and"
    echo "                               refresh EXTERNAL_DATABASE_URL's creds"
    echo "                               (restart the current service after)"
    echo "  update-external-db-url [url] Set EXTERNAL_DATABASE_URL (the"
    echo "                               host-reachable endpoint dev tooling"
    echo "                               resolves from the secret)"
    echo
    echo "Both update commands prompt when the url is omitted."
    exit 1
}

mask() {
    # postgres://user:pass@host/db -> postgres://user:****@host/db
    sed -E 's#(://[^:/@]+:)[^@]*@#\1****@#'
}

show_secret() {
    echo -e "${YELLOW}${SECRET_NAME} (${SECRET_NAMESPACE}):${NC}"
    for key in DATABASE_URL EXTERNAL_DATABASE_URL; do
        local value
        value=$(get_secret_value "$SECRET_NAMESPACE" "$SECRET_NAME" "$key")
        echo "  $key = ${value:-<not set>}"
    done
}

validate_url() {
    case "$1" in
        postgres://*|postgresql://*) ;;
        *)
            echo -e "${RED}URL must start with postgres:// or postgresql://${NC}"
            exit 1
            ;;
    esac
}

# update_url <key> <new-url> <suggestion-when-unset>
update_url() {
    local key=$1 new_url=$2 fallback=$3

    if [ -z "$new_url" ]; then
        local current
        current=$(get_secret_value "$SECRET_NAMESPACE" "$SECRET_NAME" "$key")
        current=${current:-$fallback}
        read -p "$key [$(echo "$current" | mask)]: " new_url
        new_url=${new_url:-$current}
    fi
    if [ -z "$new_url" ]; then
        echo -e "${RED}No URL provided${NC}"
        exit 1
    fi
    validate_url "$new_url"

    kubectl -n "$SECRET_NAMESPACE" patch secret "$SECRET_NAME" --type=merge \
        -p "{\"stringData\":{\"$key\":\"$new_url\"}}"
    echo -e "${GREEN}  ✓ ${SECRET_NAME} → ${SECRET_NAMESPACE} (${key})${NC}"
}

update_db_url() {
    echo -e "${YELLOW}Updating DATABASE_URL (in-cluster)${NC}"
    update_url DATABASE_URL "$1" \
        "postgres://current:demo123@postgres.odo-core.svc.cluster.local:5432/current?sslmode=disable"

    # Refresh EXTERNAL_DATABASE_URL with the new credentials/db, keeping
    # its own host-reachable endpoint (fallback localhost:5432).
    local new_url rest userinfo hostpart dbpart
    new_url=$(get_secret_value "$SECRET_NAMESPACE" "$SECRET_NAME" DATABASE_URL)
    rest="${new_url#*://}"
    userinfo="${rest%%@*}"
    hostpart="${rest#*@}"
    dbpart="${hostpart#*/}"

    local ext_url ext_hostport
    ext_url=$(get_secret_value "$SECRET_NAMESPACE" "$SECRET_NAME" EXTERNAL_DATABASE_URL)
    if [ -n "$ext_url" ]; then
        ext_hostport="${ext_url#*://}"; ext_hostport="${ext_hostport#*@}"
        ext_hostport="${ext_hostport%%/*}"
    else
        ext_hostport="localhost:5432"
    fi
    local external_url="postgres://${userinfo}@${ext_hostport}/${dbpart}"
    kubectl -n "$SECRET_NAMESPACE" patch secret "$SECRET_NAME" --type=merge \
        -p "{\"stringData\":{\"EXTERNAL_DATABASE_URL\":\"$external_url\"}}"
    echo -e "${GREEN}  ✓ ${SECRET_NAME} → ${SECRET_NAMESPACE} (EXTERNAL_DATABASE_URL creds refreshed)${NC}"
    echo "  External: $(echo "$external_url" | mask)"

    echo -e "\n${YELLOW}Restart the service to pick this up:${NC}"
    echo "  ./scripts/deploy-service.sh current"
}

update_external_db_url() {
    echo -e "${YELLOW}Updating EXTERNAL_DATABASE_URL${NC}"

    # Suggest the in-cluster URL with the host swapped to localhost when
    # the external value isn't set yet.
    local fallback in_cluster rest userinfo tail dbpart
    in_cluster=$(get_secret_value "$SECRET_NAMESPACE" "$SECRET_NAME" DATABASE_URL)
    if [ -n "$in_cluster" ]; then
        rest="${in_cluster#*://}"
        userinfo="${rest%%@*}"
        tail="${rest#*@}"
        dbpart="${tail#*/}"
        fallback="postgres://${userinfo}@localhost:5432/${dbpart}"
    fi

    update_url EXTERNAL_DATABASE_URL "$1" "$fallback"
    echo -e "\n${BLUE}Dev tooling (manage-database.sh, run-tests.sh) resolves this${NC}"
    echo -e "${BLUE}endpoint automatically; no pod restarts needed.${NC}"
}

case "$COMMAND" in
    show-secret)
        show_secret
        ;;
    update-db-url)
        update_db_url "$2"
        ;;
    update-external-db-url)
        update_external_db_url "$2"
        ;;
    -h|--help|help)
        usage
        ;;
    *)
        echo -e "${RED}Error: Unknown command '$COMMAND'${NC}"
        usage
        ;;
esac
