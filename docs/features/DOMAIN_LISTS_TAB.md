# Domain Lists Tab Feature

## Overview

A new "Domain Lists" tab has been added to the DNS Tools page, providing a comprehensive view of all domains from Advanced Blocking lists with powerful filtering and regex testing capabilities.

## Features

### 1. Track Last Refresh Times
- Backend now tracks when domain lists were last refreshed for each node
- Timestamp displayed in the UI
- Helps users understand data freshness

### 2. View All Domains
- Displays all domains from all blocklists and allowlists
- Shows whether each domain is in an allow list or block list
- Indicates which list URLs contain each domain
- Shows which groups use each list

### 3. Powerful Filtering
- **Text Search**: Simple substring matching to find domains quickly
- **Type Filter**: Filter by Allow/Block type with counts
- **Regex Filter**: Real-time regex pattern testing with validation
  - Visual feedback (green checkmark for valid, red X for invalid)
  - Error messages for invalid regex patterns
  - Live filtering as you type

### 4. Manual List Refresh
- "Refresh Lists" button to force update domain lists
- Clears cache and re-downloads all lists
- Updates last refresh timestamp

### 5. Source Attribution
- Each domain shows:
  - Source URL(s) where it appears
  - Groups that use each list
  - Clickable links to list sources
  - Multiple sources if domain appears in multiple lists

## API Endpoints

### GET /api/domain-lists/:nodeId/all-domains
Returns all domains from all lists for a node.

**Response:**
```json
{
  "lastRefreshed": "2025-10-31T10:30:00Z",
  "domains": [
    {
      "domain": "example.com",
      "type": "block",
      "sources": [
        {
          "url": "https://example.com/blocklist.txt",
          "groups": ["Default", "Strict"]
        }
      ]
    }
  ]
}
```

### POST /api/domain-lists/:nodeId/refresh
Forces a refresh of all domain lists for a node.

**Response:**
```json
{
  "success": true,
  "message": "Refreshed all lists for node node1"
}
```

## Use Cases

### 1. Regex Expression Builder
Test regex patterns against real domain data:
```
^.*\.google\.(com|net)$
```
Instantly see which domains match your pattern.

### 2. Domain Discovery
Find all variations of a domain:
- Search: "facebook"
- See: facebook.com, m.facebook.com, api.facebook.com, etc.

### 3. List Overlap Analysis
Identify domains that appear in multiple lists or groups.

### 4. Filtering Validation
Test if your domain filtering expressions work as expected before deploying.

## Implementation Details

### Backend Changes
- **DomainListCacheService**:
  - Added `lastRefreshTimes` Map to track refresh timestamps
  - Added `getAllDomains()` method to aggregate all domains
  - Updated `refreshLists()` to record timestamp

- **DomainListController**:
  - Added `/all-domains` endpoint

### Frontend Changes
- **DnsToolsPage**:
  - Added new "Domain Lists" tab
  - Added state for domain data, filters, and validation
  - Added `loadAllDomains()` and `handleRefreshDomains()` functions
  - Added real-time regex validation
  - Added filtered domains memoization for performance

- **Types**:
  - Added `DomainSource` interface
  - Added `AllDomainEntry` interface
  - Added `AllDomainsResponse` interface

### CSS Styles
- Table-based layout with responsive design
- Color-coded allow/block type badges
- Hover effects for better UX
- Mobile-responsive grid layout
- Validation indicators for regex input

## Performance Considerations

- **Pagination**: Displays first 1,000 filtered results to maintain UI responsiveness
- **Memoization**: `filteredDomains` uses React.useMemo to avoid re-filtering on every render
- **Lazy Loading**: Domain data only loaded when tab is activated
- **Efficient Filtering**: Text search and regex applied in-memory on client side

## Mobile Support

The Domain Lists tab is fully responsive:
- Single-column layout on mobile devices
- Touch-friendly controls
- Readable text sizes
- Scrollable table content

## Future Enhancements

Potential improvements for future versions:
1. Export filtered results to CSV/JSON
2. Advanced filtering (by group, by list)
3. Bulk operations (add to group, remove from lists)
4. Comparison between nodes
5. Visual regex pattern builder
6. Domain statistics and analytics
7. Recently added/removed domains tracking
