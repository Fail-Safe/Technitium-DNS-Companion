# Frontend Guide: Zone Options Display

## Important Note: Internal Zones Filtered

**Internal zones (like `0.in-addr.arpa`, `1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.ip6.arpa`) are automatically excluded** from the zone comparison view by the backend. These are built-in reverse lookup zones with no user-facing configuration options.

- ✅ Backend filters them out before returning response
- ✅ Frontend receives only user-configurable zones
- ✅ No need to handle internal zones in UI

## Data Structure

### API Response: `TechnitiumZoneComparison`

```typescript
{
  name: "example.com",
  status: "different" | "in-sync" | "missing" | "unknown",
  differences: ["Query Access", "SOA Serial"],  // ← What's different (if any)
  nodes: [
    {
      nodeId: "node1",
      baseUrl: "https://node1.example.com:53443",
      fetchedAt: "2025-10-16T19:07:00Z",
      zone: {
        // BASIC FIELDS
        name: "example.com",
        type: "Forwarder",
        disabled: false,
        internal: false,

        // COMPARISON FIELDS (used for difference detection)
        dnssecStatus: "Valid",
        soaSerial: 2025101601,
        isExpired: false,
        syncFailed: false,
        notifyFailed: false,
        notifyFailedFor: [],

        // QUERY ACCESS FIELDS (used for difference detection)
        queryAccess: "Allow",
        queryAccessNetworkACL: [],

        // INFORMATIONAL FIELDS (display-only)
        lastModified: "2025-10-16T14:30:00Z",
        expiry: null,
        zoneTransfer: "AllowOnlyZoneNameServers",
        zoneTransferNetworkACL: ["192.168.45.7"],
        zoneTransferTsigKeyNames: [],
        notify: "ZoneNameServers",
        notifyNameServers: ["192.168.45.7"],
        notifyFailedFor: []
      },
      error: null
    },
    {
      nodeId: "node2",
      baseUrl: "https://node2.example.com:53443",
      fetchedAt: "2025-10-16T19:07:00Z",
      zone: {
        // BASIC FIELDS
        name: "example.com",
        type: "SecondaryForwarder",
        disabled: false,
        internal: false,

        // COMPARISON FIELDS
        dnssecStatus: "Valid",
        soaSerial: 2025101601,
        isExpired: false,
        syncFailed: false,
        notifyFailed: false,
        notifyFailedFor: [],

        // QUERY ACCESS FIELDS
        queryAccess: "AllowOnlyPrivateNetworks",  // ← DIFFERENT!
        queryAccessNetworkACL: [],

        // INFORMATIONAL FIELDS
        lastModified: "2025-10-16T14:30:00Z",
        expiry: null,
        zoneTransfer: undefined,  // ← Secondary forwarder doesn't have this
        zoneTransferNetworkACL: undefined,
        zoneTransferTsigKeyNames: undefined,
        notify: undefined,  // ← Secondary forwarder doesn't have this
        notifyNameServers: undefined,
        notifyFailedFor: []
      },
      error: null
    }
  ]
}
```

## Display Components

### 1. Zone Status Badge

Shows overall status - only based on COMPARISON fields:

```typescript
// Determines badge color
if (zone.status === "different") {
  // Red badge - something needs attention
  // Only if comparison fields differ
}

// The 'differences' array tells you WHAT differs
zone.differences.forEach(diff => {
  console.log(`Difference found: ${diff}`);
  // "Query Access"
  // "SOA Serial"
  // etc.
});
```

**Note**: Zone Transfer being different (or missing on secondary) does NOT affect status because it's not in ZONE_COMPARISON_FIELDS.

### 2. Zone Details Card

Display both comparison and informational fields:

```typescript
// SECTION 1: Basic Info (from ZONE_DISPLAY_FIELDS)
<div className="zone-info">
  <div>Type: {zone.type}</div>
  <div>Last Modified: {zone.lastModified}</div>
  <div>Expiry: {zone.expiry ?? "Never"}</div>
</div>

// SECTION 2: Comparison Fields (in 'differences' array)
zone.differences?.forEach(diff => {
  <div className="difference-warning">
    {diff} differs between nodes
  </div>
});

// SECTION 3: Configuration Details (all fields)
<div className="config-details">
  <div>DNSSEC: {zone.dnssecStatus}</div>
  <div>SOA Serial: {zone.soaSerial}</div>
  <div>Disabled: {zone.disabled}</div>
  <div>Internal: {zone.internal}</div>

  {/* Query Access (both nodes have this) */}
  <div>Query Access: {zone.queryAccess}</div>
  <div>Query Access ACL: {zone.queryAccessNetworkACL?.join(', ') || 'None'}</div>

  {/* Zone Transfer (informational) */}
  {zone.zoneTransfer && (
    <div className="advanced">
      <div>Zone Transfer: {zone.zoneTransfer}</div>
      <div>Zone Transfer ACL: {zone.zoneTransferNetworkACL?.join(', ') || 'None'}</div>
    </div>
  )}

  {/* Notify (informational) */}
  {zone.notify && (
    <div className="advanced">
      <div>Notify: {zone.notify}</div>
      <div>Notify Servers: {zone.notifyNameServers?.join(', ') || 'None'}</div>
    </div>
  )}
</div>
```

### 3. Node Comparison View

Show which node has which value:

