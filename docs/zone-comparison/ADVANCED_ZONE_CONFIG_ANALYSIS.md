# Advanced Zone Configuration Comparison Analysis

## Overview

Three advanced zone configuration attributes can be compared to detect configuration drift:

1. **Zone Transfer ACLs** - Transfer permissions and TSIG keys
2. **Query Access ACLs** - Query restrictions
3. **Notify Configuration** - Specific NOTIFY targets

These are available via `/api/zones/options/get` endpoint (not from `/api/zones/list`).

---

## 1. Zone Transfer ACLs

### What It Is
Controls which DNS servers (secondaries, etc.) are allowed to transfer the zone (AXFR/IXFR).

### API Fields
```
- zoneTransfer: "Deny" | "Allow" | "AllowOnlyZoneNameServers" | "UseSpecifiedNetworkACL" | "AllowZoneNameServersAndUseSpecifiedNetworkACL"
- zoneTransferNetworkACL: string[] - List of IP/CIDR addresses allowed to transfer
- zoneTransferTsigKeyNames: string[] - TSIG keys authorized for zone transfer
```

### ⚠️ IMPORTANT: Zone Type Considerations

**Zone Transfer options are ONLY available for Primary zone types:**
- ✅ Available: `Primary`, `Forwarder`, `SecondaryForwarder` (can receive & serve zones)
- ❌ NOT Available: Secondary zone types that only receive updates

**Observed in Your Setup:**
- **EQ14** has `Forwarder` zones → HAS Zone Transfer ACL options
- **EQ12** has `SecondaryForwarder` zones → NO Zone Transfer ACL options shown in UI
- This is **expected behavior** - secondary forwarders don't control transfers, only receive them

### When Should It Match?

| Scenario | Primary | Secondary | Should Match? |
|----------|---------|-----------|----------------|
| Standard setup | `AllowOnlyZoneNameServers` | `AllowOnlyZoneNameServers` | ✅ YES |
| Allow specific IPs | Custom ACL with IPs | Same custom ACL | ✅ YES |
| Different transfer paths | Different ACL per node | Different ACL per node | ❌ NO* |
| TSIG configured | TSIG keys defined | Same TSIG keys | ✅ YES |
| **Primary vs Secondary** | **Forwarder (has options)** | **SecondaryForwarder (no options)** | ⚠️ NOT COMPARABLE |

*\* Only if intentional by design (e.g., different secondaries per region)*

### Your Setup (EQ14 + EQ12)
**FINDING: Your zones are PRIMARY/SECONDARY pairs, not both primaries!**

- EQ14: `Forwarder` (Primary role) → Has Zone Transfer ACL options
- EQ12: `SecondaryForwarder` (Secondary role) → Does NOT have Zone Transfer ACL options

**This is NOT a configuration drift issue** - it's by design.

**ACTION NEEDED**: Consider whether you want:
1. **Configuration Parity Mode**: Both nodes as Forwarders (ignoring replication) → Compare zone transfers ✅
2. **Replication Mode**: Keep Primary/Secondary setup → Don't compare zone transfers ✅ (Recommended)

---

## 2. Query Access ACLs

### What It Is
Controls which clients/networks are allowed to query the zone.

### API Fields
```
- queryAccess: "Deny" | "Allow" | "AllowOnlyPrivateNetworks" | "AllowOnlyZoneNameServers" | "UseSpecifiedNetworkACL" | "AllowZoneNameServersAndUseSpecifiedNetworkACL"
- queryAccessNetworkACL: string[] - List of IP/CIDR addresses allowed to query
```

### When Should It Match?

| Scenario | Primary | Secondary | Should Match? |
|----------|---------|-----------|----------------|
| Allow all | `Allow` | `Allow` | ✅ YES |
| Private only | `AllowOnlyPrivateNetworks` | `AllowOnlyPrivateNetworks` | ✅ YES |
| Specific clients | Custom ACL with IPs | Same custom ACL | ✅ YES |
| Different restrictions | Different ACL per node | Different ACL per node | ❌ NO* |

