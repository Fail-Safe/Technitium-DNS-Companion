# DNS schedule recovery

Schedules and temporary overrides retain cleanup records when an Advanced
Blocking write has an uncertain outcome. For example, DNS may accept a temporary
allow even if Companion never receives its response. The next evaluator run
reads the current configuration and reconciles it with the source's current
settings. This also works after expiry or a Companion restart.

The DNS Overrides page shows **DNS changes awaiting recovery**. A nonzero count
means one or more source/node pairs still need reconciliation; it is not a count
of domains or a confirmation that a write succeeded. Failed runs report errors
instead of a success toast. Keep the evaluator enabled and restore the target's
connectivity or authorization. **Run now** retries immediately. A dry run makes
no DNS or tracking changes. Disabling the evaluator retains pending work without
automatically retrying it.

Disable a schedule or end a temporary override before deleting it, then wait for
cleanup. Deletion is rejected while applied state, tracked entries, or pending
recovery remain. Removing a configured node does not erase its recovery records.
Recovery follows validated Primary routing and never falls back to an
unauthorized target.

## Storage and reconciliation

The existing Companion SQLite database contains one pending row per source and
original node. Its entries are exact Advanced Blocking group/action/domain
tuples, combining previous tracking, existing pending entries, and current
desired entries. This preserves both sides of a definition change if its write
response is lost. No credentials or complete DNS configurations are stored.

Before dispatch, a transaction verifies that the source still exists and saves
the recovery set. Storage failure prevents the DNS write. After an acknowledged
write, or a fresh read showing no write is needed, another transaction updates
entry tracking and applied state and clears pending recovery. A failed final
transaction leaves pending work intact. No transaction spans a network call.
Timer/manual evaluation and immediate deactivation are serialized.

Active sources reconcile to their current desired entries. Expired, disabled,
or deselected targets remove recorded entries, preserving requirements of other
active sources on the same target. Pending work and entry-only tracking are
enumerated even without an applied-state row. The new table is created
idempotently on both fresh and existing databases.

## Limits

Recovery requires reachable DNS and a running evaluator. Expiry is not a
resolver-enforced lease. Existing schedule semantics still apply: an entry
requested by a schedule is managed by that schedule even if it already existed
before activation. Avoid independently managing the same exact entry.

The revision guard rejects detected concurrent changes, but an edit between the
writer's final read and POST can still race. Historical orphaned entries with no
tracking cannot be reconstructed automatically. Built-in allowed/blocked lists
retain their existing behavior; this recovery mechanism covers Advanced
Blocking writes.
