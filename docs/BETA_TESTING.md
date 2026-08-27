# Beta Testing

The beta channel is an opt-in preview of the current `next` branch. It is for
operators who can tolerate regressions, retain a rollback path, and report the
exact build they tested. Stable installations continue to use `:latest` unless
their image is explicitly changed.

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

The `beta` and `next` tags are rolling aliases. For a longer test or a reliable
reproduction, replace `:beta` with the immutable `sha-<commit>` tag associated
with the build.

## Record the exact build

The About dialog shows the application version and short source revision. The
complete revision is also stored in the image metadata:

```bash
docker image inspect \
  ghcr.io/fail-safe/technitium-dns-companion:beta \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'
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

If stable moved during the test, pin the previous known-good `sha-<commit>` tag
instead. Restore persistent data only when the beta changed durable state and
the relevant feature documentation calls for it; a normal image-only rollback
should not replace data unnecessarily.
