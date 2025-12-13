#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=${ENV_FILE:-technitium.env}
IMAGE=${IMAGE:-ghcr.io/fail-safe/technitium-dns-companion:latest}
VOLUME_NAME=${VOLUME_NAME:-technitium-dns-companion-data}
HTTP_PORT=${HTTP_PORT:-3000}
HTTPS_PORT=${HTTPS_PORT:-3443}
NEW_ENV=0

prompt_port() {
	local label="$1"
	local current="$2"
	local input=""

	while true; do
		printf '%s port [%s]: ' "$label" "$current" >&2
		read -r input
		if [ -z "$input" ]; then
			printf '%s\n' "$current"
			return 0
		fi

		if [[ "$input" =~ ^[0-9]+$ ]] && [ "$input" -ge 1 ] && [ "$input" -le 65535 ]; then
			printf '%s\n' "$input"
			return 0
		fi

		printf '❌ Invalid port: %s (must be 1-65535)\n' "$input" >&2
	done
}

need_cmd() {
	if ! command -v "$1" >/dev/null 2>&1; then
		printf '❌ Missing required command: %s\n' "$1" >&2
		exit 1
	fi
}

# Obligatory newline for readability
printf '\n'

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
	printf 'ℹ️  Using existing env file: %s\n' "$ENV_FILE"
fi

if [ "$NEW_ENV" -eq 1 ]; then
	printf '\nNext steps:\n'
	printf '1) Edit %s and set TECHNITIUM_NODES plus *_BASE_URL and tokens.\n' "$ENV_FILE"
	printf '2) After saving your technitium.env file, rerun this script.\n'
	exit 0
fi

# Confirm ports (Enter keeps defaults)
printf '\nPort configuration (press Enter to accept defaults):\n'
HTTP_PORT="$(prompt_port "HTTP" "$HTTP_PORT")"

while true; do
	HTTPS_PORT="$(prompt_port "HTTPS" "$HTTPS_PORT")"
	if [ "$HTTPS_PORT" != "$HTTP_PORT" ]; then
		break
	fi
	printf '❌ HTTPS port must be different from HTTP port (%s)\n' "$HTTP_PORT" >&2
done

printf '\nNext step:\n\n'
printf '   docker run --rm -p %s:3000 -p %s:3443 \\\n' "$HTTP_PORT" "$HTTPS_PORT"
printf '\t --env-file %s \\\n' "$ENV_FILE"
printf '\t -v %s:/data \\\n' "$VOLUME_NAME"
printf '\t %s\n\n' "$IMAGE"

printf 'Press Enter to execute "docker run" now (any other key to cancel).\n'
confirm_key=""
IFS= read -r -s -n 1 confirm_key

# Arrow keys and some special keys send escape sequences (e.g., "\e[A").
# If the first byte is ESC, consume the remaining bytes so they don't leak into the shell.
if [ "$confirm_key" = $'\e' ]; then
	while IFS= read -r -s -t 0 -n 1 _discard; do
		:
	done
fi

if [ -n "$confirm_key" ]; then
	printf '\nCancelled.\n'
	exit 0
fi
printf '\n'

printf '📀 Pulling image: %s\n' "$IMAGE"
if ! docker pull "$IMAGE" >/dev/null 2>&1; then
	printf '⚠️  Could not pull image (continuing). If this is a local image name, this is expected.\n' >&2
fi

printf '\n🚀 Starting container...\n'
docker run --rm -p "${HTTP_PORT}:3000" -p "${HTTPS_PORT}:3443" \
	--env-file "$ENV_FILE" \
	-v "${VOLUME_NAME}:/data" \
	"$IMAGE"
