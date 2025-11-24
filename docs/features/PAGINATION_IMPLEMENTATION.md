# Domain Lists Pagination Implementation

## Overview

Implemented server-side pagination and filtering for the Domain Lists feature to resolve critical performance issues with large blocklists (1.7M+ domains). This eliminates the need to load entire datasets into browser memory and provides instant, responsive search functionality.

## Problem Statement

**Before Pagination**:
- API returned entire dataset: 1.7M domains = 357MB JSON response
- Network transfer: 9.89s (6.60s content download)
- Client-side filtering on 1.7M records
- Render times: 2364ms, 1442ms, 865ms per render
- Typing in search input was laggy and sluggish
- Browser memory usage exceeded 400MB

**Performance Impact**: Unusable for large blocklists

## Solution Architecture

### Backend Changes

**Controller** (`apps/backend/src/technitium/domain-list-cache.controller.ts`):
```typescript
@Get(':nodeId/all-domains')
async getAllDomains(
  @Param('nodeId') nodeId: string,
  @Query('search') search?: string,
  @Query('searchMode') searchMode?: 'text' | 'regex',
  @Query('type') type?: 'all' | 'allow' | 'block',
  @Query('page') page?: string,
  @Query('limit') limit?: string,
)
```

**Query Parameters**:
- `search` (optional): Search term to filter domains
- `searchMode` (optional): `'text'` or `'regex'` - search mode
- `type` (optional): `'all'`, `'allow'`, or `'block'` - filter by domain type
- `page` (optional): Page number (default: 1)
- `limit` (optional): Results per page (default: 1000)

**Service** (`apps/backend/src/technitium/domain-list-cache.service.ts`):
- Server-side type filtering
- Server-side search (text substring match or regex)
- Pagination calculation with metadata
- Returns structure:
  ```typescript
  {
    lastRefreshed: Date | null,
    domains: AllDomainEntry[], // Max 1000 per page
    pagination: {
      page: number,
      limit: number,
      total: number,
      totalPages: number
    }
  }
  ```

### Frontend Changes

**State Management** (`apps/frontend/src/pages/DnsToolsPage.tsx`):
```typescript
const [currentPage, setCurrentPage] = useState(1);
const [totalPages, setTotalPages] = useState(0);
const [totalDomains, setTotalDomains] = useState(0);
const [pageSize] = useState(1000);
```

**API Integration**:
- `loadAllDomains(page)` now accepts page parameter
- Builds URLSearchParams with search, searchMode, type, page, limit
- Updates pagination state from response
- No more client-side filtering (removed filteredDomains useMemo)

**Debounced Search**:
```typescript
React.useEffect(() => {
  if (activeTab !== 'domains' || !selectedNodeId) return;

  const timeoutId = setTimeout(() => {
    setCurrentPage(1); // Reset to page 1 on new search
    loadAllDomains(1);
  }, 400); // 400ms debounce

  return () => clearTimeout(timeoutId);
}, [searchFilter, searchMode, typeFilter, selectedNodeId, activeTab]);
```

**Pagination UI**:
- Info section: "Showing X - Y of Z domains"
- Controls: First | Previous | Page X of Y | Next | Last
- Buttons disabled when at boundaries or loading
- Mobile-responsive layout (stacks vertically)

**CSS Additions** (`apps/frontend/src/pages/DnsToolsPage.css`):
- `.dns-tools__pagination` - flex container
- `.dns-tools__pagination-info` - domain count display
- `.dns-tools__pagination-controls` - button group
- `.dns-tools__pagination-button` - individual buttons with hover states
- Dark mode support
- Mobile responsive (< 768px width)

## Performance Improvements

**Expected Results**:
- **Network Transfer**: 357MB → ~200KB (99.9% reduction)
- **API Response Time**: 9.89s → < 500ms (95% reduction)
- **Render Time**: 2364ms → < 100ms (96% reduction)
- **Memory Usage**: 400MB+ → < 50MB (87% reduction)
- **Search Responsiveness**: Sluggish → Instant (400ms debounce)
- **Typing Lag**: Eliminated (no client-side filtering)

## User Experience

### Search Behavior:
1. User types in search input
2. 400ms debounce delay (prevents API calls on every keystroke)
3. Backend filters domains on server
4. Returns max 1000 matching results
5. Frontend displays results immediately
6. Pagination controls show total match count

### Pagination Behavior:
1. User clicks pagination button (First/Previous/Next/Last)
2. Loading state disables buttons
3. API call with new page number
4. Results displayed with updated pagination info
5. Buttons re-enabled

### Filter Behavior:
1. User changes type filter (All/Allow/Block)
2. Resets to page 1 automatically
3. Backend filters by type
4. Results displayed with pagination

## Edge Cases Handled

1. **Empty Results**: Shows "No domains to display"
2. **Regex Errors**: Backend catches and returns empty array
3. **Invalid Page Numbers**: Defaults to page 1
4. **No Config**: Returns empty array with zero pagination
5. **Loading States**: Buttons disabled during API calls
6. **Filter Changes**: Auto-reset to page 1

## Migration Notes

### Breaking Changes:
- `AllDomainsResponse` interface now includes `pagination` field
- Client-side filtering removed (done server-side)
- Type counts now reflect current page, not totals

### Backward Compatibility:
- API endpoint path unchanged: `/api/domain-lists/:nodeId/all-domains`
- Query parameters are optional (defaults provide same behavior)
- Response structure extended (not modified)

## Testing Recommendations

1. **Performance Testing**:
   - Load Domain Lists tab with 1.7M domains
   - Measure API response time (should be < 500ms)
   - Measure render time (should be < 100ms)
   - Test typing in search input (should be instant, no lag)

2. **Functional Testing**:
   - Test text search with various terms
   - Test regex search with complex patterns
   - Test type filtering (All/Allow/Block)
   - Test pagination buttons (First/Previous/Next/Last)
   - Test edge case: invalid regex
   - Test edge case: no results
   - Test edge case: single page of results

3. **UI Testing**:
   - Verify pagination controls display correctly
   - Verify mobile responsive layout (< 768px width)
   - Verify dark mode styling
   - Verify button disabled states
   - Verify loading indicators

4. **Integration Testing**:
   - Verify debounced search (400ms delay)
   - Verify filter changes reset to page 1
   - Verify pagination persists during tab switches
   - Verify refresh button reloads current page

## Future Enhancements

1. **Total Type Counts**: Backend could return type-specific totals in pagination metadata
2. **Jump to Page**: Input field to jump directly to specific page
3. **Configurable Page Size**: Allow user to choose 100/500/1000/5000 results per page
4. **Virtual Scrolling**: Replace pagination with infinite scroll for mobile
5. **Search History**: Save recent searches with localStorage
6. **Export Results**: Allow exporting filtered results as CSV/JSON
7. **Bulk Operations**: Select domains across pages for bulk actions

## Related Documentation

- See `docs/ui/UI_QUICK_REFERENCE.md` for UI component patterns
- See `docs/architecture.md` for system architecture
- See `apps/backend/README.md` for API documentation
- See `apps/frontend/README.md` for frontend architecture

## Implementation Date

2025-01-XX - Initial pagination implementation

## Contributors

- GitHub Copilot (implementation)
- User (requirements, testing, feedback)