```typescript
<div className="node-comparison">
  {zone.nodes.map(nodeState => (
    <div className="node-column" key={nodeState.nodeId}>
      <h4>{nodeState.nodeId}</h4>

      {nodeState.zone ? (
        <>
          <p>Type: {nodeState.zone.type}</p>
          <p>Query Access: {nodeState.zone.queryAccess}</p>

          {/* Show Zone Transfer with note if missing */}
          {nodeState.zone.type === 'Forwarder' ? (
            <p>Zone Transfer: {nodeState.zone.zoneTransfer}</p>
          ) : (
            <p className="info-note">
              Zone Transfer: N/A (secondary doesn't control transfers)
            </p>
          )}
        </>
      ) : nodeState.error ? (
        <p className="error">Error: {nodeState.error}</p>
      ) : (
        <p className="info-note">Zone not found</p>
      )}
    </div>
  ))}
</div>
```

## Field Labels

Use `ZONE_FIELD_LABELS` mapping for consistent display:

```typescript
const ZONE_FIELD_LABELS: Record<string, string> = {
  type: 'Type',
  lastModified: 'Last Modified',
  expiry: 'Expiry',
  dnssecStatus: 'DNSSEC',
  soaSerial: 'SOA Serial',
  disabled: 'Disabled',
  internal: 'Internal',
  notifyFailed: 'Notify Failed',
  notifyFailedFor: 'Notify Targets',
  syncFailed: 'Sync Failed',
  isExpired: 'Expired',
  queryAccess: 'Query Access',
  queryAccessNetworkACL: 'Query Access ACL',
  zoneTransfer: 'Zone Transfer',
  zoneTransferNetworkACL: 'Zone Transfer ACL',
  zoneTransferTsigKeyNames: 'Zone Transfer TSIG Keys',
  notify: 'Notify Configuration',
  notifyNameServers: 'Notify Servers',
  presence: 'Presence',
};

// Usage
<div>{ZONE_FIELD_LABELS['queryAccess']}: {zone.queryAccess}</div>
// Displays: "Query Access: Allow"
```

## Display Examples

### Example 1: Query Access Difference

```
Zone: example.com
Status: DIFFERENT (red badge)

Differences:
  ❌ Query Access

Node Details:
┌─────────────────────┬─────────────────────┐
│ Node1 (Primary)      │ Node2 (Secondary)    │
├─────────────────────┼─────────────────────┤
│ Type: Forwarder     │ Type: SecondaryFwd  │
│ Query Access: Allow │ Query Access: Only  │
│                     │ Private Networks    │
│ Zone Transfer:      │ Zone Transfer: N/A  │
│   AllowOnlyZoneNS   │ (secondary)         │
│ Notify: ZoneNS      │ Notify: N/A         │
│                     │ (secondary)         │
└─────────────────────┴─────────────────────┘
```

### Example 2: In Sync

```
Zone: example.com
Status: IN SYNC (green badge)

Differences: None

Node Details:
┌─────────────────────┬─────────────────────┐
│ Node1 (Primary)      │ Node2 (Secondary)    │
├─────────────────────┼─────────────────────┤
│ Type: Forwarder     │ Type: SecondaryFwd  │
│ Query Access: Allow │ Query Access: Allow │
│ SOA Serial: 123456  │ SOA Serial: 123456  │
│ Zone Transfer:      │ Zone Transfer: N/A  │
│   AllowOnlyZoneNS   │ (secondary)         │
│ Notify: ZoneNS      │ Notify: N/A         │
│                     │ (secondary)         │
└─────────────────────┴─────────────────────┘
```

### Example 3: Missing Zone

```
Zone: test.local
Status: MISSING (yellow badge)

Differences:
  ⚠️  Presence

Node Details:
┌─────────────────────┬─────────────────────┐
│ Node1 (Primary)      │ Node2 (Secondary)    │
├─────────────────────┼─────────────────────┤
│ ✅ Zone found       │ ❌ Zone not found   │
│ Type: Forwarder     │                     │
└─────────────────────┴─────────────────────┘
```

## Key Points for Frontend Development

1. **Status is Based on Comparison Fields Only**
   - Zone status ≠ whether all fields are identical
   - Zone status = whether COMPARISON fields differ

2. **Zone Transfer & Notify Are Informational**
   - Always display when available
   - Don't affect zone status
   - Expected to differ between primary/secondary

3. **Query Access Must Match**
   - This IS a comparison field
   - If it differs, zone marked as "different"
   - Should be synchronized when possible

4. **Role-Specific Fields**
   - Check `zone.type` to determine which fields to expect
   - Primary Forwarder: Has Zone Transfer, Notify
   - Secondary Forwarder: No Zone Transfer, Notify

5. **Null/Undefined Handling**
   - Informational fields may be undefined on secondary forwarders
   - Always use optional chaining or fallbacks
   - Example: `zone.zoneTransfer ?? 'N/A (secondary)'`

## Implementation Checklist

- [ ] Display zone status badge (based on `zone.status`)
- [ ] Show comparison differences (from `zone.differences` array)
- [ ] Display type field (informational)
- [ ] Display last modified (informational)
- [ ] Display expiry (informational)
- [ ] Display Query Access (comparison field)
- [ ] Display Zone Transfer (informational, show "N/A" if undefined)
- [ ] Display Notify (informational, show "N/A" if undefined)
- [ ] Handle errors per node
- [ ] Handle missing zones
- [ ] Use ZONE_FIELD_LABELS for labels
