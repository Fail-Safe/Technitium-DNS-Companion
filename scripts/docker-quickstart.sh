#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=${ENV_FILE:-technitium.env}
IMAGE=${IMAGE:-ghcr.io/fail-safe/technitium-dns-companion:latest}
VOLUME_NAME=${VOLUME_NAME:-technitium-dns-companion-data}
HTTP_PORT=${HTTP_PORT:-3000}
HTTPS_PORT=${HTTPS_PORT:-3443}
NEW_ENV=0

need_cmd() {
	if ! command -v "$1" >/dev/null 2>&1; then
		printf '❌ Missing required command: %s\n' "$1" >&2
		exit 1
	fi
}

# Ensure Docker is available and daemon reachable
need_cmd docker
if ! docker info >/dev/null 2>&1; then
	printf '❌ Docker daemon is not running or not accessible. Start Docker and retry.\n' >&2
	exit 1
fi

# Ensure curl or wget for fetching env template
FETCHER=""
if command -v curl >/dev/null 2>&1; then
	FETCHER="curl -fsSL"
elif command -v wget >/dev/null 2>&1; then
	FETCHER="wget -qO-"
else
	printf '❌ Neither curl nor wget is installed. Install one to continue.\n' >&2
	exit 1
fi

# Fetch env template if missing
if [ ! -f "$ENV_FILE" ]; then
	printf '📥 Downloading .env example to %s...\n' "$ENV_FILE"
	$FETCHER https://raw.githubusercontent.com/Fail-Safe/Technitium-DNS-Companion/main/.env.example >"$ENV_FILE"
	printf '✅ Created %s. Please edit it with your Technitium node URLs/tokens before continuing.\n' "$ENV_FILE"
	NEW_ENV=1
else
	printf 'ℹ️ Using existing env file: %s\n' "$ENV_FILE"
fi

printf '\nNext steps:\n'
printf '1) Edit %s and set TECHNITIUM_NODES plus *_BASE_URL and tokens.\n' "$ENV_FILE"
printf '2) After saving your technitium.env file, run:\n\n'
printf '   docker run --rm -p %s:3000 -p %s:3443 \\\n' "$HTTP_PORT" "$HTTPS_PORT"
printf '\t --env-file %s \\\n' "$ENV_FILE"
printf '\t -v %s:/data \\\n' "$VOLUME_NAME"
printf '\t %s\n\n' "$IMAGE"

if [ "$NEW_ENV" -eq 1 ]; then
	printf '✏️  Edit %s, then rerun this script to start the container.\n' "$ENV_FILE"
	exit 0
fi

printf 'Press Enter to run it now, or Ctrl+C to cancel.\n'
read -r

printf '🚀 Starting container...\n'
docker run --rm -p "${HTTP_PORT}:3000" -p "${HTTPS_PORT}:3443" \
	--env-file "$ENV_FILE" \
	-v "${VOLUME_NAME}:/data" \
	"$IMAGE"
