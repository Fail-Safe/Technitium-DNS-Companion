# DNS schedule recovery

DNS can accept a temporary allow even when its response is lost. Companion
records Advanced Blocking entries before writing so later evaluator runs can
reconcile them after failure, expiry, or restart.

**DNS changes awaiting recovery** counts source/node pairs with pending work,
not domains or confirmed writes. Run results also show unreachable or
unconfigured targets. Incomplete runs do not show a success toast.

Keep the evaluator enabled and restore the target's connectivity or
authorization. **Run now** retries immediately. Dry runs change neither DNS nor
tracking. Disabling the evaluator retains records but stops automatic retries.

Disable a schedule or end an override and wait for cleanup before deleting it.
Deletion cannot discard applied state, tracked entries, or pending work.
Switching to built-in mode also waits for Advanced Blocking cleanup.
Removing a configured node retains its records. Recovery uses validated Primary
routing and never falls back to an unauthorized target.

## Storage and reconciliation

The existing SQLite database holds one pending row per source and original node.
It stores exact group/action/domain tuples from previous tracking, pending work,
and the current definition. This preserves both sides of a definition change
without storing credentials or complete DNS configurations. The table is created
idempotently on fresh and existing databases.

Before writing, a transaction verifies the source exists and saves the recovery
set. If storage fails, no DNS write occurs. After success, or a fresh read showing
no write is needed, another transaction updates entry tracking and applied state
and clears pending work. Failed finalization retains the pending record. No
transaction spans a network call. Evaluation and immediate deactivation are
serialized.

Active sources reconcile to their current settings. Expired, disabled, or
deselected sources remove their recorded entries. Shared entries transfer to
another active source's cleanup records before the retiring source clears its
tracking. Cleanup includes pending and entry-only records without applied state.

Recovery attempts requested cache flushes even when another configuration write
is unnecessary. Flushing remains best-effort and does not block finalization.

## Limits

Recovery needs reachable DNS and a running evaluator; expiry is not a
resolver-enforced lease. A requested entry is managed even if it existed before
activation, so avoid independently managing the same exact entry.

The revision guard rejects detected concurrent changes, but the final read and
POST can still race. Historical entries without tracking cannot be reconstructed.
Recovery covers Advanced Blocking writes; built-in lists retain their existing
behavior.
