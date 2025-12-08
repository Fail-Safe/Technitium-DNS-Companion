#!/usr/bin/env bash
# Safe branch prune utility
# Features:
# - Fetch and prune remote-tracking refs
# - Preview local branches tracking deleted remotes
# - Preview local branches merged into the repo's base branch (main/master)
# - Interactive prompt before deletion
# - Options: --apply, --force, --exclude

set -euo pipefail

# Default configuration
DRY_RUN=true
FORCE_DELETE=false
EXCLUDE_LIST="main,master,develop,release" # default protected branches
BASE_BRANCH=""
REMOTE_NAME="origin"
GC_AFTER=false

usage() {
	cat <<EOF
Usage: ${0##*/} [options]

Options:
  --apply           Actually perform deletions. Without this flag the script only previews.
  --force           Force-delete gone branches (-D) if deletion fails.
  --exclude <list>  Comma-separated list of branches to never delete (default: ${EXCLUDE_LIST}).
  --base <branch>   Base branch used for merge checks (default auto-detected: main or master)
  --remote <name>   Remote name to fetch/prune (default: origin)
  --gc              Run git gc --prune=now after operations
  -h, --help        Show this help message
EOF
}

# Parse CLI args
while [[ $# -gt 0 ]]; do
	case "$1" in
	--apply)
		DRY_RUN=false
		shift
		;;
	--force)
		FORCE_DELETE=true
		shift
		;;
	--exclude)
		EXCLUDE_LIST="$2"
		shift 2
		;;
	--base)
		BASE_BRANCH="$2"
		shift 2
		;;
	--remote)
		REMOTE_NAME="$2"
		shift 2
		;;
	--gc)
		GC_AFTER=true
		shift
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		echo "Unknown option: $1"
		usage
		exit 2
		;;
	esac
done

# Colors
RED=$(printf "\033[31m")
GREEN=$(printf "\033[32m")
YELLOW=$(printf "\033[33m")
CYAN=$(printf "\033[36m")
RESET=$(printf "\033[0m")

# Helpers
is_git_repo() {
	git rev-parse --is-inside-work-tree >/dev/null 2>&1
}

join_by() {
	local IFS="$1"
	shift
	echo "$*"
}

protect_set() {
	# returns newline-separated list of protected branches
	local IFS=','
	for b in ${EXCLUDE_LIST}; do printf "%s\n" "$b"; done
}

# Ensure in a git repo
if ! is_git_repo; then
	echo "${RED}Error:${RESET} This script must be run inside a Git repository." >&2
	exit 2
fi

# Detect base branch if not provided (prefer main -> master)
detect_base_branch() {
	if [[ -n "$BASE_BRANCH" ]]; then
		echo "$BASE_BRANCH"
		return
	fi

	if git show-ref --verify --quiet refs/heads/main; then
		echo "main"
	elif git show-ref --verify --quiet refs/heads/master; then
		echo "master"
	else
		# fallback: check remote HEAD
		if git ls-remote --symref ${REMOTE_NAME} HEAD >/dev/null 2>&1; then
			main_ref=$(git ls-remote --symref ${REMOTE_NAME} HEAD | awk '/^ref/ {print $3; exit}')
			if [[ -n "$main_ref" ]]; then
				echo "${main_ref#refs/heads/}"
				return
			fi
		fi
		echo "main"
	fi
}

BASE_BRANCH=$(detect_base_branch)
echo "${CYAN}Using base branch:${RESET} ${BASE_BRANCH} (you can override with --base)"

# Step 1: fetch and prune
echo "${CYAN}Fetching and pruning remote-tracking refs from '${REMOTE_NAME}'...${RESET}"

# use fetch --prune first
if ! git fetch --prune ${REMOTE_NAME}; then
	echo "${YELLOW}Warning:${RESET} 'git fetch --prune ${REMOTE_NAME}' failed; continuing." >&2
fi

# Step 2: list gone upstream branches (local branches tracking deleted remotes)
GONE_BRANCHES=$(git branch -vv | awk '/: gone]/{print $1}')

