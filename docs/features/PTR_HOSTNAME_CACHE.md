# PTR Hostname Resolution Cache

## Overview

The backend now maintains a **hot cache** of IP address → hostname mappings using a combination of DHCP data and periodic reverse DNS (PTR) lookups. This provides comprehensive hostname visibility for all types of clients, including:

- Local DHCP clients (immediate, from lease data)
- Static IP devices (resolved via PTR)
- Tailscale/VPN clients (resolved via PTR)
- External/remote devices (resolved via PTR if configured)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Query Logs Request                                      │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  enrichWithHostnames()                                   │
├─────────────────────────────────────────────────────────┤
│  For each client IP:                                     │
│  1. Track IP in recentClientIps set                     │
│  2. Priority 1: Check DHCP lease data (instant)         │
│  3. Priority 2: Check hostname cache (PTR results)      │
│  4. Return enriched entry or IP-only                    │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Background Process (Every 5 minutes)                    │
├─────────────────────────────────────────────────────────┤
│  1. Take snapshot of recentClientIps                    │
│  2. Limit to 50 IPs per cycle                           │
│  3. Perform PTR lookups via Technitium DNS client       │
│  4. Cache results for 10 minutes                        │
│  5. Log successes at debug level                        │
└─────────────────────────────────────────────────────────┘
```

## Configuration

All constants are configurable at the top of `TechnitiumService`:

```typescript
// Cache TTL: How long to keep PTR results
private readonly HOSTNAME_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Lookup interval: How often to run PTR resolution cycle
private readonly PTR_LOOKUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Rate limiting: Max PTR queries per cycle
private readonly MAX_PTR_LOOKUPS_PER_CYCLE = 50;
```

### Recommended Settings

**For home networks (default)**:
- Cache TTL: 10 minutes (devices rarely change hostnames)
- Lookup interval: 5 minutes (balance freshness vs load)
- Max per cycle: 50 IPs (plenty for typical home network)

**For larger/busier networks**:
- Cache TTL: 5 minutes (more dynamic)
- Lookup interval: 2-3 minutes (fresher data)
- Max per cycle: 100-200 IPs (handle more clients)

**For development/testing**:
- Cache TTL: 1 minute (see changes quickly)
- Lookup interval: 30 seconds (rapid testing)
- Max per cycle: 10 IPs (debug individual lookups)

## Implementation Details

### Hostname Resolution Priority

1. **DHCP Leases** (Highest Priority)
   - Instant lookup from DHCP data **aggregated from ALL nodes**
   - Most reliable for local devices
   - Always used first if available
   - **Multi-node benefit**: Nodes without DHCP can use other nodes' lease data
     - Example: NODE1 runs DHCP, NODE2 doesn't → Both show hostnames from NODE1's leases

2. **PTR Cache** (Fallback)
   - Results from previous PTR lookups
   - Used if DHCP data not available
   - Respects cache TTL (10 min default)

3. **IP Only** (No Resolution)
   - Falls back to showing just IP address
   - Happens if no DHCP data and no cached PTR result

### DHCP Lease Aggregation

**Multi-Node DHCP Support**:
- Fetches DHCP leases from **all configured nodes** in parallel
- Merges results into a single IP → hostname mapping
- Enables nodes without DHCP to show hostnames for DHCP clients

**Use Case**:
```
Network Setup:
- NODE1: Runs DHCP (Primary DNS + DHCP server)
- NODE2: No DHCP (Secondary DNS only)

Behavior:
- NODE1 query logs: Show hostnames from NODE1's DHCP ✅
- NODE2 query logs: Show hostnames from NODE1's DHCP ✅ (shared data)
- Both nodes benefit from single DHCP server
```

**Error Handling**:
- If a node's DHCP fetch fails, returns empty map (doesn't block others)
- Failures logged as warnings
- Graceful degradation: Other nodes' DHCP data still used

### PTR Lookup Process

**Sampling Strategy**:
- IPs are collected from query log entries as they're processed
- Each unique IP is added to `recentClientIps` set
- Every 5 minutes, the set is processed and then cleared

**DNS Resolution**:
- Uses Technitium's `/api/dnsClient/resolve` endpoint
- Queries the DNS server itself (`server: 'this-server'`)
- Converts IP to PTR format: `192.168.1.1` → `1.1.168.192.in-addr.arpa`
- 5-second timeout per lookup to prevent hangs

**Caching Logic**:
- Skip lookup if cache entry is still fresh (< 10 min old)
- Store successful results with timestamp and source
- Cache persists in memory (cleared on server restart)

### IPv6 Support

Currently **IPv4 only**. IPv6 PTR lookups are more complex (require full address expansion and nibble reversal). Future enhancement:

```
2001:db8::1 → 1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa
```

## Data Structures

### Hostname Cache Entry
```typescript
interface HostnameCacheEntry {
  hostname: string;           // Resolved hostname
  lastUpdated: number;        // Unix timestamp (ms)
  source: 'dhcp' | 'ptr';     // How was this resolved?
}
```

### In-Memory State
```typescript
// Main cache: IP → hostname data
private readonly hostnameCache = new Map<string, HostnameCacheEntry>();

