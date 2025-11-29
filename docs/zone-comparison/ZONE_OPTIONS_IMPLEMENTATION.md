# Zone Options Implementation Summary

## Overview

Query Access ACL comparison has been implemented for Technitium DNS zones. This allows technitium-dns-companion to detect when Query Access configurations differ between Primary and Secondary Forwarders (Node1 and Node2).

Additionally, all zone configuration fields are available for display in the UI, including informational fields like Type, Last Modified, and Zone Transfer settings - even though these informational fields are not used for detecting configuration differences.

**Internal zones (built-in reverse lookups, etc.) are automatically excluded** from comparison since they have no user-facing configuration options.

## What Changed

### 1. Backend Service Updates

**File**: `apps/backend/src/technitium/technitium.service.ts`

#### New Constants

**ZONE_COMPARISON_FIELDS** - Fields used to detect differences:
```typescript
const ZONE_COMPARISON_FIELDS = [
  'dnssecStatus',
  'soaSerial',
  'disabled',
  'internal',
  'notifyFailed',
  'notifyFailedFor',
  'syncFailed',
  'isExpired',
  'queryAccess',           // ← Query Access compared
  'queryAccessNetworkACL', // ← Query Access ACL compared
] as const;
```

**ZONE_DISPLAY_FIELDS** - All fields available for UI display:
```typescript
const ZONE_DISPLAY_FIELDS = [
  // Comparison fields (differences detected)
  'dnssecStatus', 'soaSerial', 'disabled', 'internal',
  'notifyFailed', 'notifyFailedFor', 'syncFailed', 'isExpired',
  'queryAccess', 'queryAccessNetworkACL',
  // Informational fields (displayed but not compared)
  'type',                      // Zone type (Primary, Secondary, etc.)
  'lastModified',              // Last modification time
  'expiry',                    // Zone expiration date
  'zoneTransfer',              // Zone Transfer rule type
  'zoneTransferNetworkACL',    // Zone Transfer ACL
  'zoneTransferTsigKeyNames',  // Zone Transfer TSIG keys
  'notify',                    // Notify configuration
  'notifyNameServers',         // Notify targets
] as const;
```

**ZONE_FIELD_LABELS** - Display labels for all fields:
```typescript
const ZONE_FIELD_LABELS: Record<ZoneDisplayField | 'presence', string> = {
  // Comparison fields
  dnssecStatus: 'DNSSEC',
  soaSerial: 'SOA Serial',
  // ... comparison fields ...
  // Informational fields
  type: 'Type',
  lastModified: 'Last Modified',
  expiry: 'Expiry',
  zoneTransfer: 'Zone Transfer',
  // ... informational fields ...
};
```

#### Enhanced `getCombinedZones()` Method

**Changes**:
- Fetches zone options for each zone using `getZoneOptions(nodeId, zoneName)`
- Calls `/api/zones/options/get` endpoint to retrieve full zone configuration
- Executes all zone options fetches in parallel using `Promise.all()` for efficiency
- Implements error handling: if one zone's options fail, logs warning and continues
- **Automatically filters out internal zones** (built-in reverse lookups like `0.in-addr.arpa`)

**Key point**: All zone fields are fetched and included in the response, even though only ZONE_COMPARISON_FIELDS are used for detecting differences.

**Internal Zone Filtering**:
- Checks `zone.internal === true` flag
- Skips processing and comparison
- Logs debug message for troubleshooting
- Prevents user confusion about built-in zones

### 2. Type Definitions

**File**: `apps/backend/src/technitium/technitium.types.ts`

Already includes all zone configuration fields in `TechnitiumZoneSummary`:
```typescript
export interface TechnitiumZoneSummary {
  name: string;
  type?: string;                    // Informational: Zone type
  internal?: boolean;
  dnssecStatus?: string;
  soaSerial?: number;
  expiry?: string;                  // Informational: Expiry date
  isExpired?: boolean;
  syncFailed?: boolean;
  notifyFailed?: boolean;
  notifyFailedFor?: string[];
  lastModified?: string;            // Informational: Last modified
  disabled?: boolean;
  // Comparison fields
  queryAccess?: string;             // ← Compared
  queryAccessNetworkACL?: string[]; // ← Compared
  // Informational fields
  zoneTransfer?: string;            // Informational: Zone Transfer setting
  zoneTransferNetworkACL?: string[];
  zoneTransferTsigKeyNames?: string[];
  notify?: string;                  // Informational: Notify setting
  notifyNameServers?: string[];
}
```

### 3. Frontend (No changes needed yet)

- Frontend already displays zone differences via `differences?: string[]` array
- Query Access differences will appear as:
  - "Query Access" (for queryAccess field mismatches)
  - "Query Access ACL" (for queryAccessNetworkACL mismatches)
- Other fields can be displayed directly from `zone` object without being in the differences array

## How It Works

### Comparison vs Display Strategy

**Comparison** (Detects differences, marks zones as "different"):
- DNSSEC status, SOA Serial, Disabled, Internal, Notify Failed, Sync Failed, Expired
- Query Access (both nodes support this)
- Query Access ACL (both nodes support this)

