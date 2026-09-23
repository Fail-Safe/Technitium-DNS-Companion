#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.multi-cluster-sso-test.yml"
ASSET_DIR="$PROJECT_ROOT/.multi-cluster-sso-test"
VERIFY_SCRIPT="$SCRIPT_DIR/verify-multi-cluster-sso-test.sh"
COMPOSE_PROJECT="technitium-companion-multi-cluster-sso-test"

SITE_A_PRIMARY_URL="http://127.0.0.1:${SITE_A_PRIMARY_HTTP_PORT:-15380}"
SITE_A_PRIMARY_HTTPS_URL="https://127.0.0.1:${SITE_A_PRIMARY_HTTPS_PORT:-15480}"
SITE_A_SECONDARY_URL="http://127.0.0.1:${SITE_A_SECONDARY_HTTP_PORT:-15381}"
SITE_B_PRIMARY_URL="http://127.0.0.1:${SITE_B_PRIMARY_HTTP_PORT:-15382}"
SITE_B_PRIMARY_HTTPS_URL="https://127.0.0.1:${SITE_B_PRIMARY_HTTPS_PORT:-15482}"
SITE_B_SECONDARY_URL="http://127.0.0.1:${SITE_B_SECONDARY_HTTP_PORT:-15383}"

RESET=false
CLEANUP=false

usage() {
  cat <<'EOF'
Usage: ./scripts/run-multi-cluster-sso-test.sh [--reset] [--cleanup]

  --reset    Remove only this harness's containers and named volumes first.
  --cleanup  Remove the harness containers and named volumes after a pass.

Generated credentials remain under the ignored .multi-cluster-sso-test/
directory. Their values are never printed by this script.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --reset)
      RESET=true
      ;;
    --cleanup)
      CLEANUP=true
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

for command_name in curl docker htpasswd jq node openssl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
done

compose() {
  docker compose --project-name "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" "$@"
}

log() {
  printf '[multi-cluster-sso] %s\n' "$*" >&2
}

fail() {
  log "ERROR: $*"
  exit 1
}

on_error() {
  log "Harness failed. Container state follows; secret values are not included."
  compose ps >&2 || true
}
trap on_error ERR

write_secret() {
  local path="$1"
  local bytes="$2"
  if [ ! -s "$path" ]; then
    openssl rand -hex "$bytes" >"$path"
    chmod 600 "$path"
  fi
}

prepare_assets() {
  umask 077
  mkdir -p "$ASSET_DIR/tls"
  chmod 700 "$ASSET_DIR" "$ASSET_DIR/tls"

  write_secret "$ASSET_DIR/node-admin-password" 24
  write_secret "$ASSET_DIR/account-password" 24
  write_secret "$ASSET_DIR/browser-password" 24
  write_secret "$ASSET_DIR/proxy-secret" 32

  local admin_password
  IFS= read -r admin_password <"$ASSET_DIR/node-admin-password"
  printf 'DNS_SERVER_ADMIN_PASSWORD=%s\n' "$admin_password" \
    >"$ASSET_DIR/technitium.env"
  chmod 600 "$ASSET_DIR/technitium.env"

  local browser_password
  IFS= read -r browser_password <"$ASSET_DIR/browser-password"
  if [ ! -s "$ASSET_DIR/htpasswd" ]; then
    printf '%s\n' "$browser_password" |
      htpasswd -ciB "$ASSET_DIR/htpasswd" 'operator@example.test' >/dev/null 2>&1
    printf '%s\n' "$browser_password" |
      htpasswd -iB "$ASSET_DIR/htpasswd" 'site-a-only@example.test' >/dev/null 2>&1
    printf '%s\n' "$browser_password" |
      htpasswd -iB "$ASSET_DIR/htpasswd" 'partial-failure@example.test' >/dev/null 2>&1
  fi
  chmod 600 "$ASSET_DIR/htpasswd"

  if [ ! -s "$ASSET_DIR/tls/key.pem" ] || [ ! -s "$ASSET_DIR/tls/cert.pem" ]; then
    openssl req \
      -x509 \
      -newkey rsa:2048 \
      -sha256 \
      -nodes \
      -days 7 \
      -subj '/CN=localhost' \
      -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' \
      -keyout "$ASSET_DIR/tls/key.pem" \
      -out "$ASSET_DIR/tls/cert.pem" \
      >/dev/null 2>&1
  fi
  chmod 600 "$ASSET_DIR/tls/key.pem"
  chmod 644 "$ASSET_DIR/tls/cert.pem"
}

