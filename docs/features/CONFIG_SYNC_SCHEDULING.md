# Scheduled Configuration Sync

Scheduled Configuration Sync is an opt-in backend automation for standalone
Technitium DNS nodes running the Advanced Blocking app. It copies the complete
Advanced Blocking configuration from one authoritative source node to one or
more targets when drift is detected.

Native Technitium clusters should use their built-in replication instead.

## Configuration

```env
TECHNITIUM_SCHEDULE_TOKEN=your-dedicated-automation-token
CONFIG_SYNC_ENABLED=true
CONFIG_SYNC_SOURCE_NODE=node1
CONFIG_SYNC_TARGET_NODES=node2,node3
CONFIG_SYNC_INTERVAL_MINUTES=60
CONFIG_SYNC_NOTIFY_EMAILS=admin@example.com,ops@example.com
```

The schedule token requires `Apps: Modify`. Use a dedicated automation user and
do not reuse an administrator token.

`CONFIG_SYNC_NOTIFY_EMAILS` is optional. When configured alongside the existing
SMTP settings, Companion sends one alert for a failure episode. Repeated failed
runs are suppressed until a successful run resets the alert state.

## Behavior

For each run, Companion:

1. Loads the source Advanced Blocking configuration with the schedule token.
2. Loads each target configuration.
3. Skips targets whose serialized configuration already matches the source.
4. Creates a system-attributed DNS Filtering snapshot on a divergent target.
5. Writes the source configuration to that target.
6. Stores the per-target result in the in-memory scheduler status.

The first automatic run occurs after the configured interval, not immediately
at startup. This avoids an unexpected write during deployment.

## API

- `GET /api/nodes/config-sync/status` returns configuration, running state,
  next-run time, and the last result. Notification addresses are not returned.
- `POST /api/nodes/config-sync/run` triggers an immediate run with the same
  schedule token and overlap guard.

The current MVP is environment-configured and uses a fixed interval. Persisted
calendar/cron schedules and a schedule editor remain future UX work.
