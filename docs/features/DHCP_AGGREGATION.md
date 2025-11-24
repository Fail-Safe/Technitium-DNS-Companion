# DHCP Lease Aggregation

## Problem

In a multi-node setup where **only some nodes run DHCP**, the original implementation had a limitation:

- **NODE1**: Runs DHCP → Query logs show hostnames ✅
- **NODE2**: No DHCP → Query logs show only IPs ❌

Each node only used **its own** DHCP leases for hostname enrichment, so NODE2's query logs couldn't benefit from NODE1's DHCP data.

## Solution

The backend now **aggregates DHCP leases from ALL configured nodes** before enriching query logs with hostnames.

### Implementation

```typescript
// OLD: Only fetch DHCP from the current node
const ipToHostname = await this.getDhcpLeases(node);

// NEW: Aggregate DHCP from ALL nodes
const ipToHostname = await this.getAllDhcpLeases();
```

The new `getAllDhcpLeases()` method:
1. Fetches DHCP leases from all nodes in parallel
2. Merges results into single IP → hostname mapping
3. Handles failures gracefully (node without DHCP returns empty map)
4. Returns merged data for enrichment

### Result

Now **all nodes show hostnames for DHCP clients**, regardless of which node runs the DHCP server:

- **NODE1**: Shows hostnames from NODE1's DHCP ✅
- **NODE2**: Shows hostnames from NODE1's DHCP ✅ (shared data)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Query Logs Request (for any node)                      │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  getAllDhcpLeases()                                      │
├─────────────────────────────────────────────────────────┤
│  Fetch in parallel from all nodes:                      │
│  ┌─────────────────┐  ┌─────────────────┐              │
│  │ NODE1 DHCP API   │  │ NODE2 DHCP API   │              │
│  │ Returns: Map    │  │ Returns: Empty  │              │
│  └─────────────────┘  └─────────────────┘              │
│                                                          │
│  Merge results:                                         │
│  192.168.1.100 → "laptop.local"                         │
│  192.168.1.101 → "phone.local"                          │
│  192.168.1.102 → "tablet.local"                         │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  enrichWithHostnames()                                   │
├─────────────────────────────────────────────────────────┤
│  Apply merged DHCP data to query log entries            │
│  Works for BOTH NODE1 and NODE2 query logs!               │
└─────────────────────────────────────────────────────────┘
```

## Benefits

### 1. Shared DHCP Data
- Single DHCP server can provide hostnames for all nodes
- No need to run DHCP on every DNS server
- Consistent hostname display across all query logs

### 2. Redundancy
- If one node's DHCP is down, others can still provide data
- Graceful degradation (empty maps don't break enrichment)
- Parallel fetching for speed

### 3. Network Flexibility
- Supports asymmetric configurations (Primary with DHCP, Secondary without)
- Works with any combination of DHCP-enabled/disabled nodes
- No configuration changes needed - automatic aggregation

## Implementation Details

### Code Location

**File**: `apps/backend/src/technitium/technitium.service.ts`

**Methods**:
- `getDhcpLeases(node)`: Fetch from single node (unchanged)
- `getAllDhcpLeases()`: **NEW** - Aggregate from all nodes
- `getQueryLogs(nodeId)`: **UPDATED** - Use aggregated data

### Error Handling

```typescript
private async getDhcpLeases(node): Promise<Map<string, string>> {
  try {
    // ... fetch DHCP leases ...
    return ipToHostname;
  } catch (error) {
    // Node without DHCP or API error
    this.logger.warn(`Failed to fetch DHCP leases from node "${node.id}": ${error}`);
    return new Map(); // Empty map, doesn't break aggregation
  }
}
```

### Merge Strategy

```typescript
private async getAllDhcpLeases(): Promise<Map<string, string>> {
  const allLeases = await Promise.all(
    this.nodeConfigs.map((node) => this.getDhcpLeases(node))
  );

  // Merge all lease maps (later entries override earlier ones)
  const merged = new Map<string, string>();
  for (const leaseMap of allLeases) {
    for (const [ip, hostname] of leaseMap.entries()) {
      merged.set(ip, hostname); // Overwrite if duplicate IP
    }
  }

  return merged;
}
```

**Conflict Resolution**: If multiple nodes return different hostnames for the same IP, the **last node processed wins**. In practice, this rarely matters since DHCP servers coordinate to avoid IP conflicts.

## Performance Impact

### Before (Per-Node DHCP)
```
NODE1 Query Logs Request:
  → Fetch DHCP from NODE1 (~50ms)
  → Enrich logs (~10ms)
  Total: ~60ms