raw_request() {
  local method="$1"
  local base_url="$2"
  local path="$3"
  local bearer_token="$4"
  shift 4

  if [ -n "$bearer_token" ]; then
    printf 'header = "Authorization: Bearer %s"\n' "$bearer_token" |
      curl \
        --config - \
        --silent \
        --show-error \
        --max-time 180 \
        --request "$method" \
        --get \
        "$@" \
        "$base_url$path"
  else
    curl \
      --silent \
      --show-error \
      --max-time 180 \
      --request "$method" \
      --get \
      "$@" \
      "$base_url$path"
  fi
}

require_ok() {
  local label="$1"
  local response="$2"
  if ! jq -e '.status == "ok"' >/dev/null 2>&1 <<<"$response"; then
    local reason
    reason="$(jq -r '.errorMessage // .status // "unexpected response"' <<<"$response" 2>/dev/null || printf 'unexpected response')"
    fail "$label failed: $reason"
  fi
}

login_admin() {
  local base_url="$1"
  local admin_password="$2"
  local response
  response="$(raw_request GET "$base_url" '/api/user/login' '' \
    --data-urlencode 'user=admin' \
    --data-urlencode "pass=$admin_password" \
    --data-urlencode 'includeInfo=true')"
  require_ok "Administrator login at $base_url" "$response"
  jq -er '.token // .response.token' <<<"$response"
}

session_info() {
  local base_url="$1"
  local token="$2"
  raw_request GET "$base_url" '/api/user/session/get' "$token"
}

wait_for_api() {
  local label="$1"
  local base_url="$2"
  local attempt
  for attempt in $(seq 1 90); do
    if raw_request GET "$base_url" '/api/status' '' 2>/dev/null |
      jq -e '.status == "ok"' >/dev/null 2>&1; then
      return
    fi
    sleep 2
  done
  fail "$label did not become ready at $base_url"
}

wait_for_https_api() {
  local label="$1"
  local base_url="$2"
  local attempt
  for attempt in $(seq 1 90); do
    if curl \
      --insecure \
      --silent \
      --show-error \
      --max-time 5 \
      "$base_url/api/status" \
      2>/dev/null |
      jq -e '.status == "ok"' >/dev/null 2>&1; then
      return
    fi
    sleep 2
  done
  fail "$label HTTPS API did not become ready at $base_url"
}

wait_for_cluster() {
  local label="$1"
  local base_url="$2"
  local admin_password="$3"
  local cluster_domain="$4"
  local attempt token response

  for attempt in $(seq 1 90); do
    token="$(login_admin "$base_url" "$admin_password")"
    response="$(session_info "$base_url" "$token")"
    if jq -e \
      --arg domain "$cluster_domain" \
      '(.response // .) | .info.clusterInitialized == true and .info.clusterDomain == $domain and ([.info.clusterNodes[]?.type] | index("Primary") != null) and ([.info.clusterNodes[]?.type] | index("Secondary") != null)' \
      >/dev/null 2>&1 <<<"$response"; then
      return
    fi
    sleep 2
  done
  fail "$label did not report a complete Primary/Secondary topology"
}

