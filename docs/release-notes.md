# Release Notes

## 1.1.1

- **Built-in Blocking wildcards preserved**: Backend now reads Technitium export output directly, so wildcard entries (e.g., `*.zeronet.org`) display and round-trip correctly in the Companion UI. Added regression test to guard this behavior.
- **Cache directory fallback**: Backend falls back to project `./tmp/domain-lists-cache` then OS temp before `/data` to avoid ENOENT in dev/tests while keeping Docker `/data` as the persistent default.
- **PWA install prompt typing**: Frontend typings now register `beforeinstallprompt` on `WindowEventMap`, eliminating build-time type errors for PWA prompts.
- **Test stability**: Domain list cache init no longer leaves pending timers; e2e tests set a writable cache dir and global `/api` prefix.

If you’re upgrading, no config changes are required. For Docker, continue mounting `/data` to persist caches.