# Step 3: list branches merged into base (safe to delete) excluding current and protected
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# get list of merged branches relative to base
MERGED_BRANCHES_RAW=$(git branch --merged ${BASE_BRANCH} | sed 's/^..//')

# compose protected list
protected_file=$(mktemp)
for p in $(protect_set); do echo "$p" >>"$protected_file"; done

MERGED_BRANCHES=$(comm -23 <(printf "%s\n" ${MERGED_BRANCHES_RAW} | sort) <(printf "%s\n" "${CURRENT_BRANCH}" $(join_by ' ' $(cat "$protected_file")) | tr ' ' '\n' | sort) | sed '/^$/d')

# Remove any branches that are the same as base
MERGED_BRANCHES=$(printf "%s\n" "$MERGED_BRANCHES" | grep -v -E "^${BASE_BRANCH}$" || true)

# Clean up temp
rm -f "$protected_file"

# Print preview
echo
echo "${CYAN}Preview:${RESET}"

if [[ -n "$GONE_BRANCHES" ]]; then
	echo "${YELLOW}Local branches tracking removed remote branches (gone):${RESET}"
	echo "$GONE_BRANCHES" | sed 's/^/  - /'
else
	echo "  None (no local branches tracking deleted remotes)"
fi

if [[ -n "$MERGED_BRANCHES" ]]; then
	echo "${GREEN}Local branches merged into ${BASE_BRANCH} (safe to delete):${RESET}"
	echo "$MERGED_BRANCHES" | sed 's/^/  - /'
else
	echo "  None (no merged local branches besides protected/current ones)"
fi

# Confirm with user
if $DRY_RUN; then
	echo
	echo "${YELLOW}Dry-run mode${RESET}: No branches were deleted. Use --apply to perform deletions, or re-run with --apply --force to force-delete gone branches."
else
	echo
	read -r -p "Delete branches listed above? (y/N): " CONF
	CONF=${CONF:-N}
	if [[ "$CONF" != "y" && "$CONF" != "Y" ]]; then
		echo "Aborted. No branches deleted."
		exit 0
	fi

	# Delete gone tracking branches
	if [[ -n "$GONE_BRANCHES" ]]; then
		echo "${CYAN}Deleting branches tracking gone remote branches...${RESET}"
		# iterate
		while IFS= read -r b; do
			if [[ -z "$b" ]]; then continue; fi
			echo "  -> Deleting $b"
			if ! git branch -d "$b"; then
				if $FORCE_DELETE; then
					echo "    - failed to safely delete $b; forcing (-D)"
					git branch -D "$b" || echo "    - failed to force delete $b"
				else
					echo "    - not deleted: $b needs force-delete; re-run with --force to force delete"
				fi
			fi
		done <<<"$GONE_BRANCHES"
	else
		echo "No gone branches to delete."
	fi

	# Delete merged branches
	if [[ -n "$MERGED_BRANCHES" ]]; then
		echo "${CYAN}Deleting merged branches...${RESET}"
		while IFS= read -r b; do
			if [[ -z "$b" ]]; then continue; fi
			# double-check again that branch is not protected
			protected_match=false
			IFS=','
			for p in ${EXCLUDE_LIST}; do
				if [[ "$p" == "$b" ]]; then
					protected_match=true
					break
				fi
			done
			IFS=' '

			if $protected_match || [[ "$b" == "$CURRENT_BRANCH" ]] || [[ "$b" == "$BASE_BRANCH" ]]; then
				echo "  - Skipping protected branch $b"
				continue
			fi

			echo "  -> Deleting merged branch $b"
			git branch -d "$b" || echo "    - branch $b could not be deleted (maybe unmerged)."
		done <<<"$MERGED_BRANCHES"
	else
		echo "No merged branches to delete."
	fi

	# After deletions, prune and optionally gc.
	echo "${CYAN}Prune and final fetch...${RESET}"
	git fetch --prune ${REMOTE_NAME} || true
	if $GC_AFTER; then
		echo "${CYAN}Running git gc...${RESET}"
		git reflog expire --expire=now --all || true
		git gc --prune=now --aggressive || true
	fi
	echo "Done."
fi

exit 0
