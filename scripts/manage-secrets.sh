#!/bin/bash
# Manage Current's Kubernetes secrets (the current-api secret in odo-pub).
#
# The secret carries one connection URL, DATABASE_URL, read by both the
# service pod and the host tooling (manage-database.sh, run-tests.sh).
# PostgreSQL runs outside the cluster, so its host has to be reachable
# from both - a LAN address or a DNS name, never 'localhost'.
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
    echo "  show-secret          Show current secret values (passwords included)"
    echo "  update-db-url [url]  Set DATABASE_URL, the endpoint both the"
    echo "                       service pod and the host tooling use"
    echo "                       (restart the current service after)"
    echo
    echo "update-db-url prompts when the url is omitted."
    exit 1
}

mask() {
    # postgres://user:pass@host/db -> postgres://user:****@host/db
    sed -E 's#(://[^:/@]+:)[^@]*@#\1****@#'
}

show_secret() {
    echo -e "${YELLOW}${SECRET_NAME} (${SECRET_NAMESPACE}):${NC}"
    local value
    value=$(get_secret_value "$SECRET_NAMESPACE" "$SECRET_NAME" DATABASE_URL)
    echo "  DATABASE_URL = ${value:-<not set>}"
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
    echo -e "${YELLOW}Updating DATABASE_URL${NC}"
    update_url DATABASE_URL "$1" \
        "postgres://current:demo123@postgres.example.org:5432/current?sslmode=disable"

    echo -e "\n${BLUE}Host tooling picks this up straight from the secret.${NC}"
    echo -e "${YELLOW}Restart the service to pick it up there too:${NC}"
    echo "  ./scripts/deploy-service.sh current"
}

case "$COMMAND" in
    show-secret)
        show_secret
        ;;
    update-db-url)
        update_db_url "$2"
        ;;
    -h|--help|help)
        usage
        ;;
    *)
        echo -e "${RED}Error: Unknown command '$COMMAND'${NC}"
        usage
        ;;
esac
