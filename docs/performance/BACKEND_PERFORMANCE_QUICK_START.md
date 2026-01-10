# Backend Performance Optimization - Quick Start

## Running Baseline Benchmarks

Before any optimizations, establish baseline metrics:

```bash
# From project root
./scripts/run-baseline-benchmarks.sh
```

This will:

- Test cold vs warm requests (no cache)
- Test with/without deduplication
- Test various page sizes
- Measure memory usage
- Output detailed timing metrics

## What Gets Measured

### Automatic (in production logs)

Every `getCombinedQueryLogs` call logs:

```
[BENCHMARK] getCombinedQueryLogs: Total=3847ms, Fetch=2103ms (54.7%), Processing=1744ms (45.3%),
Entries: 200→180→90→50, Nodes=2, Dedup=true
```

This shows:

- **Total** - End-to-end time
- **Fetch** - Time waiting for Technitium DNS nodes
- **Processing** - Time spent deduplicating/filtering/sorting
- **Entries** - Transformation flow: fetched→filtered→deduped→returned
- **Nodes** - Number of nodes queried
- **Dedup** - Whether deduplication is enabled

### Benchmark Tests

The test suite runs:

1. Cold requests (first call, nothing cached)
2. Warm requests (subsequent calls)
3. Large page sizes (100+ entries)
4. Pagination (page 5 with over-fetch issue)
5. With filters (domain/type/response)
6. Memory profiling

Results show min/max/avg/median/stdDev across multiple runs.

## Optimization Phases

Work through these sequentially, benchmarking after each:

### Phase 1: Response Caching

**Goal:** Cache results for 30-60s to avoid hitting nodes repeatedly
**Expected:** 3.8s → 50ms for cached requests (98% improvement)

### Phase 2: Deduplication Optimization

**Goal:** Single-pass algorithm, eliminate redundant sorts
**Expected:** 500ms → 100ms processing time (80% improvement)

### Phase 3: Reduce Over-fetching

**Goal:** Stop fetching 500 entries when only 50 needed
**Expected:** 40-60% reduction in network traffic

### Phase 4: Request Throttling

**Goal:** Prevent duplicate concurrent requests
**Expected:** Better cache hit ratio, reduced CPU usage

## Documentation

See `docs/BACKEND_PERFORMANCE_BENCHMARKING.md` for:

- Complete benchmark results tables
- Detailed optimization plans
- Lessons learned
- Next steps

## Files Changed

- `src/technitium/technitium.benchmark.ts` - Benchmark utilities
- `src/technitium/technitium.benchmark.spec.ts` - Test suite
- `src/technitium/technitium.service.ts` - Added timing instrumentation
- `package.json` - Added `test:benchmark` script
- `docs/BACKEND_PERFORMANCE_BENCHMARKING.md` - Results tracking

## Notes

## Environment Setup

Benchmarks require proper environment configuration:

```bash
# Set node IDs
export TECHNITIUM_NODES='node1,node2'

# Configure NODE1
export TECHNITIUM_NODE1_BASE_URL='https://node1.example.com:53443'
export TECHNITIUM_NODE1_TOKEN='your-node1-token'

# Configure NODE2
export TECHNITIUM_NODE2_BASE_URL='https://node2.example.com:53443'
export TECHNITIUM_NODE2_TOKEN='your-node2-token'
```

Notes:

- The `TECHNITIUM_<NODE>_TOKEN` env vars are legacy-only for Technitium DNS < v14.
- If you normally run with session auth (recommended; required for UI starting in v1.4), you may still need a dedicated, least-privilege token for non-interactive benchmark runs.

**Note:** If you have a `.env` file in `apps/backend/`, it will be loaded automatically.

## Notes

- Both NODE1 and NODE2 must be accessible
- Run with stable network connection for consistent results
- Set `SKIP_BENCHMARKS=true` in CI to skip benchmark tests
- Use `node --expose-gc` for memory profiling