ensure_cluster() {
  local site_label="$1"
  local cluster_domain="$2"
  local primary_url="$3"
  local primary_https_url="$4"
  local primary_internal_url="$5"
  local primary_ip="$6"
  local secondary_url="$7"
  local secondary_ip="$8"
  local admin_password="$9"

  local primary_token primary_info response
  primary_token="$(login_admin "$primary_url" "$admin_password")"
  primary_info="$(session_info "$primary_url" "$primary_token")"
  require_ok "$site_label Primary session inspection" "$primary_info"

  if jq -e '(.response // .) | .info.clusterInitialized != true' \
    >/dev/null 2>&1 <<<"$primary_info"; then
    log "Initializing $site_label Primary"
    response="$(raw_request POST "$primary_url" '/api/admin/cluster/init' "$primary_token" \
      --data-urlencode "clusterDomain=$cluster_domain" \
      --data-urlencode "primaryNodeIpAddresses=$primary_ip")"
    require_ok "$site_label cluster initialization" "$response"
    wait_for_api "$site_label Primary" "$primary_url"
  elif ! jq -e --arg domain "$cluster_domain" \
    '(.response // .) | .info.clusterDomain == $domain' \
    >/dev/null 2>&1 <<<"$primary_info"; then
    fail "$site_label Primary belongs to an unexpected existing cluster"
  fi
  wait_for_https_api "$site_label Primary" "$primary_https_url"

  local secondary_token secondary_info
  secondary_token="$(login_admin "$secondary_url" "$admin_password")"
  secondary_info="$(session_info "$secondary_url" "$secondary_token")"
  require_ok "$site_label Secondary session inspection" "$secondary_info"

  if jq -e '(.response // .) | .info.clusterInitialized != true' \
    >/dev/null 2>&1 <<<"$secondary_info"; then
    log "Joining $site_label Secondary"
    response="$(raw_request POST "$secondary_url" '/api/admin/cluster/initJoin' "$secondary_token" \
      --data-urlencode "secondaryNodeIpAddresses=$secondary_ip" \
      --data-urlencode "primaryNodeUrl=$primary_internal_url" \
      --data-urlencode "primaryNodeIpAddress=$primary_ip" \
      --data-urlencode 'ignoreCertificateErrors=true' \
      --data-urlencode 'primaryNodeUsername=admin' \
      --data-urlencode "primaryNodePassword=$admin_password")"
    require_ok "$site_label Secondary join" "$response"
    wait_for_api "$site_label Secondary" "$secondary_url"
  elif ! jq -e --arg domain "$cluster_domain" \
    '(.response // .) | .info.clusterDomain == $domain' \
    >/dev/null 2>&1 <<<"$secondary_info"; then
    fail "$site_label Secondary belongs to an unexpected existing cluster"
  fi

  wait_for_cluster "$site_label Primary" "$primary_url" "$admin_password" "$cluster_domain"
  wait_for_cluster "$site_label Secondary" "$secondary_url" "$admin_password" "$cluster_domain"
  log "$site_label reports an isolated two-node cluster"
}

ensure_user() {
  local base_url="$1"
  local admin_token="$2"
  local username="$3"
  local password="$4"
  local groups="$5"
  local response

  response="$(raw_request GET "$base_url" '/api/admin/users/get' "$admin_token" \
    --data-urlencode "user=$username" \
    --data-urlencode 'includeGroups=true')"
  if ! jq -e '.status == "ok"' >/dev/null 2>&1 <<<"$response"; then
    response="$(raw_request POST "$base_url" '/api/admin/users/create' "$admin_token" \
      --data-urlencode "user=$username" \
      --data-urlencode "pass=$password" \
      --data-urlencode "displayName=$username")"
    require_ok "Create user $username" "$response"
  fi

  if [ -n "$groups" ]; then
    response="$(raw_request POST "$base_url" '/api/admin/users/set' "$admin_token" \
      --data-urlencode "user=$username" \
      --data-urlencode "memberOfGroups=$groups")"
    require_ok "Assign groups for $username" "$response"
  fi
}

set_section_permissions() {
  local base_url="$1"
  local admin_token="$2"
  local section="$3"
  local user_permissions="$4"
  local response
  response="$(raw_request POST "$base_url" '/api/admin/permissions/set' "$admin_token" \
    --data-urlencode "section=$section" \
    --data-urlencode "userPermissions=$user_permissions")"
  require_ok "Set $section test permissions" "$response"
}

create_api_token() {
  local base_url="$1"
  local username="$2"
  local password="$3"
  local token_name="$4"
  local response
  response="$(raw_request GET "$base_url" '/api/user/createToken' '' \
    --data-urlencode "user=$username" \
    --data-urlencode "pass=$password" \
    --data-urlencode "tokenName=$token_name")"
  require_ok "Create API token for $username" "$response"
  jq -er '.token // .response.token' <<<"$response"
}

wait_for_owned_token() {
  local label="$1"
  local base_url="$2"
  local token="$3"
  local expected_user="$4"
  local expected_domain="$5"
  local attempt response

  attempt=0
  while [ "$attempt" -lt 90 ]; do
    attempt=$((attempt + 1))
    response="$(session_info "$base_url" "$token" 2>/dev/null || true)"
    if jq -e \
      --arg user "$expected_user" \
      --arg domain "$expected_domain" \
      '(.response // .) | .status == "ok" and .username == $user and .info.clusterDomain == $domain' \
      >/dev/null 2>&1 <<<"$response"; then
      return
    fi
    sleep 2
  done
  fail "$label did not validate the expected replicated token owner"
}