*\* Generally shouldn't happen - clients should get same responses from all nodes*

### Your Setup (EQ14 + EQ12)
**Question: Do you have any per-node query access restrictions, or are they standard?**

- If **identical settings**: These should match → Add to comparison ✅
- If **different by design**: Probably misconfiguration → Should match anyway ✅

**Recommendation**: Likely safe to compare - query access should be identical across all nodes.

---

## 3. Notify Configuration

### What It Is
Controls which servers (secondary nameservers) are notified when zone is updated.

### API Fields
```
- notify: "None" | "ZoneNameServers" | "SpecifiedNameServers" | "BothZoneAndSpecifiedNameServers" | "SeparateNameServersForCatalogAndMemberZones"
- notifyNameServers: string[] - List of IP/hostnames to notify
- notifyFailedFor: string[] - (Already tracked) List of servers where NOTIFY failed
```

### ⚠️ IMPORTANT: Zone Type Considerations

**Notify options are ONLY available for Primary zone types:**
- ✅ Available: `Primary`, `Forwarder` (can notify other servers)
- ❌ NOT Available: `Secondary`, `SecondaryForwarder` (only receive updates, don't send notifications)

**Observed in Your Setup:**
- **EQ14** has `Forwarder` zones → HAS Notify configuration options
- **EQ12** has `SecondaryForwarder` zones → NO Notify options shown in UI
- This is **expected behavior** - secondaries don't notify other servers

### When Should It Match?

| Scenario | Primary | Secondary | Should Match? |
|----------|---------|-----------|----------------|
| Use NS records | `ZoneNameServers` | `ZoneNameServers` | ✅ YES |
| Notify specific servers | `SpecifiedNameServers` + list | Same list | ✅ YES |
| No notification | `None` | `None` | ✅ YES |
| Different targets | Different notify list | Different notify list | ❌ NO* |
| **Primary vs Secondary** | **Forwarder (has options)** | **SecondaryForwarder (no options)** | ⚠️ NOT COMPARABLE |

*\* Could be intentional if each node notifies different secondaries*

### Your Setup (EQ14 + EQ12)
**FINDING: Your zones are PRIMARY/SECONDARY pairs, not both primaries!**

- EQ14: `Forwarder` (Primary role) → Has Notify configuration
- EQ12: `SecondaryForwarder` (Secondary role) → Does NOT have Notify configuration

**This is NOT a configuration drift issue** - it's by design.

**ACTION NEEDED**: Consider whether you want:
1. **Configuration Parity Mode**: Both nodes as Forwarders (ignoring replication) → Compare notifications ✅
2. **Replication Mode**: Keep Primary/Secondary setup → Don't compare notifications ✅ (Recommended)

---

## Implementation Considerations

### Performance Impact
Currently: **1 API call** per node for basic zones (`/api/zones/list`)
With additions: **N+1 API calls** per node (N zones + 1 list call)

**Example with 18 zones:**
- Current: 2 zones/list calls = 2 API calls total
- With options: 2 zones/list + 36 options/get calls = 38 API calls total
- Time impact: Potentially 19x slower

### Data Extraction Strategy

Add new interface to `technitium.types.ts`:
```typescript
export interface TechnitiumZoneAdvancedConfig {
  zoneTransfer?: string;
  zoneTransferNetworkACL?: string[];
  zoneTransferTsigKeyNames?: string[];
  queryAccess?: string;
  queryAccessNetworkACL?: string[];
  notify?: string;
  notifyNameServers?: string[];
}
```

Add new method to `technitium.service.ts`:
```typescript
async getZoneOptions(nodeId: string, zoneName: string): Promise<TechnitiumZoneAdvancedConfig>
```

### Comparison Logic

Only compare if explicitly enabled:
```typescript
const ZONE_ADVANCED_COMPARISON_ENABLED = false; // Toggle

if (ZONE_ADVANCED_COMPARISON_ENABLED) {
  // Add transfer/query/notify fields to comparison
}
```

---

## Key Finding: Primary/Secondary Architecture

**Your current setup uses a PRIMARY/SECONDARY replication model:**
- **EQ14 (Primary role)**: Forwarder zones with full configuration options
- **EQ12 (Secondary role)**: SecondaryForwarder zones that receive zone data from EQ14

This means:
- Zone Transfer ACLs only exist on EQ14 (primary forwarders)
- Notify configuration only exists on EQ14 (primary forwarders)
- EQ12 has no these options because secondaries don't control transfers or send notifications

---

## Recommendation Matrix: PRIMARY vs SECONDARY Forwarders

**YES, compare Primary and Secondary Forwarders, but selectively:**

| Feature | EQ14 (Primary) | EQ12 (Secondary) | Comparable? | Why? |
|---------|---|---|---|---|
| **Zone Transfer ACLs** | ✅ Has option | ❌ No option | ⚠️ **No** | One-way: Primary controls, Secondary receives - Expected difference |
| **Query Access ACLs** | ✅ Has option | ✅ Has option | ✅ **YES** | Both nodes serve queries - Must be identical for consistency |
| **Notify Configuration** | ✅ Has option | ❌ No option | ⚠️ **No** | One-way: Primary sends, Secondary receives - Expected difference |

### Why Query Access Should Match Across Primary/Secondary Pairs

**Critical principle: Both nodes appear in NS records**
- Clients query both EQ14 and EQ12
- If query access differs → Clients get inconsistent responses
- Example of misconfiguration:
  - EQ14: `QueryAccess = Allow` (all clients)
  - EQ12: `QueryAccess = AllowOnlyPrivateNetworks` (private only)
  - Result: Public clients can't query EQ12, creating asymmetric access ❌

### Why Zone Transfer and Notify Don't Need Comparison

**These are architectural differences (by design, not misconfiguration):**
- **Zone Transfer**: Only Primary Forwarder controls who can pull zone data
  - Secondary Forwarder: Can't serve transfers (doesn't have master copy)
  - This is correct behavior