NODE2 Query Logs Request:
  → Fetch DHCP from NODE2 (~5ms, returns empty)
  → Enrich logs (~10ms, no hostnames)
  Total: ~15ms
```

### After (Aggregated DHCP)
```
Any Node Query Logs Request:
  → Fetch DHCP from NODE1 and NODE2 in parallel (~50ms max)
  → Enrich logs (~10ms, all hostnames)
  Total: ~60ms for both nodes
```

**Impact**:
- Nodes with DHCP: Same performance
- Nodes without DHCP: Slightly slower (+50ms) but gain hostname visibility
- Trade-off: Worth it for consistent user experience

### Optimization Potential

Future enhancements could include:
- Cache merged DHCP data for 1-2 minutes (reduce API calls)
- Lazy loading: Only aggregate when query logs requested
- Smart filtering: Only query nodes known to run DHCP

## Testing

### Manual Verification

1. **Check NODE1 query logs** (has DHCP):
   ```
   GET /api/logs/combined

   Expected: Hostnames shown ✅
   ```

2. **Check NODE2 query logs** (no DHCP):
   ```
   GET /api/logs/combined

   Expected: Hostnames shown ✅ (from NODE1's DHCP)
   ```

3. **Verify backend logs** (debug level):
   ```
   # Should see for BOTH nodes:
   "Fetching DHCP leases from all nodes for enrichment"
   "Merged X DHCP leases from Y nodes"
   ```

### Edge Cases Handled

- ✅ **No nodes have DHCP**: Returns empty map, PTR cache fallback works
- ✅ **One node DHCP fails**: Other nodes' data still used
- ✅ **All nodes DHCP fail**: Graceful fallback to PTR cache and IP-only
- ✅ **Duplicate IPs**: Last node wins (rare, usually not a problem)
- ✅ **Node unreachable**: Error logged, doesn't block other nodes

## Backwards Compatibility

This change is **fully backwards compatible**:

- Existing single-node deployments: Works same as before
- Multi-node with all DHCP: No behavior change
- Multi-node with mixed DHCP: **Improved** (now shows hostnames everywhere)

No configuration changes or migrations required.

## Example Scenario

### Your Network Setup

```
NODE1 (192.168.1.5):
  - Technitium DNS Primary
  - DHCP Server ✅
  - Query logs: 1000 entries

NODE2 (192.168.1.7):
  - Technitium DNS Secondary
  - No DHCP ❌
  - Query logs: 800 entries

DHCP Leases (managed by NODE1):
  - 192.168.1.100 → "laptop.local"
  - 192.168.1.101 → "phone.local"
  - 100.64.0.5 → (no DHCP, will use PTR)
```

### Before Fix

**NODE1 Query Logs**:
```
192.168.1.100 → Query for google.com
  Hostname: laptop.local ✅ (from NODE1's DHCP)

100.64.0.5 → Query for github.com
  Hostname: 100.64.0.5 ❌ (just IP, needs PTR)
```

**NODE2 Query Logs**:
```
192.168.1.100 → Query for google.com
  Hostname: 192.168.1.100 ❌ (NODE2 has no DHCP data)

100.64.0.5 → Query for github.com
  Hostname: 100.64.0.5 ❌ (just IP, needs PTR)
```

### After Fix

**NODE1 Query Logs**:
```
192.168.1.100 → Query for google.com
  Hostname: laptop.local ✅ (from aggregated DHCP)

100.64.0.5 → Query for github.com
  Hostname: marks-phone.tail-xxxxx.ts.net ✅ (from PTR cache)
```

**NODE2 Query Logs**:
```
192.168.1.100 → Query for google.com
  Hostname: laptop.local ✅ (from aggregated DHCP - NEW!)

100.64.0.5 → Query for github.com
  Hostname: marks-phone.tail-xxxxx.ts.net ✅ (from PTR cache)
```

Now **both nodes show consistent hostnames** for all client types! 🎉

## Related Documentation

- [PTR Hostname Cache](./PTR_HOSTNAME_CACHE.md) - Main hostname resolution feature
- [Backend README](../../apps/backend/README.md) - API documentation
- [Architecture](../architecture.md) - System design overview