// Sampling: IPs seen in query logs (cleared each cycle)
private readonly recentClientIps = new Set<string>();

// Timer: Periodic PTR lookup job
private ptrLookupTimer?: NodeJS.Timeout;
```

## Example Scenarios

### Scenario 1: Local DHCP Client

```
Client: johns-laptop (192.168.1.100)
DHCP Lease: Yes
PTR Record: Maybe

Resolution:
1. Query log shows 192.168.1.100
2. DHCP data has: 192.168.1.100 → "johns-laptop.local"
3. Result: "johns-laptop.local" (from DHCP, instant)
4. IP added to recentClientIps for future PTR lookup
```

### Scenario 2: Tailscale Client (First Seen)

```
Client: marks-phone-tailscale (100.64.0.5)
DHCP Lease: No (not managed by local DHCP)
PTR Record: Yes (Tailscale provides)

Resolution Pass 1 (First Query):
1. Query log shows 100.64.0.5
2. No DHCP data
3. No cache entry yet
4. Result: "100.64.0.5" (IP only)
5. IP added to recentClientIps

Background Process (5 min later):
1. PTR lookup: 100.64.0.5 → "marks-phone.tail-xxxxx.ts.net"
2. Cache stored: { hostname: "marks-phone.tail-xxxxx.ts.net", ... }

Resolution Pass 2 (Next Query):
1. Query log shows 100.64.0.5
2. No DHCP data
3. Cache hit: "marks-phone.tail-xxxxx.ts.net"
4. Result: "marks-phone.tail-xxxxx.ts.net" (from cache)
```

### Scenario 3: Static IP Device

```
Client: nas.local (192.168.1.10)
DHCP Lease: No (static IP)
PTR Record: Yes (manually configured in DNS)

