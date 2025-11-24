# DHCP-Based Hostname Resolution for Query Logs

## Overview

DNS Query Logs now display client hostnames alongside IP addresses by correlating query log data with DHCP lease information.

## Implementation

### Backend Changes

**File**: `apps/backend/src/technitium/technitium.service.ts`

Added two new private methods:

1. **`getDhcpLeases(node)`**
   - Fetches all DHCP leases from a Technitium DNS node
   - Calls `/api/dhcp/leases/list` endpoint
   - Builds a `Map<string, string>` of IP address → hostname
   - Returns empty map on error (graceful fallback)

2. **`enrichWithHostnames(entries, ipToHostname)`**
   - Takes query log entries and hostname map
   - Adds `clientName` field to entries where hostname is available
   - Preserves original entries if no hostname found

**Modified**: `getQueryLogs()` method
   - Now fetches DHCP leases before returning log data
   - Enriches log entries with hostnames from DHCP
   - Combined logs automatically inherit enrichment (calls `getQueryLogs` internally)

**Types Added**: `apps/backend/src/technitium/technitium.types.ts`
   - `TechnitiumDhcpLease` - DHCP lease structure
   - `TechnitiumDhcpLeaseList` - List wrapper for leases

### Frontend Display

**Already Implemented** (from previous work):

- `LogsPage.tsx` - Client column shows hostname above IP in stacked layout
- `technitiumLogs.ts` - `clientName` field defined in types
- `App.css` - Styling for `.logs-page__client-hostname` and `.logs-page__client-ip`

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│  User requests Query Logs                               │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Backend: getQueryLogs(nodeId, filters)                 │
├─────────────────────────────────────────────────────────┤
│  1. Fetch query logs from Technitium DNS API               │
│  2. Fetch DHCP leases from /api/dhcp/leases/list       │
│  3. Build IP → hostname map from leases                │
│  4. Enrich log entries with clientName field           │
│  5. Return enriched logs                                │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Frontend: LogsPage displays logs                       │
├─────────────────────────────────────────────────────────┤
│  • Shows hostname (bold) above IP (monospace)          │
│  • Filters search both hostname and IP                 │
│  • Fallback to IP only if no hostname                  │
└─────────────────────────────────────────────────────────┘
```

## Data Flow Example

**DHCP Lease**:
```json
{
  "address": "192.168.1.100",
  "hostName": "johns-laptop.local",
  "type": "Dynamic"
}
```

**Query Log Entry (Before Enrichment)**:
```json
{
  "clientIpAddress": "192.168.1.100",
  "qname": "google.com",
  "qtype": "A"
}
```

**Query Log Entry (After Enrichment)**:
```json
{
  "clientIpAddress": "192.168.1.100",
  "clientName": "johns-laptop.local",  ← Added by enrichment
  "qname": "google.com",
  "qtype": "A"
}
```

## Benefits

1. **Better Device Identification** - See "johns-laptop" instead of just "192.168.1.100"
2. **Fast Performance** - Single DHCP API call per log fetch (cached in memory during enrichment)
3. **Graceful Fallback** - Shows IP if hostname unavailable
4. **No DNS Queries** - Avoids reverse DNS lookup overhead
5. **Works for DHCP Clients** - Covers majority of home network devices

## Limitations

1. **DHCP-Only** - Only shows hostnames for devices with DHCP leases
2. **Static IP Devices** - Devices with static IPs won't have hostnames unless manually configured in DHCP reservations
3. **Per-Node Basis** - Each node's logs enriched with that node's DHCP leases (appropriate for this architecture)

## Future Enhancements

Potential improvements:

1. **Caching** - Cache DHCP leases for short period to reduce API calls
2. **Reverse DNS Fallback** - Optionally do PTR queries for non-DHCP IPs
3. **Manual Hostname Map** - Allow user to configure custom IP → hostname mappings
4. **Cross-Node Correlation** - Use combined DHCP data from all nodes

## Testing

**Manual Test Steps**:

1. Start backend and frontend
2. Navigate to Query Logs page
3. Verify hostnames appear for DHCP clients
4. Verify IP-only display for non-DHCP clients
5. Test filtering by hostname and IP
6. Check that both per-node and combined logs show hostnames

**Expected Results**:
- DHCP clients show: `johns-laptop.local` above `192.168.1.100`
- Static IPs show: `192.168.1.1` (no hostname)
- Filter "john" matches by hostname
- Filter "192.168" matches by IP
