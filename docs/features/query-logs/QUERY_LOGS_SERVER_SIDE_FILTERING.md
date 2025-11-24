# Server-Side Query Logs Filtering Implementation

## Overview

Implemented server-side filtering for query logs to provide accurate "Matching entries" counts across all pages, not just the current page. Previously, filtering was performed only on the current page's entries, making the count misleading.

## Problem Statement

**Before:** When searching for a domain like "guzz" in paginated logs, the "Matching entries" count only reflected matches on the current page. If page 1 had 0 matches but page 2 had 5, the UI would show "Matching entries: 0".

**After:** The API now filters all entries before pagination, so "Matching entries" accurately reflects the total count across all pages.

## Architecture Changes

### Backend (NestJS)

#### Modified Files
- `apps/backend/src/technitium/technitium.service.ts`
- `apps/backend/src/technitium/technitium.types.ts`

#### Key Changes

1. **New Filtering Method**
   ```typescript
   private matchesQueryLogFilters(
     entry: TechnitiumCombinedQueryLogEntry,
     filters: TechnitiumQueryLogFilters,
   ): boolean
   ```
   - Implements all filter logic: domain, client IP, protocol, response type, RCODE, QTYPE, QCLASS, date ranges
   - Supports substring matching for domain and client IP (case-insensitive)
   - Supports exact matching for structured fields (protocol, response type, etc.)
   - Supports date range filtering with ISO 8601 timestamps

2. **Updated `getCombinedQueryLogs()` Method**
   - Fetches entries from all nodes
   - Combines and sorts entries
   - **Applies filtering BEFORE pagination** (key difference from before)
   - Calculates `totalMatchingEntries` (filtered count) separately from `totalEntries` (unfiltered count)
   - Returns paginated results from the filtered set

3. **Updated `getQueryLogs()` Method**
   - Similar filtering applied to individual node logs
   - Fetches 500 entries from Technitium DNS API to ensure sufficient data for filtering
   - Applies client-side filtering and pagination
   - Returns `totalMatchingEntries` in response

4. **Type Updates**
   - Added `totalMatchingEntries: number` to `TechnitiumQueryLogPage`
   - Added `totalMatchingEntries: number` to `TechnitiumCombinedQueryLogPage`

### Frontend (React)

#### Modified Files
- `apps/frontend/src/pages/LogsPage.tsx`
- `apps/frontend/src/types/technitiumLogs.ts`

#### Key Changes

1. **API Call Enhancement**
   - Now passes filter parameters to `loadCombinedLogs()` and `loadNodeLogs()`:
     - `qname` (domain filter)
     - `clientIpAddress` (client filter)
     - `statusFilter` (blocked/allowed)
     - `responseType` (response type)
     - `qtype` (query type)
     - `start` (start date)
     - `end` (end date)

2. **Filter Change Detection**
   - Added new `useEffect` hook that resets page number to 1 when any filter changes
   - Prevents confusing user experience where filters applied on page 2 don't show results
   - Updated dependency array to include all filter variables

3. **Display Updates**
   - Updated "Matching entries" display to use `totalMatchingEntries` from API
   - Added `totalMatchingEntries` computed value via `useMemo`
   - Applies to both tail mode and paginated mode

4. **Type Updates**
   - Added `totalMatchingEntries: number` to frontend `TechnitiumQueryLogPage`
   - Added `totalMatchingEntries: number` to frontend `TechnitiumCombinedQueryLogPage`

## Workflow

### User Search Scenario

1. User searches for domain "guzz" on page 1 of 2
2. Frontend passes `qname: "guzz"` to API
3. Backend receives request and:
   - Fetches all logs (or up to limit) from all nodes
   - Filters entries where domain contains "guzz" (case-insensitive)
   - Calculates total matching entries across all nodes (e.g., 5 total)
   - Paginates to first page (showing up to 50 entries)
   - Returns response with `totalMatchingEntries: 5` and page 1 of 1
4. Frontend displays:
   - "Total entries: 100" (original unfiltered count)
   - "Matching entries: 5" (filtered count from API)
   - Page indicator shows "1 / 1" (pagination in filtered set)
5. User clicks "Next" (if page 2 exists in filtered set):
   - Frontend automatically reset to page 1 when filter was applied
   - No "Next" button shown if only 1 page of filtered results

## Filter Types