provision_site_credentials() {
  local site_suffix="$1"
  local cluster_domain="$2"
  local primary_url="$3"
  local secondary_url="$4"
  local admin_password="$5"
  local account_password="$6"

  local operator_user="operator-$site_suffix"
  local background_user="background-$site_suffix"
  local schedule_user="schedule-$site_suffix"
  local admin_token
  admin_token="$(login_admin "$primary_url" "$admin_password")"

  ensure_user "$primary_url" "$admin_token" "$operator_user" "$account_password" 'DNS Administrators'
  ensure_user "$primary_url" "$admin_token" "$background_user" "$account_password" ''
  ensure_user "$primary_url" "$admin_token" "$schedule_user" "$account_password" ''

  set_section_permissions "$primary_url" "$admin_token" DnsClient \
    "$operator_user|true|false|false|$background_user|true|false|false"
  set_section_permissions "$primary_url" "$admin_token" DhcpServer \
    "$operator_user|true|false|false|$background_user|true|false|false"
  set_section_permissions "$primary_url" "$admin_token" Apps \
    "$operator_user|true|true|false|$schedule_user|true|true|false"
  set_section_permissions "$primary_url" "$admin_token" Cache \
    "$operator_user|true|false|true|$schedule_user|true|false|true"

  local token_suffix
  token_suffix="$(date +%s)"
  provisioned_operator_token="$(create_api_token "$primary_url" "$operator_user" "$account_password" "companion-operator-$token_suffix")"
  provisioned_background_token="$(create_api_token "$primary_url" "$background_user" "$account_password" "companion-background-$token_suffix")"
  provisioned_schedule_token="$(create_api_token "$primary_url" "$schedule_user" "$account_password" "companion-schedule-$token_suffix")"

  wait_for_owned_token "$operator_user on Primary" "$primary_url" "$provisioned_operator_token" "$operator_user" "$cluster_domain"
  wait_for_owned_token "$operator_user on Secondary" "$secondary_url" "$provisioned_operator_token" "$operator_user" "$cluster_domain"
  wait_for_owned_token "$background_user on Secondary" "$secondary_url" "$provisioned_background_token" "$background_user" "$cluster_domain"
  wait_for_owned_token "$schedule_user on Secondary" "$secondary_url" "$provisioned_schedule_token" "$schedule_user" "$cluster_domain"
  log "Provisioned identity-bound operator and automation credentials for $cluster_domain"
}

