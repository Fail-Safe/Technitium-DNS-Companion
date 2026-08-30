#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ASSET_DIR="${MULTI_CLUSTER_TEST_ASSET_DIR:-$PROJECT_ROOT/.multi-cluster-sso-test}"
COMPOSE_FILE="${MULTI_CLUSTER_TEST_COMPOSE_FILE:-$PROJECT_ROOT/docker-compose.multi-cluster-sso-test.yml}"
COMPOSE_PROJECT="${MULTI_CLUSTER_TEST_COMPOSE_PROJECT:-technitium-companion-multi-cluster-sso-test}"
COMPANION_URL="http://127.0.0.1:${MULTI_CLUSTER_COMPANION_HTTP_PORT:-15300}"
PROXY_URL="https://127.0.0.1:${MULTI_CLUSTER_PROXY_HTTPS_PORT:-15443}"
SITE_A_PRIMARY_URL="http://127.0.0.1:${SITE_A_PRIMARY_HTTP_PORT:-15380}"
SITE_A_SECONDARY_URL="http://127.0.0.1:${SITE_A_SECONDARY_HTTP_PORT:-15381}"
SITE_B_PRIMARY_URL="http://127.0.0.1:${SITE_B_PRIMARY_HTTP_PORT:-15382}"
SITE_B_SECONDARY_URL="http://127.0.0.1:${SITE_B_SECONDARY_HTTP_PORT:-15383}"

for command_name in curl docker jq mktemp; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
done

for required_file in \
  "$ASSET_DIR/browser-password" \
  "$ASSET_DIR/trusted-sso-token-map.json"; do
  if [ ! -s "$required_file" ]; then
    echo "Required generated test asset is missing: $required_file" >&2
    exit 1
  fi
done

compose() {
  docker compose --project-name "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" "$@"
}

log() {
  printf '[multi-cluster-sso:verify] %s\n' "$*" >&2
}

fail() {
  log "ERROR: $*"
  exit 1
}

REQUEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tdc-multi-cluster-sso.XXXXXX")"
chmod 700 "$REQUEST_DIR"
fault_injection_active=false

cleanup() {
  if [ "$fault_injection_active" = true ]; then
    compose start site-b-primary site-b-secondary >/dev/null 2>&1 || true
  fi
  rm -rf "$REQUEST_DIR"
}
trap cleanup EXIT INT TERM

IFS= read -r browser_password <"$ASSET_DIR/browser-password"

write_basic_auth_config() {
  local identity="$1"
  local path="$2"
  printf 'user = "%s:%s"\n' "$identity" "$browser_password" >"$path"
  chmod 600 "$path"
}

write_basic_auth_config 'operator@example.test' "$REQUEST_DIR/operator.curl"
write_basic_auth_config 'site-a-only@example.test' "$REQUEST_DIR/site-a-only.curl"
write_basic_auth_config 'partial-failure@example.test' "$REQUEST_DIR/partial-failure.curl"
unset browser_password

proxy_request() {
  local config_path="$1"
  local cookie_path="$2"
  local method="$3"
  local path="$4"
  curl \
    --config "$config_path" \
    --cookie "$cookie_path" \
    --cookie-jar "$cookie_path" \
    --fail \
    --insecure \
    --silent \
    --show-error \
    --max-time 90 \
    --request "$method" \
    "$PROXY_URL$path"
}

assert_filter() {
  local label="$1"
  local filter="$2"
  local document="$3"
  if ! jq -e "$filter" >/dev/null 2>&1 <<<"$document"; then
    fail "$label"
  fi
}

wait_for_http_json() {
  local label="$1"
  local url="$2"
  local filter="$3"
  local attempt response
  for attempt in $(seq 1 90); do
    response="$(curl --silent --show-error --max-time 5 "$url" 2>/dev/null || true)"
    if jq -e "$filter" >/dev/null 2>&1 <<<"$response"; then
      return
    fi
    sleep 2
  done
  fail "$label did not become ready"
}

