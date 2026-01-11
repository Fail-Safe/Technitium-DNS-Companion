# Branching Strategy (Patch-Friendly)

This repo aims to keep **production hotfixes easy** while still enabling steady feature development.

## Goals

- Keep `main` **always deployable**.
- Make it easy to cut **urgent patch releases** (e.g., `v1.3.2`) without pulling in unfinished features.
- Focus day-to-day development on the **next minor** (e.g., `v1.4.0`) without destabilizing production.

## Branches

### `main`

- **Always releasable.**
- Contains the latest released code line (at any point in time).
- Receives:
  - Urgent patch/hotfix merges (from `release/X.Y`, when needed)
  - Planned minor releases (merge `next` into `main` when `vX.(Y+1).0` is ready)

### `next`

- **Integration branch** for the next minor release (e.g., `v1.4.0`).
- Receives:
  - feature branches
  - refactors
  - non-urgent improvements
- Should still stay reasonably green (CI passing), but it is allowed to be “more in flux” than `main`.

### `release/X.Y` (example: `release/1.3`)

- **Optional** maintenance branch for a specific minor release line.
- Used to produce **patch releases** `vX.Y.Z`.
- Receives only:
  - bug fixes
  - regression fixes
  - security fixes
  - low-risk performance fixes
- No new features.

This repo’s default stance is:

- Keep working on `next` (the upcoming minor).
- Only create/use `release/1.3` if an urgent issue must be patched for users before `v1.4.0`.

### `feature/*` branches

- Branch off `next`.
- Merge back to `next` via PR.

Examples:

- `feature/advanced-blocking-groups-ui`
- `feature/query-logs-virtualized-table`

### `hotfix/*` branches

- Branch off the relevant `release/X.Y` branch.
- Merge back to `release/X.Y` via PR.
- Tag the patch release from the resulting merge commit.

Examples:

- `hotfix/1.3-paginated-scroll-jump`
- `hotfix/1.3-cache-bypass-regression`

## Day-to-day workflows

### 1) Adding a feature (targets next minor)

1. Create a branch from `next`:
   - `feature/my-feature`
2. Implement the feature + tests.
3. Merge into `next` via PR.
4. Repeat until the next minor is ready.

### 2) Urgent production fix (targets current minor patch)

When a bug/regression is discovered in production (e.g., running `v1.3.1`):

1. (If it doesn’t exist yet) create `release/1.3` from the last `v1.3.x` tag.
2. Branch from `release/1.3`:
   - `hotfix/1.3-something-broken`
3. Implement the fix + tests.
4. Merge into `release/1.3`.
5. Tag and publish from `release/1.3`:
   - `v1.3.2`
6. Backport the fix into `next`:
   - preferred: `git cherry-pick` the hotfix commit(s)

- acceptable: merge `release/1.3` → `next` (only if it won’t drag unrelated patches)

This keeps production patches clean and prevents regressions from reappearing in the next minor.

### 3) Fix that should ship both in patch and next minor

- If it’s urgent: do it as a hotfix first (`release/X.Y`), then cherry-pick into `next`.
- If it’s not urgent: do it in `next` first, then cherry-pick into `release/X.Y` (only if you decide it’s worth patching the old minor).

The key is: **don’t implement the same fix twice by hand**—always cherry-pick.

## Cutting releases

### Patch release (e.g., v1.3.2)

- Branch from `release/1.3` for the fix.
- Merge the hotfix PR into `release/1.3`.
- Ensure `CHANGELOG.md` includes the new version entry.
- Tag and push from that branch:

  ```bash
  git checkout release/1.3
  git pull
  git tag -a v1.3.2 -m "v1.3.2"
  git push origin v1.3.2
  ```

- Keep `main` aligned with the latest released patch by merging `release/1.3` → `main` (PR). This preserves the invariant that **`main` matches the latest shipped release**.

### Minor release (e.g., v1.4.0)

1. Stabilize `next`.
2. Merge `next` → `main` via PR.
3. Tag `v1.4.0` from `main`.
4. Create `release/1.4` if you want a maintenance lane for v1.4.x.

## Suggested branch protections (GitHub)

Recommended (especially if you expect outside PRs). For a solo maintainer, you can keep this lighter.

- `main`
  - require PRs (no direct pushes)
  - require CI checks (tests/build/lint)
  - optionally require linear history
- `release/*`
  - same protections as `main` (patches should be high-confidence)
- `next`
  - require PRs
  - require at least tests + lint

## Practical setup (right now)

After publishing `v1.3.1`, a good starting point is:

1. Create `next` from `main`.
2. Put a rule in place: features only go to `next`.
3. Only create `release/1.3` if an urgent `v1.3.x` patch is needed.

## Open questions (optional)

- Do you want to support more than one minor at once (e.g., keep shipping `v1.3.x` for a while after `v1.4.0`)? If yes, keep `release/1.3` alive after `v1.4.0`.
- Should `next` be allowed to merge from `release/*` (merge commits) or only cherry-picks? Cherry-picks usually keep history cleaner.
