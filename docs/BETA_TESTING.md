# Beta Testing

The beta channel is an opt-in, approval-gated release candidate promoted from
a selected `next` or `release/*` commit. It is for operators who can tolerate
regressions, retain a rollback path, and report the exact build they tested.
Stable installations continue to use `:latest` unless their image is
explicitly changed.

## Before you start

- Back up persistent Companion data and any configuration files you manage.
- Keep the previous stable image available until the soak test is complete.
- Do not test first on the only path you have to administer DNS.
- Review the current [Unreleased changelog](../CHANGELOG.md#unreleased), with
  particular attention to upgrade notes and security-sensitive features.

## Install with Docker Compose

Set this in the `.env` file next to `docker-compose.yml`:

```bash
COMPANION_IMAGE=ghcr.io/fail-safe/technitium-dns-companion:beta
```

Then pull, recreate, and confirm health:

```bash
docker compose pull
docker compose up -d
docker compose ps
```

The `beta` tag advances only after an explicit promotion and can remain fixed
while the rolling `next` integration tag receives more changes. For a longer
test or reliable reproduction, replace `:beta` with the immutable
`sha-<commit>-beta` tag associated with the promoted build.

## Promote a candidate

Maintainers promote a candidate by manually running **Build and Push Docker
Image** from `next` or a `release/*` branch with `push_image=true` and
`channel=beta`. The workflow runs the release quality gates, validates the
source branch, waits for approval through the protected `beta` environment,
and publishes `:beta`, `<version>-beta`, and `sha-<commit>-beta` to the same
image digest. The beta suffix keeps this rebuilt, channel-labelled artifact
distinct from the `sha-<commit>` preview artifact produced by an ordinary
`next` push.

```bash
gh workflow run docker-publish.yml \
  --ref next \
  -f push_image=true \
  -f channel=beta
```

Ordinary pushes to `next` publish only `:next` and `sha-<commit>`. Merging a
stable release back into `next` therefore cannot silently replace a beta that
is already being soaked.

The repository's `beta` environment must require a maintainer approval and
limit deployment branches to `next` and `release/*`. These protection rules
live in **Settings → Environments → beta** rather than in the workflow file;
without them, referencing the environment records a deployment but does not
create an approval gate.

## Record the exact build

The About dialog labels the build as **BETA**, shows the application version and
short source revision, and reports the latest stable release separately. The
complete revision and build channel are also stored in the image metadata:

```bash
docker image inspect \
  ghcr.io/fail-safe/technitium-dns-companion:beta \
  --format 'revision={{ index .Config.Labels "org.opencontainers.image.revision" }} channel={{ index .Config.Labels "io.github.fail-safe.technitium-dns-companion.build-channel" }}'
```

Include that revision, the image digest, your Technitium DNS version, browser,
deployment shape, and concise reproduction steps in beta reports. Redact API
tokens, proxy secrets, cookies, private hostnames, and private DNS data.

## Suggested soak checks

- Sign in and out, then confirm the expected Technitium identity and RBAC.
- Check node overview, query logs, zones, filtering, DHCP, and any scheduled
  automation you normally use.
- Exercise the deployment behind its real TLS reverse proxy and from a mobile
  viewport if those are part of your environment.
- Watch container health, restarts, memory, and logs over at least 24 hours.
- If testing trusted-header SSO, keep a separately verified break-glass path
  and follow the dedicated [SSO guide](features/TRUSTED_HEADER_SSO.md).

## Roll back

Change the Compose override back to stable:

```bash
COMPANION_IMAGE=ghcr.io/fail-safe/technitium-dns-companion:latest
docker compose pull
docker compose up -d
```

If stable moved during the test, pin the previous known-good source tag
instead. Restore persistent data only when the beta changed durable state and
the relevant feature documentation calls for it; a normal image-only rollback
should not replace data unnecessarily.