wait_for_proxy() {
  local attempt
  for attempt in $(seq 1 90); do
    if proxy_request \
      "$REQUEST_DIR/operator.curl" \
      "$REQUEST_DIR/proxy-ready.cookie" \
      GET \
      '/api/auth/me' \
      >/dev/null 2>&1; then
      return
    fi
    sleep 2
  done
  fail "Trusted SSO proxy did not become ready"
}

login_and_get_session() {
  local config_path="$1"
  local cookie_path="$2"
  local login_response
  rm -f "$cookie_path"
  login_response="$(proxy_request "$config_path" "$cookie_path" POST '/api/auth/sso/login')"
  assert_filter 'Trusted SSO login did not authenticate' '.authenticated == true' "$login_response"
  proxy_request "$config_path" "$cookie_path" GET '/api/auth/me'
}

wait_for_automation_ready() {
  local cookie_path="$1"
  local attempt auth_me schedule_status
  for attempt in $(seq 1 60); do
    auth_me="$(proxy_request "$REQUEST_DIR/operator.curl" "$cookie_path" GET '/api/auth/me')"
    schedule_status="$(proxy_request "$REQUEST_DIR/operator.curl" "$cookie_path" GET '/api/nodes/dns-schedules/token/status')"
    if jq -e \
      '.backgroundPtrToken.groups.anyReady == true and .backgroundPtrToken.groups.allReady == true and ([.backgroundPtrToken.groups.groups[].state] | all(. == "ready"))' \
      >/dev/null 2>&1 <<<"$auth_me" &&
      jq -e \
        '.groups.anyReady == true and .groups.allReady == true and ([.groups.groups[].state] | all(. == "ready"))' \
        >/dev/null 2>&1 <<<"$schedule_status"; then
      return
    fi
    sleep 2
  done
  fail "Per-group background and schedule credentials did not become ready"
}

write_bearer_config() {
  local token="$1"
  local path="$2"
  printf 'header = "Authorization: Bearer %s"\n' "$token" >"$path"
  chmod 600 "$path"
}

technitium_session_info() {
  local config_path="$1"
  local base_url="$2"
  curl \
    --config "$config_path" \
    --fail \
    --silent \
    --show-error \
    --max-time 30 \
    "$base_url/api/user/session/get"
}

verify_real_cluster_token() {
  local label="$1"
  local config_path="$2"
  local base_url="$3"
  local expected_user="$4"
  local expected_domain="$5"
  local response
  response="$(technitium_session_info "$config_path" "$base_url")"
  if ! jq -e \
    --arg user "$expected_user" \
    --arg domain "$expected_domain" \
    '(.response // .) | .status == "ok" and .username == $user and .info.clusterInitialized == true and .info.clusterDomain == $domain and ([.info.clusterNodes[]?.type] | index("Primary") != null) and ([.info.clusterNodes[]?.type] | index("Secondary") != null)' \
    >/dev/null 2>&1 <<<"$response"; then
    fail "$label did not report the expected owner and two-node cluster"
  fi
}

wait_for_http_json 'Companion' "$COMPANION_URL/api/health" '.status == "ok"'
wait_for_proxy

log 'Verifying that direct forged headers cannot establish SSO'
direct_response="$(curl \
  --fail \
  --silent \
  --show-error \
  --header 'X-Forwarded-Proto: https' \
  --header 'X-Forwarded-User: operator@example.test' \
  "$COMPANION_URL/api/auth/me")"
assert_filter \
  'Direct assertion spoof unexpectedly authenticated' \
  '.authenticated == false' \
  "$direct_response"

site_a_token="$(jq -er '.identities["operator@example.test"].groups["site-a"].token' "$ASSET_DIR/trusted-sso-token-map.json")"
site_b_token="$(jq -er '.identities["operator@example.test"].groups["site-b"].token' "$ASSET_DIR/trusted-sso-token-map.json")"
write_bearer_config "$site_a_token" "$REQUEST_DIR/site-a-token.curl"
write_bearer_config "$site_b_token" "$REQUEST_DIR/site-b-token.curl"
unset site_a_token site_b_token