write_credential_maps() {
  local site_a_operator_token="$1"
  local site_b_operator_token="$2"
  local site_a_background_token="$3"
  local site_b_background_token="$4"
  local site_a_schedule_token="$5"
  local site_b_schedule_token="$6"

  # The single-quoted JavaScript intentionally owns its template expression.
  # shellcheck disable=SC2016
  printf '%s\0%s\0%s\0%s\0%s\0%s\0' \
    "$site_a_operator_token" \
    "$site_b_operator_token" \
    "$site_a_background_token" \
    "$site_b_background_token" \
    "$site_a_schedule_token" \
    "$site_b_schedule_token" |
    node -e '
const fs = require("node:fs");
const values = fs.readFileSync(0, "utf8").split("\0");
const [operatorA, operatorB, backgroundA, backgroundB, scheduleA, scheduleB] = values;
const [ssoPath, backgroundPath, schedulePath] = process.argv.slice(1);
const write = (path, value) => {
  const temporaryPath = `${path}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, path);
};
write(ssoPath, {
  version: 2,
  identities: {
    "operator@example.test": {
      groups: {
        "site-a": { username: "operator-a", token: operatorA },
        "site-b": { username: "operator-b", token: operatorB },
      },
    },
    "site-a-only@example.test": {
      groups: {
        "site-a": { username: "operator-a", token: operatorA },
      },
    },
    "partial-failure@example.test": {
      groups: {
        "site-a": { username: "operator-a", token: operatorA },
        "site-b": { username: "operator-b", token: operatorA },
      },
    },
  },
});
write(backgroundPath, {
  version: 1,
  groups: {
    "site-a": { username: "background-a", token: backgroundA },
    "site-b": { username: "background-b", token: backgroundB },
  },
});
write(schedulePath, {
  version: 1,
  groups: {
    "site-a": { username: "schedule-a", token: scheduleA },
    "site-b": { username: "schedule-b", token: scheduleB },
  },
});
' \
      "$ASSET_DIR/trusted-sso-token-map.json" \
      "$ASSET_DIR/background-token-map.json" \
      "$ASSET_DIR/schedule-token-map.json"
  chmod 600 \
    "$ASSET_DIR/trusted-sso-token-map.json" \
    "$ASSET_DIR/background-token-map.json" \
    "$ASSET_DIR/schedule-token-map.json"
}

if [ "$RESET" = true ]; then
  log "Resetting only the multi-cluster test project"
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
fi

prepare_assets

log "Validating the isolated Compose model"
compose config --quiet

log "Starting four Technitium DNS nodes"
compose up -d site-a-primary site-a-secondary site-b-primary site-b-secondary
wait_for_api 'Site A Primary' "$SITE_A_PRIMARY_URL"
wait_for_api 'Site A Secondary' "$SITE_A_SECONDARY_URL"
wait_for_api 'Site B Primary' "$SITE_B_PRIMARY_URL"
wait_for_api 'Site B Secondary' "$SITE_B_SECONDARY_URL"

IFS= read -r admin_password <"$ASSET_DIR/node-admin-password"
IFS= read -r account_password <"$ASSET_DIR/account-password"

ensure_cluster \
  'Site A' \
  'site-a.test' \
  "$SITE_A_PRIMARY_URL" \
  "$SITE_A_PRIMARY_HTTPS_URL" \
  'https://site-a-primary:53443/' \
  '172.30.111.10' \
  "$SITE_A_SECONDARY_URL" \
  '172.30.111.11' \
  "$admin_password"
ensure_cluster \
  'Site B' \
  'site-b.test' \
  "$SITE_B_PRIMARY_URL" \
  "$SITE_B_PRIMARY_HTTPS_URL" \
  'https://site-b-primary:53443/' \
  '172.30.112.10' \
  "$SITE_B_SECONDARY_URL" \
  '172.30.112.11' \
  "$admin_password"

provision_site_credentials \
  a site-a.test "$SITE_A_PRIMARY_URL" "$SITE_A_SECONDARY_URL" \
  "$admin_password" "$account_password"
site_a_operator_token="$provisioned_operator_token"
site_a_background_token="$provisioned_background_token"
site_a_schedule_token="$provisioned_schedule_token"

provision_site_credentials \
  b site-b.test "$SITE_B_PRIMARY_URL" "$SITE_B_SECONDARY_URL" \
  "$admin_password" "$account_password"
site_b_operator_token="$provisioned_operator_token"
site_b_background_token="$provisioned_background_token"
site_b_schedule_token="$provisioned_schedule_token"

write_credential_maps \
  "$site_a_operator_token" \
  "$site_b_operator_token" \
  "$site_a_background_token" \
  "$site_b_background_token" \
  "$site_a_schedule_token" \
  "$site_b_schedule_token"

unset \
  account_password \
  admin_password \
  provisioned_background_token \
  provisioned_operator_token \
  provisioned_schedule_token \
  site_a_background_token \
  site_a_operator_token \
  site_a_schedule_token \
  site_b_background_token \
  site_b_operator_token \
  site_b_schedule_token

log "Building Companion from the current worktree"
compose build technitium-dns-companion-test
log "Starting Companion and the trusted SSO proxy"
compose up -d technitium-dns-companion-test trusted-sso-test-proxy

MULTI_CLUSTER_TEST_ASSET_DIR="$ASSET_DIR" \
MULTI_CLUSTER_TEST_COMPOSE_FILE="$COMPOSE_FILE" \
MULTI_CLUSTER_TEST_COMPOSE_PROJECT="$COMPOSE_PROJECT" \
  "$VERIFY_SCRIPT"

trap - ERR

if [ "$CLEANUP" = true ]; then
  log "Acceptance passed; removing this harness's containers and named volumes"
  compose down --volumes --remove-orphans
else
  log "Acceptance passed. The isolated stack remains available for inspection."
  log "Proxy URL: https://127.0.0.1:${MULTI_CLUSTER_PROXY_HTTPS_PORT:-15443}"
  log "Browser identity: operator@example.test"
  log "The generated browser password is stored in .multi-cluster-sso-test/browser-password."
  log "Teardown: docker compose --project-name $COMPOSE_PROJECT -f docker-compose.multi-cluster-sso-test.yml down --volumes --remove-orphans"
fi
