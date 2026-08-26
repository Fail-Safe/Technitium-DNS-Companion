#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SSO_TEST_DIR="$PROJECT_ROOT/.sso-test"
TOKEN_MAP_PATH="$SSO_TEST_DIR/token-map.json"
PROXY_SECRET_PATH="$SSO_TEST_DIR/proxy-secret"
HTPASSWD_PATH="$SSO_TEST_DIR/htpasswd"
TLS_DIR="$SSO_TEST_DIR/tls"

for command_name in node openssl htpasswd; do
	if ! command -v "$command_name" >/dev/null 2>&1; then
		echo "Required command not found: $command_name" >&2
		exit 1
	fi
done

read_value() {
	local prompt="$1"
	local default_value="${2:-}"
	local result
	if [ -n "$default_value" ]; then
		printf "%s [%s]: " "$prompt" "$default_value" >&2
	else
		printf "%s: " "$prompt" >&2
	fi
	IFS= read -r result
	printf "%s" "${result:-$default_value}"
}

identity="$(read_value "Asserted SSO identity")"
technitium_user="$(read_value "Technitium username" "$identity")"
test_hostname="$(read_value "Test proxy hostname" "localhost")"

identity_pattern='^[A-Za-z0-9][A-Za-z0-9._@+-]{0,254}$'
if [[ ! "$identity" =~ $identity_pattern ]]; then
	echo "The asserted identity does not match Companion's accepted identity format." >&2
	exit 1
fi
if [[ ! "$technitium_user" =~ $identity_pattern ]]; then
	echo "The Technitium username does not match Companion's accepted username format." >&2
	exit 1
fi
if [ -z "$test_hostname" ] || [[ "$test_hostname" == *[[:space:]]* ]]; then
	echo "The test proxy hostname must be a non-empty hostname or IP address." >&2
	exit 1
fi

printf "Technitium cluster API token (input hidden): " >&2
IFS= read -r -s cluster_token
printf "\n" >&2
if [ -z "$cluster_token" ]; then
	echo "The Technitium cluster API token cannot be empty." >&2
	exit 1
fi

umask 077
mkdir -p "$TLS_DIR"

openssl rand -hex 32 >"$PROXY_SECRET_PATH"

# The single-quoted JavaScript program must reach Node without shell expansion.
# shellcheck disable=SC2016
printf '%s\0%s\0%s\0' "$identity" "$technitium_user" "$cluster_token" |
	node -e '
const fs = require("node:fs");
const [identity, username, token] = fs.readFileSync(0, "utf8").split("\0");
const outputPath = process.argv[1];
const document = {
  version: 1,
  identities: { [identity]: { username, token } },
};
fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, {
  mode: 0o600,
});
' "$TOKEN_MAP_PATH"
unset cluster_token

echo "Choose a temporary Basic Auth password for $identity."
htpasswd -cB "$HTPASSWD_PATH" "$identity"

if [[ "$test_hostname" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
	subject_alt_name="IP:$test_hostname,IP:127.0.0.1,DNS:localhost"
else
	subject_alt_name="DNS:$test_hostname,DNS:localhost,IP:127.0.0.1"
fi

openssl req \
	-x509 \
	-newkey rsa:2048 \
	-sha256 \
	-nodes \
	-days 14 \
	-subj "/CN=$test_hostname" \
	-addext "subjectAltName=$subject_alt_name" \
	-keyout "$TLS_DIR/key.pem" \
	-out "$TLS_DIR/cert.pem" \
	>/dev/null 2>&1

chmod 600 "$PROXY_SECRET_PATH" "$TOKEN_MAP_PATH" "$HTPASSWD_PATH" "$TLS_DIR/key.pem"
chmod 644 "$TLS_DIR/cert.pem"

echo
echo "Trusted SSO test assets created in .sso-test/."
echo "No secret or token value was printed."
echo
echo "Validate the Compose model:"
echo "  docker compose -f docker-compose.prod.test.yml -f docker-compose.sso-test.yml config --quiet"
echo
echo "Build and start the test stack:"
echo "  docker build -t technitium-dns-companion:prodtest -f Dockerfile ."
echo "  docker compose -f docker-compose.prod.test.yml -f docker-compose.sso-test.yml up -d"