log 'Verifying two genuine, independent Primary/Secondary clusters'
verify_real_cluster_token 'Site A Primary' "$REQUEST_DIR/site-a-token.curl" "$SITE_A_PRIMARY_URL" operator-a site-a.test
verify_real_cluster_token 'Site A Secondary' "$REQUEST_DIR/site-a-token.curl" "$SITE_A_SECONDARY_URL" operator-a site-a.test
verify_real_cluster_token 'Site B Primary' "$REQUEST_DIR/site-b-token.curl" "$SITE_B_PRIMARY_URL" operator-b site-b.test
verify_real_cluster_token 'Site B Secondary' "$REQUEST_DIR/site-b-token.curl" "$SITE_B_SECONDARY_URL" operator-b site-b.test

cross_group_response="$(technitium_session_info "$REQUEST_DIR/site-a-token.curl" "$SITE_B_PRIMARY_URL")"
assert_filter \
  'Site A token was unexpectedly accepted by Site B' \
  '.status == "invalid-token"' \
  "$cross_group_response"
cross_group_response="$(technitium_session_info "$REQUEST_DIR/site-b-token.curl" "$SITE_A_PRIMARY_URL")"
assert_filter \
  'Site B token was unexpectedly accepted by Site A' \
  '.status == "invalid-token"' \
  "$cross_group_response"

log 'Verifying the fully authorized identity and group-local admissions'
operator_cookie="$REQUEST_DIR/operator.cookie"
operator_me="$(login_and_get_session "$REQUEST_DIR/operator.curl" "$operator_cookie")"
assert_filter \
  'Fully authorized identity did not report both verified usernames' \
  '.authenticated == true and .authSource == "trusted-sso" and .verifiedUsernamesByGroup == {"site-a":"operator-a","site-b":"operator-b"}' \
  "$operator_me"
assert_filter \
  'Fully authorized identity did not report every group ready' \
  '.groupCredentials.anyReady == true and .groupCredentials.allReady == true and ([.groupCredentials.groups[].state] | all(. == "ready"))' \
  "$operator_me"
assert_filter \
  'Interactive admission crossed or omitted a group boundary' \
  '(.groupCredentials.groups[] | select(.groupId == "site-a") | .admittedNodeIds.interactive | sort) == ["site-a-primary","site-a-secondary"] and (.groupCredentials.groups[] | select(.groupId == "site-b") | .admittedNodeIds.interactive | sort) == ["site-b-primary","site-b-secondary"]' \
  "$operator_me"
assert_filter \
  'Primary write admission was not limited to one Primary per group' \
  '(.groupCredentials.groups[] | select(.groupId == "site-a") | .admittedNodeIds.primaryConfigWrite) == ["site-a-primary"] and (.groupCredentials.groups[] | select(.groupId == "site-b") | .admittedNodeIds.primaryConfigWrite) == ["site-b-primary"]' \
  "$operator_me"

nodes_response="$(proxy_request "$REQUEST_DIR/operator.curl" "$operator_cookie" GET '/api/nodes')"
assert_filter \
  'Companion did not expose four correctly grouped nodes' \
  'length == 4 and (map(select(.groupId == "site-a")) | length) == 2 and (map(select(.groupId == "site-b")) | length) == 2' \
  "$nodes_response"
assert_filter \
  'Companion did not resolve one Primary in each independent group' \
  '([.[] | select(.groupId == "site-a" and .isPrimary == true)] | length) == 1 and ([.[] | select(.groupId == "site-b" and .isPrimary == true)] | length) == 1' \
  "$nodes_response"
wait_for_automation_ready "$operator_cookie"

log 'Verifying an identity authorized for only one group'
subset_me="$(login_and_get_session "$REQUEST_DIR/site-a-only.curl" "$REQUEST_DIR/site-a-only.cookie")"
assert_filter \
  'Not-authorized group incorrectly invalidated the session' \
  '.authenticated == true and .groupCredentials.anyReady == true and .groupCredentials.allReady == true and (.groupCredentials.groups[] | select(.groupId == "site-b") | .state) == "not-authorized"' \
  "$subset_me"