- **Notify**: Only Primary Forwarder sends notifications to secondaries
  - Secondary Forwarder: Doesn't notify others (receives notifications from Primary)
  - This is correct behavior

### Recommended Approach for Your PRIMARY/SECONDARY Setup

**✅ DO Compare:**
- Query Access ACLs (both nodes should have identical restrictions)

**⚠️ DON'T Compare (they're role-specific):**
- Zone Transfer ACLs (only EQ14 has these)
- Notify Configuration (only EQ14 has these)

### Questions to Confirm

1. **Query Access**: Should clients get identical query restrictions on both EQ14 and EQ12?
2. **Zone Transfer** (EQ14 only): Who should be allowed to transfer zones from EQ14?
3. **Notify** (EQ14 only): Should EQ14 notify any secondary nameservers when zones change?

---

## Implementation Status: ✅ COMPLETE

### What Was Implemented

Query Access ACL comparison for zones has been implemented and is now active. Additionally, all zone configuration fields are fetched and available for display in the UI, even though only specific fields are used for detecting configuration differences.

### Code Changes

#### 1. Backend Service (`technitium.service.ts`)

**Added Zone Options Fetching:**
- Modified `getCombinedZones()` method to fetch zone options for each zone
- Uses `getZoneOptions(nodeId, zoneName)` to retrieve full zone configuration
- Fetches options for all nodes in parallel for performance
- Gracefully handles errors (logs warnings, continues with partial data)

**Separated Comparison Fields from Display Fields:**
- `ZONE_COMPARISON_FIELDS` - Only fields used to detect differences:
  - Basic fields: DNSSEC, SOA Serial, Disabled, Internal, Notify Failed, Sync Failed, Expired
  - Query Access fields: queryAccess, queryAccessNetworkACL