**Display** (Shows in UI, but doesn't affect comparison status):
- Type (Forwarder, SecondaryForwarder, etc.)
- Last Modified timestamp
- Expiry date
- Zone Transfer rule (primary only)
- Zone Transfer ACL (primary only)
- Zone Transfer TSIG keys (primary only)
- Notify configuration (primary only)
- Notify servers (primary only)

### API Flow

1. **Zone List Fetch**: `/api/zones/list` returns basic zone info
2. **Zone Options Fetch**: For each zone, `/api/zones/options/get?zone={name}` returns:
   - All configuration fields
   - Query Access settings (compared)
   - Zone Transfer settings (informational)
   - Notify settings (informational)
3. **Comparison**: Only ZONE_COMPARISON_FIELDS are compared
4. **Display**: All fields in ZONE_DISPLAY_FIELDS are available to UI

### Frontend Display Example

```
Zone: example.com

COMPARISON STATUS: Different
Differences: Query Access

CONFIG DETAILS:
┌─ Basic Info ─────────────────┐
│ Type: Forwarder              │
│ Last Modified: 2025-10-16    │
│ Expiry: Never                │
│ DNSSEC: Valid                │
│ SOA Serial: 2025101601       │
└──────────────────────────────┘

┌─ Node1 (Primary)   Node2 (Secondary) ────┐
│ Query Access:                           │
│   Node1: Allow                           │
│   Node2: AllowOnlyPrivateNetworks  ❌    │
│                                         │
│ Zone Transfer (Primary only):           │
│   Node1: AllowOnlyZoneNameServers        │
│   Node2: N/A (secondary)                 │
└─────────────────────────────────────────┘
```

## Implementation Details

### Comparison Logic

Only ZONE_COMPARISON_FIELDS are checked in `computeZoneDifferences()`:

```typescript
for (const field of ZONE_COMPARISON_FIELDS) {
  if (!this.areZoneValuesEqual(baseline[field], current[field])) {
    differences.add(field);
  }
}
```

### Normalization

Only comparison fields are normalized in `normalizeZoneComparison()`:

```typescript
private normalizeZoneComparison(zone: TechnitiumZoneSummary) {
  return {
    // Only these fields are normalized for comparison
    dnssecStatus: zone.dnssecStatus ?? '',
    queryAccess: zone.queryAccess ?? '',
    queryAccessNetworkACL: this.normalizeStringArray(zone.queryAccessNetworkACL),
    // ... other comparison fields ...
    // Display fields are NOT included here
  };
}
```

### Display Data

All zone fields are included in the API response via `TechnitiumZoneSummary`. The frontend can access:
- `zone.queryAccess` - Display or compare
- `zone.zoneTransfer` - Informational only
- `zone.type` - Informational only
- `zone.lastModified` - Informational only
- etc.

## Performance Impact

- **Before**: 2 API calls per sync (one `/zones/list` per node)
- **After**: 2 + (18 × 2) = 38 API calls per sync (18 zones × 2 nodes)
- **Time impact**: ~200-400ms additional latency per sync (acceptable)
- **Optimization**: All zone options fetched in parallel

## What Gets Displayed vs Compared

### Displayed in UI (All Fields)
- Zone Type ✓
- Last Modified ✓
- Expiry ✓
- DNSSEC Status ✓
- SOA Serial ✓
- Query Access ✓
- Query Access ACL ✓
- Zone Transfer (Node1) ✓
- Zone Transfer ACL (Node1) ✓
- Zone Transfer TSIG Keys (Node1) ✓
- Notify (Node1) ✓
- Notify Servers (Node1) ✓

### Compared for Differences (Subset)
- DNSSEC Status ✓
- SOA Serial ✓
- Disabled ✓
- Internal ✓
- Notify Failed ✓
- Sync Failed ✓
- Expired ✓
- Query Access ✓
- Query Access ACL ✓

## Benefits of This Approach

1. **Focused Comparison**: Only meaningful fields are compared, reducing noise
2. **Rich Display**: Users see all configuration details, including role-specific fields
3. **Educational**: Users can see why zones differ by design (e.g., "Zone Transfer is only on Node1 because it's primary")
4. **Flexible**: Easy to adjust what's compared vs displayed
5. **Architecture-Aware**: Respects PRIMARY/SECONDARY model without forced parity

## Next Steps

### Frontend Implementation
1. Update zone detail card to display all ZONE_DISPLAY_FIELDS
2. Show informational fields separately from comparison differences
3. Add collapsible sections for advanced fields (Zone Transfer, Notify, etc.)

### Optional Enhancements
1. Add UI for editing Query Access (sync from primary to secondary)
2. Add Zone Transfer ACL monitoring (informational for Node1)
3. Add Notify Configuration monitoring (informational for Node1)
4. Consider performance optimizations (caching, background sync)

## Troubleshooting

**Q: Zone type is showing but comparison still works?**
A: Yes! Type is not in ZONE_COMPARISON_FIELDS, so it doesn't affect comparison status. It's purely informational.

**Q: Why can't I compare Zone Transfer between primary and secondary?**
A: Zone Transfer settings only exist on primary forwarders. Comparing them would always show as different by design.

**Q: Can I add more fields to comparison?**
A: Yes, just add them to ZONE_COMPARISON_FIELDS and update normalizeZoneComparison().

**Q: Can I remove fields from display?**
A: Yes, remove them from ZONE_DISPLAY_FIELDS and ZONE_FIELD_LABELS. They'll still be in the zone object but won't be labeled.