log 'Verifying that a hard credential failure remains isolated to its group'
partial_me="$(login_and_get_session "$REQUEST_DIR/partial-failure.curl" "$REQUEST_DIR/partial-failure.cookie")"
assert_filter \
  'Site B credential failure leaked into Site A or killed the session' \
  '.authenticated == true and .groupCredentials.anyReady == true and .groupCredentials.allReady == false and (.groupCredentials.groups[] | select(.groupId == "site-a") | .state) == "ready" and (.groupCredentials.groups[] | select(.groupId == "site-b") | .state) == "failed"' \
  "$partial_me"

fault_injection_active=true
log 'Stopping the Site B Primary and verifying degraded read-only survival'
compose stop site-b-primary >/dev/null
degraded_cookie="$REQUEST_DIR/degraded.cookie"
degraded_me="$(login_and_get_session "$REQUEST_DIR/operator.curl" "$degraded_cookie")"
assert_filter \
  'Offline Site B Primary did not produce an isolated degraded group' \
  '.authenticated == true and (.groupCredentials.groups[] | select(.groupId == "site-a") | .state) == "ready" and (.groupCredentials.groups[] | select(.groupId == "site-b") | .state) == "degraded"' \
  "$degraded_me"
assert_filter \
  'Offline Site B Primary remained admitted for writes or cache flushes' \
  '(.groupCredentials.groups[] | select(.groupId == "site-b") | .admittedNodeIds.primaryConfigWrite) == [] and (.groupCredentials.groups[] | select(.groupId == "site-b") | .admittedNodeIds.cacheFlush) == ["site-b-secondary"]' \
  "$degraded_me"

log 'Restarting the Site B Primary and verifying admission only after revalidation'
compose start site-b-primary >/dev/null
wait_for_http_json 'Site B Primary' "$SITE_B_PRIMARY_URL/api/status" '.status == "ok"'
recovered=false
attempt=0
while [ "$attempt" -lt 45 ]; do
  attempt=$((attempt + 1))
  proxy_request "$REQUEST_DIR/operator.curl" "$degraded_cookie" GET '/api/nodes' >/dev/null 2>&1 || true
  recovered_me="$(proxy_request "$REQUEST_DIR/operator.curl" "$degraded_cookie" GET '/api/auth/me')"
  if jq -e \
    '(.groupCredentials.groups[] | select(.groupId == "site-b") | .state) == "ready" and (.groupCredentials.groups[] | select(.groupId == "site-b") | .admittedNodeIds.primaryConfigWrite) == ["site-b-primary"]' \
    >/dev/null 2>&1 <<<"$recovered_me"; then
    recovered=true
    break
  fi
  sleep 2
done
if [ "$recovered" != true ]; then
  fail 'Returning Site B Primary was not safely readmitted'
fi

log 'Stopping all Site B nodes and verifying Site A keeps the session usable'
compose stop site-b-primary site-b-secondary >/dev/null
isolated_me="$(login_and_get_session "$REQUEST_DIR/operator.curl" "$REQUEST_DIR/site-b-down.cookie")"
assert_filter \
  'Complete Site B failure leaked into Site A or killed the session' \
  '.authenticated == true and .groupCredentials.anyReady == true and .groupCredentials.allReady == false and (.groupCredentials.groups[] | select(.groupId == "site-a") | .state) == "ready" and (.groupCredentials.groups[] | select(.groupId == "site-b") | .state) == "unreachable"' \
  "$isolated_me"

compose start site-b-primary site-b-secondary >/dev/null
wait_for_http_json 'Site B Primary' "$SITE_B_PRIMARY_URL/api/status" '.status == "ok"'
wait_for_http_json 'Site B Secondary' "$SITE_B_SECONDARY_URL/api/status" '.status == "ok"'
fault_injection_active=false

log 'Rechecking the fully healthy two-group session after fault recovery'
recovered_me="$(login_and_get_session "$REQUEST_DIR/operator.curl" "$REQUEST_DIR/final.cookie")"
assert_filter \
  'Both groups did not return to ready after recovery' \
  '.groupCredentials.anyReady == true and .groupCredentials.allReady == true and ([.groupCredentials.groups[].state] | all(. == "ready"))' \
  "$recovered_me"

log 'PASS: real two-cluster trusted SSO, group isolation, and recovery checks succeeded'
