#!/bin/bash
#
# Test script for cluster node matching
# Simulates a user's setup where node names don't match cluster hostnames
# and baseURLs use IP addresses instead of hostnames
#
# Usage:
#   ./scripts/test-cluster-matching.sh setup    # Add test hosts entries
#   ./scripts/test-cluster-matching.sh run      # Run backend with test config
#   ./scripts/test-cluster-matching.sh cleanup  # Remove test hosts entries
#   ./scripts/test-cluster-matching.sh status   # Check current setup
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TEST_ENV_FILE="$PROJECT_ROOT/technitium-test.env"
HOSTS_MARKER="# TECHNITIUM-DNS-COMPANION-TEST"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
success() { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
error() { echo -e "${RED}❌ $1${NC}"; }

# Check if test entries exist in /etc/hosts
check_hosts_entries() {
	grep -q "$HOSTS_MARKER" /etc/hosts 2>/dev/null
}

# Get current Technitium node IPs from the user's actual config
get_node_ips() {
	if [[ -f "$PROJECT_ROOT/.env" ]]; then
		PRIMARY_IP=$(grep -E "^TECHNITIUM_.*_BASE_URL=" "$PROJECT_ROOT/.env" | head -1 | sed -E 's/.*https?:\/\/([^:\/]+).*/\1/')
		SECONDARY_IP=$(grep -E "^TECHNITIUM_.*_BASE_URL=" "$PROJECT_ROOT/.env" | tail -1 | sed -E 's/.*https?:\/\/([^:\/]+).*/\1/')
	fi

	# Fallback to prompting
	if [[ -z "$PRIMARY_IP" ]] || [[ "$PRIMARY_IP" == *"BASE_URL"* ]]; then
		read -p "Enter PRIMARY node IP address: " PRIMARY_IP
	fi
	if [[ -z "$SECONDARY_IP" ]] || [[ "$SECONDARY_IP" == *"BASE_URL"* ]]; then
		read -p "Enter SECONDARY node IP address: " SECONDARY_IP
	fi
}

# Get the cluster token
get_cluster_token() {
	if [[ -f "$PROJECT_ROOT/.env" ]]; then
		CLUSTER_TOKEN=$(grep -E "^TECHNITIUM_CLUSTER_TOKEN=" "$PROJECT_ROOT/.env" | cut -d'=' -f2-)
		if [[ -z "$CLUSTER_TOKEN" ]]; then
			# Try to get any node token
			CLUSTER_TOKEN=$(grep -E "^TECHNITIUM_.*_TOKEN=" "$PROJECT_ROOT/.env" | head -1 | cut -d'=' -f2-)
		fi
	fi

	if [[ -z "$CLUSTER_TOKEN" ]]; then
		read -p "Enter cluster/admin token: " CLUSTER_TOKEN
	fi
}

setup() {
	info "Setting up test environment for cluster matching..."

	# Check if already set up
	if check_hosts_entries; then
		warn "Test hosts entries already exist. Run 'cleanup' first if you want to reconfigure."
		return 1
	fi

	get_node_ips
	get_cluster_token

	echo ""
	info "Configuration:"
	echo "  Primary IP:   $PRIMARY_IP"
	echo "  Secondary IP: $SECONDARY_IP"
	echo "  Token:        ${CLUSTER_TOKEN:0:10}..."
	echo ""

	# Add hosts entries
	info "Adding test entries to /etc/hosts (requires sudo)..."

	HOSTS_ENTRIES="
$HOSTS_MARKER - START (DO NOT EDIT THIS BLOCK)
# Simulates cluster node hostnames for testing
$PRIMARY_IP    ns1.test.local
$SECONDARY_IP  ns2.test.local
$HOSTS_MARKER - END
"

	echo "$HOSTS_ENTRIES" | sudo tee -a /etc/hosts >/dev/null
	success "Added hosts entries"

	# Verify DNS resolution
	info "Verifying DNS resolution..."
	if ping -c 1 -t 1 ns1.test.local >/dev/null 2>&1; then
		success "ns1.test.local resolves to $PRIMARY_IP"
	else
		warn "ns1.test.local may not resolve correctly"
	fi

	if ping -c 1 -t 1 ns2.test.local >/dev/null 2>&1; then
		success "ns2.test.local resolves to $SECONDARY_IP"
	else
		warn "ns2.test.local may not resolve correctly"
	fi

	# Create test env file
	info "Creating test environment file..."

	cat >"$TEST_ENV_FILE" <<EOF
###########################################################################
# TEST CONFIGURATION - Simulates user setup for cluster matching testing
#
# This config mimics a user who:
# 1. Uses arbitrary node names (zed, kal) that don't match cluster hostnames
# 2. Uses IP addresses in BASE_URL instead of hostnames
# 3. Has a cluster where nodes are named ns1.test.local, ns2.test.local
###########################################################################

# Node names that DON'T match Technitium cluster node names
TECHNITIUM_NODES=zed,kal

# Shared cluster token
TECHNITIUM_CLUSTER_TOKEN=$CLUSTER_TOKEN

# Base URLs using IP addresses (the challenge case)
TECHNITIUM_ZED_BASE_URL=http://$PRIMARY_IP:5380
TECHNITIUM_KAL_BASE_URL=http://$SECONDARY_IP:5380

# Enable debug logging
LOG_LEVEL=debug
EOF

	success "Created $TEST_ENV_FILE"

	echo ""
	success "Setup complete! Run './scripts/test-cluster-matching.sh run' to test."
	echo ""
	info "What to look for in logs:"
	echo "  - 'Cluster detected: ... with 2 nodes'"
	echo "  - 'Cluster node: name=\"...\"' entries"
	echo "  - 'DNS match: ... matches baseUrl IP ...'"
	echo "  - 'Mapping node zed: found cluster node ..., type: Primary'"
	echo "  - 'Mapping node kal: found cluster node ..., type: Secondary'"
}

run() {
	if [[ ! -f "$TEST_ENV_FILE" ]]; then
		error "Test environment not set up. Run './scripts/test-cluster-matching.sh setup' first."
		return 1
	fi

	info "Starting backend with test configuration..."
	echo ""
	warn "Watch for cluster matching logs below:"
	echo "----------------------------------------"
	echo ""

	BACKEND_DIR="$PROJECT_ROOT/apps/backend"

	# Backup existing .env if present
	if [[ -f "$BACKEND_DIR/.env" ]]; then
		cp "$BACKEND_DIR/.env" "$BACKEND_DIR/.env.backup"
		info "Backed up existing .env to .env.backup"
	fi

	# Copy test env and add local cache dir
	cp "$TEST_ENV_FILE" "$BACKEND_DIR/.env"
	echo "CACHE_DIR=$PROJECT_ROOT/.cache/domain-lists" >>"$BACKEND_DIR/.env"

	# Create local cache dir
	mkdir -p "$PROJECT_ROOT/.cache/domain-lists"

	# Build first
	info "Building backend..."
	(cd "$BACKEND_DIR" && npm run build)

	# Run with trap to restore on exit
	trap 'restore_env' EXIT INT TERM

	# Run the compiled app directly (more reliable than nest start --watch)
	info "Starting application..."
	(cd "$BACKEND_DIR" && node dist/main.js)
}

restore_env() {
	cd "$PROJECT_ROOT/apps/backend"
	if [[ -f .env.backup ]]; then
		mv .env.backup .env
		info "Restored original .env"
	else
		rm -f .env
	fi
}

cleanup() {
	info "Cleaning up test environment..."

	# Remove hosts entries
	if check_hosts_entries; then
		info "Removing test entries from /etc/hosts (requires sudo)..."
		sudo sed -i '' "/$HOSTS_MARKER/,/$HOSTS_MARKER/d" /etc/hosts
		success "Removed hosts entries"
	else
		info "No test hosts entries found"
	fi

	# Remove test env file
	if [[ -f "$TEST_ENV_FILE" ]]; then
		rm "$TEST_ENV_FILE"
		success "Removed test environment file"
	fi

	# Restore backend .env if backup exists
	if [[ -f "$PROJECT_ROOT/apps/backend/.env.backup" ]]; then
		mv "$PROJECT_ROOT/apps/backend/.env.backup" "$PROJECT_ROOT/apps/backend/.env"
		success "Restored original backend .env"
	fi

	success "Cleanup complete!"
}

status() {
	echo ""
	info "Test Environment Status"
	echo "========================"
	echo ""

	# Check hosts entries
	if check_hosts_entries; then
		success "Hosts entries: CONFIGURED"
		echo "  Current entries:"
		grep -A 3 "$HOSTS_MARKER - START" /etc/hosts 2>/dev/null | grep -v "$HOSTS_MARKER" | sed 's/^/    /'
	else
		warn "Hosts entries: NOT CONFIGURED"
	fi
	echo ""

	# Check test env file
	if [[ -f "$TEST_ENV_FILE" ]]; then
		success "Test env file: EXISTS"
		echo "  Location: $TEST_ENV_FILE"
		echo "  Nodes configured:"
		grep -E "^TECHNITIUM_(NODES|.*_BASE_URL)=" "$TEST_ENV_FILE" | sed 's/^/    /'
	else
		warn "Test env file: NOT FOUND"
	fi
	echo ""

	# Check DNS resolution
	info "DNS Resolution Test:"
	for host in ns1.test.local ns2.test.local; do
		if resolved_ip=$(dig +short "$host" 2>/dev/null | head -1); then
			if [[ -n "$resolved_ip" ]]; then
				success "  $host → $resolved_ip"
			else
				warn "  $host → (not resolving)"
			fi
		else
			warn "  $host → (dig command failed)"
		fi
	done
	echo ""
}

# Main
case "${1:-}" in
setup)
	setup
	;;
run)
	run
	;;
cleanup)
	cleanup
	;;
status)
	status
	;;
*)
	echo "Usage: $0 {setup|run|cleanup|status}"
	echo ""
	echo "Commands:"
	echo "  setup    - Configure /etc/hosts and create test env file"
	echo "  run      - Start backend with test configuration"
	echo "  cleanup  - Remove test entries and restore original config"
	echo "  status   - Show current test environment status"
	exit 1
	;;
esac
