# Releasing

This repo uses **tag-driven releases**.

- **Source of truth for release notes:** `CHANGELOG.md`
- **Release tag format:** `vX.Y.Z` (example: `v1.2.2`)
- **Automation:** GitHub Actions creates/updates the GitHub Release and publishes Docker images when a release tag is pushed.

## Branch Context (Recommended)

For a patch-friendly workflow (keep `main` stable while developing `v1.(Y+1)` features), see:

- [BRANCHING_STRATEGY.md](./BRANCHING_STRATEGY.md)

In short:

- Patch releases `vX.Y.Z` are typically cut from `release/X.Y` (often created only when an urgent patch is needed).
- Minor releases `vX.(Y+1).0` are cut from `main` after merging `next`.

## Quick Sanity Checklist (Do This Every Time)

1. **Bump versions (if needed)**
   - Ensure the repo version is set correctly (root `package.json` as well as any workspace versions you intentionally manage).

2. **Update `CHANGELOG.md`**
   - Add a section like:
     - `## [X.Y.Z] - YYYY-MM-DD`
   - Keep it human-readable and include PR/issue references.

3. **Verify the tag commit contains the changelog entry**
   - The most common failure mode is tagging a commit that does _not_ include the `## [X.Y.Z]` section.
   - Locally:
     ```bash
     git show vX.Y.Z:CHANGELOG.md | sed -n '1,80p'
     ```
     If the `X.Y.Z` section isn’t there, you tagged the wrong commit.

4. **Push the release tag**

   ```bash
   # Patch release example (recommended): tag from release/X.Y
   git checkout release/X.Y
   git pull
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z

   # Minor release example: tag from main
   # git checkout main && git pull
   # git tag -a vX.(Y+1).0 -m "vX.(Y+1).0"
   # git push origin vX.(Y+1).0
   ```

5. **Confirm GitHub Actions is green**
   - **Publish Release**: should succeed and produce the correct release notes.
   - **Build and Push Docker Image**: should succeed for `linux/amd64` and `linux/arm64`.

6. **Confirm the GitHub Release exists**
   - Example:
     ```bash
     gh release view vX.Y.Z
     ```

## Retagging / Reruns (When Something Went Wrong)

Sometimes you’ll need to fix a workflow issue after tagging (e.g., changelog mismatch, Docker multi-arch build failure).

Preferred approach:

1. Fix the repo on `main` (commit the fix).
2. Move the tag to the corrected commit and force-push it:

```bash
git tag -fa vX.Y.Z -m "vX.Y.Z"
git push --force origin vX.Y.Z
```

Notes:

- The release workflow is configured to be **rerunnable** (it can update an existing GitHub Release for the same tag).
- Force-moving a tag rewrites history for that tag; only do this when necessary and ideally immediately after a failed release attempt.

## Docker Multi-Arch Gotchas (Arm64)

- Multi-arch builds in CI often **cross-build** (e.g., producing `linux/arm64` images using an `amd64` builder).
- If a build stage runs on the build machine architecture, installing target-arch native binaries (like `@esbuild/linux-arm64`) will fail with `EBADPLATFORM`.
- Prefer selecting any “native binary” installs based on `BUILDPLATFORM` for builder stages.