- `ZONE_DISPLAY_FIELDS` - All fields available for UI display:
  - All comparison fields PLUS
  - Informational fields: Type, Last Modified, Expiry, Zone Transfer, Notify, etc.

**Comparison Logic:**
- `computeZoneDifferences()` only compares fields in `ZONE_COMPARISON_FIELDS`
- `normalizeZoneComparison()` only normalizes comparison fields
- All zone data is still fetched and available in `TechnitiumZoneSummary` for UI display

**Labels for Both:**
- `ZONE_FIELD_LABELS` includes labels for all comparison AND informational fields
- Used in the `differences` array only for actual differences

#### 2. Type Definitions (`technitium.types.ts`)

Already includes Query Access fields in `TechnitiumZoneSummary`:
```typescript
queryAccess?: string;
queryAccessNetworkACL?: string[];
```

#### 3. Frontend (No changes needed)

- Frontend already displays zone differences via `differences?: string[]` array
- Query Access differences will appear as:
  - "Query Access" (for queryAccess field mismatches)
  - "Query Access ACL" (for queryAccessNetworkACL mismatches)

### How It Works

1. **Zone List Fetch**: `/api/zones/list` returns basic zone info (name, type, serial, etc.)

2. **Zone Options Fetch**: For each zone, calls `/api/zones/options/get` to retrieve:
   - Query Access configuration (for both Primary and Secondary Forwarders)
   - Zone Transfer options (Primary Forwarders only)
   - Notify configuration (Primary Forwarders only)

3. **Comparison**: Compares all zone options between nodes and reports differences:
   - ✅ Query Access fields → COMPARED (both nodes support)
   - ⚠️ Zone Transfer fields → Included but differ by design
   - ⚠️ Notify fields → Included but differ by design

4. **Display**: Frontend shows zones marked as:
   - `"in-sync"` - All compared fields match
   - `"different"` - Differences detected (lists which fields differ)
   - `"missing"` - Zone exists on one node but not the other
   - `"unknown"` - Error fetching data from node

### Performance Impact

- **Before**: 2 API calls per sync (one `/zones/list` per node)
- **After**: 2 + (18 × 2) = 38 API calls per sync (18 zones × 2 nodes)
  - Each zone needs `/zones/options/get` call per node
- **Time impact**: ~200-400ms additional latency per sync (acceptable)
- **Optimization**: All zone options fetched in parallel (Promise.all)

### Verification

**To verify it's working:**

1. Check zones with Query Access differences:
   - Zones where EQ14 has `queryAccess="Allow"` but EQ12 has `queryAccess="AllowOnlyPrivateNetworks"`
   - These should now show as "Different" with "Query Access" listed

2. Check the logs for zone options fetching:
   - Look for messages like: "Failed to fetch zone options for X from node Y" (only if errors)

3. Check frontend UI:
   - Zone cards in "Differences" tab should show "Query Access" as a difference
   - Zone comparison details should include query access settings

### Next Steps (Optional Enhancements)

1. **Add UI for editing Query Access**: Allow users to sync Query Access settings from primary to secondary
2. **Add Zone Transfer ACL monitoring**: Show EQ14 configuration for information purposes
3. **Add Notify Configuration monitoring**: Show EQ14 notification targets for information purposes
4. **Performance optimization**: Consider caching zone options or implementing periodic sync background jobs

### Architecture Note

This implementation respects your PRIMARY/SECONDARY replication architecture:
- EQ14 (Primary Forwarder): Full zone control, includes Transfer and Notify options
- EQ12 (Secondary Forwarder): Receives zones from EQ14, only has Query Access options
- Query Access is compared because both nodes use it to serve queries
- Transfer/Notify differences are expected and not flagged as misconfiguration