Resolution:
1. Query log shows 192.168.1.10
2. No DHCP data
3. Background PTR lookup resolves to "nas.local"
4. Subsequent queries show: "nas.local" (from cache)
```

## Performance Characteristics

### Memory Usage

**Per IP**:
- Hostname cache entry: ~100-200 bytes
- Recent IPs set entry: ~20 bytes

**Typical home network** (100 unique IPs over 10 min):
- Cache: ~20 KB
- Recent IPs: ~2 KB
- **Total: ~22 KB** (negligible)

### Network Load

**Per PTR Lookup**:
- 1 DNS query (UDP, typically < 100 bytes)
- 1 DNS response (UDP, typically < 200 bytes)

**Default Configuration** (50 IPs every 5 minutes):
- ~50 DNS queries per cycle
- ~10 queries per minute average
- **Minimal impact** on DNS server

### Latency Impact

- **DHCP lookups**: 0 ms (in-memory map)
- **Cache hits**: 0 ms (in-memory map)
- **Cache misses**: 0 ms (display IP, resolve in background)
- **No blocking** of query log responses

## Logging

### Log Levels

**Info**: Service lifecycle
```
Starting periodic PTR hostname resolution
Stopped periodic PTR lookups
```

**Debug**: Per-cycle and per-lookup details
```
Running PTR lookup cycle for 23 IPs
Resolved 192.168.1.100 → johns-laptop.local via PTR
Skipping IPv6 PTR lookup for 2001:db8::1
PTR lookup failed for 192.168.1.99: NXDOMAIN
```

**Warn**: Unexpected errors
```
PTR lookup cycle failed: Connection timeout
Failed to fetch DHCP leases from node "node1": 500 Internal Server Error
```

### Debugging PTR Lookups

To see detailed PTR activity, set log level to DEBUG:

```bash
# In NestJS app
LOG_LEVEL=debug npm run start:dev
```

You'll see:
- Which IPs are being looked up each cycle
- Successful resolutions with hostnames
- Failed lookups (normal for IPs without PTR records)
- Skipped lookups (IPv6, fresh cache entries)

## Limitations & Considerations

### Current Limitations

1. **IPv4 Only**: IPv6 PTR lookups not yet implemented
2. **Memory-Only Cache**: Cache cleared on server restart
3. **Single Node Resolution**: Only uses first configured node for PTR lookups
4. **No Manual Overrides**: Can't manually specify IP → hostname mappings (yet)

### Why PTR Lookups Might Fail

PTR lookups can legitimately fail for many reasons:

- **No PTR Record**: Many IPs don't have reverse DNS configured
- **Private IPs**: RFC1918 addresses (192.168.x.x) often lack PTR records
- **DNS Timeouts**: Remote DNS servers may be slow or unreachable
- **Permissions**: Reverse DNS zones may restrict queries
- **DNSSEC**: DNSSEC validation failures can block PTR responses

**This is expected and normal**. The system gracefully falls back to showing just the IP address.

### Security Considerations

- **DNS Spoofing**: PTR records can be controlled by external parties
- **Privacy**: Hostnames may reveal device information
- **Trust**: DHCP leases (local) are more trustworthy than PTR (potentially external)

For sensitive environments, consider:
- Only enabling PTR for trusted IP ranges
- Validating hostnames before display
- Using DNSSEC-validated responses only

## Testing

### Manual Testing

1. **View Query Logs**: Check that local DHCP clients show hostnames immediately
2. **Add Tailscale Client**: Watch logs, hostname should appear after 5-10 minutes
3. **Check Cache**: Look for DEBUG logs showing successful PTR resolutions
4. **Restart Server**: Verify cache rebuilds correctly on restart

### Verification Queries

**Check if an IP has a PTR record**:
```bash
dig -x 192.168.1.1
# or
host 192.168.1.1
```

**Monitor backend logs for PTR activity**:
```bash
# Terminal 1: Run backend with debug logging
LOG_LEVEL=debug npm run start:dev

# Terminal 2: Watch for PTR-related logs
tail -f /path/to/logs | grep -i ptr
```

## Future Enhancements

### Planned Improvements

1. **IPv6 Support**: Full PTR lookup support for IPv6 addresses
2. **Persistent Cache**: Store cache to disk/Redis for survival across restarts
3. **Manual Overrides**: Allow admin to manually specify IP → hostname mappings
4. **Configurable API**: Expose cache configuration via API/UI
5. **Statistics**: Track cache hit rates, PTR success rates, etc.
6. **DNSSEC Validation**: Only cache DNSSEC-validated PTR records
7. **Selective Resolution**: Only perform PTR for specific IP ranges
8. **Multi-Node Resolution**: Use multiple nodes for redundancy

### Possible Configuration UI

Future UI could include:
- Enable/disable PTR lookups
- Set cache TTL and lookup interval
- View cache contents and statistics
- Manually add/edit IP → hostname mappings
- Configure IP ranges for PTR resolution
- Test PTR lookup for specific IP

## Migration Notes

### Upgrading from DHCP-Only Resolution

**Before**: Only DHCP clients showed hostnames
**After**: All devices with PTR records show hostnames (after 5-10 min)

**Action Required**: None, works automatically

**Expected Behavior**:
1. First few minutes: Only DHCP clients show hostnames (as before)
2. After 5-10 minutes: Tailscale, static IPs, etc. start showing hostnames
3. Cache warms up over time as more IPs are encountered

### Downgrading

If you need to disable PTR lookups:

1. Comment out `this.startPeriodicPtrLookups()` in constructor
2. System will fall back to DHCP-only resolution
3. No data loss, just fewer hostnames displayed

## Summary

The PTR hostname cache provides **best-of-both-worlds** hostname resolution:

✅ **Instant** resolution for DHCP clients (local devices)
✅ **Automatic** resolution for non-DHCP clients (Tailscale, static IPs)
✅ **Efficient** background processing (no blocking, minimal load)
✅ **Resilient** to failures (graceful fallback to IP display)
✅ **Configurable** timing and rate limits

Perfect for home networks with a mix of:
- Regular DHCP clients (laptops, phones, tablets)
- Static IP servers (NAS, Pi-hole, etc.)
- VPN clients (Tailscale, WireGuard, etc.)
- IoT devices (may or may not have hostnames)