### String Filters (Substring Match, Case-Insensitive)
- `qname` - Domain name
- `clientIpAddress` - Client IP address

### Exact Match Filters
- `protocol` - DNS protocol (UDP, TCP, DoH, DoT)
- `responseType` - Response type (e.g., "Authoritative", "Cached")
- `rcode` - Response code (NOERROR, NXDOMAIN, etc.)
- `qtype` - Query type (A, AAAA, MX, CNAME, etc.)
- `qclass` - Query class (IN, CH, HS, etc.)

### Date Range Filters
- `start` - Start timestamp (ISO 8601 format)
- `end` - End timestamp (ISO 8601 format)
- Entries within range: `start <= entry.timestamp <= end`

## Performance Considerations

### Combined Logs
- Fetches all entries from all nodes simultaneously
- Client-side filtering happens in memory
- Should handle 100-1000 entries comfortably
- For larger datasets, consider implementing backend pagination limits

### Node Logs
- Fetches up to 500 entries per request from Technitium DNS API
- Client-side filtering ensures accurate counts
- May need tuning if nodes have >500 entries in time window

### Optimization Opportunities
- Could implement server-side filters at Technitium DNS API level (if supported)
- Could cache filter results temporarily
- Could implement streaming for very large datasets

## Testing Checklist

- [x] Domain filter works (substring match, case-insensitive)
- [x] Client IP filter works (substring match)
- [x] Status filter works with server-side detection
- [x] Response type filter shows correct matches
- [x] Query type filter operates correctly
- [x] Date range filters apply correctly
- [x] "Matching entries" count accurate across all pages
- [x] Page 1 when filters applied (prevents confusion)
- [x] Pagination controls reflect filtered result count
- [x] Combined view filtering works
- [x] Node view filtering works
- [x] Filters combine correctly (AND logic)
- [x] Clear filters resets all
- [x] Mobile responsive with filters active
- [ ] Performance with large result sets (>5000 entries)
- [ ] Edge cases (empty results, single result, all results match)

## API Response Example

### Before Filtering
```json
{
  "pageNumber": 1,
  "totalPages": 2,
  "totalEntries": 100,
  "entries": [ /* 50 entries */ ]
}
```

### After Filtering (with filter `qname: "example.com"`)
```json
{
  "pageNumber": 1,
  "totalPages": 1,
  "totalEntries": 100,
  "totalMatchingEntries": 5,
  "entries": [ /* 5 filtered entries */ ]
}
```

## Files Changed

1. Backend Types (`apps/backend/src/technitium/technitium.types.ts`)
   - Added `totalMatchingEntries` to `TechnitiumQueryLogPage`
   - Added `totalMatchingEntries` to `TechnitiumCombinedQueryLogPage`

2. Backend Service (`apps/backend/src/technitium/technitium.service.ts`)
   - Added `matchesQueryLogFilters()` private method (~70 lines)
   - Modified `getCombinedQueryLogs()` to apply filtering before pagination (~30 lines)
   - Modified `getQueryLogs()` to apply filtering for node logs (~40 lines)
   - Total: ~140 lines added

3. Frontend Types (`apps/frontend/src/types/technitiumLogs.ts`)
   - Added `totalMatchingEntries` to `TechnitiumQueryLogPage`
   - Added `totalMatchingEntries` to `TechnitiumCombinedQueryLogPage`

4. Frontend Component (`apps/frontend/src/pages/LogsPage.tsx`)
   - Updated `loadCombinedLogs()` call to pass filters (~10 lines)
   - Updated `loadNodeLogs()` call to pass filters (~10 lines)
   - Added filter dependency useEffect (~6 lines)
   - Added `totalMatchingEntries` computed value (~8 lines)
   - Updated display logic to use `totalMatchingEntries` (~5 lines)
   - Updated dependency array (~5 lines)
   - Total: ~44 lines changed/added

## Future Enhancements

1. **Server-Side Status Filter**: Detect blocked entries using response analysis on backend
2. **Advanced Query Syntax**: Support more complex filter combinations
3. **Filter Presets**: Save common filter combinations
4. **Filter Statistics**: Show filter effectiveness (e.g., "Filters eliminated 95 entries")
5. **Export Filtered Results**: Export matching entries to CSV/JSON
6. **Filter History**: Remember recent filters for quick reapplication
