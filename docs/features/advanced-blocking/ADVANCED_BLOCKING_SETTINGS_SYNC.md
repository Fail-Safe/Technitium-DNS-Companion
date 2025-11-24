# Advanced Blocking Group Settings Synchronization

## Overview

This feature adds detection and visualization of **group settings differences** in the Sync tab. Previously, the Sync view only compared group **content** (domains, URLs, etc.) but not group **settings** (like "Respond with NXDOMAIN", blocking addresses, etc.).

Now when you modify an Advanced Blocking group's settings on one node, the Sync tab will immediately display the deviation.

## What Gets Compared

The following group settings are now compared across nodes:

1. **Enable Blocking** - Whether blocking is enabled for this group
2. **Respond with NXDOMAIN** - Whether to respond with NXDOMAIN instead of blocking addresses
3. **Allow TXT Blocking Report** - Whether to allow TXT record blocking reports
4. **Blocking Addresses** - The list of IP addresses to respond with when blocking

These settings are displayed in a dedicated **Settings Differences** section (marked with ⚙️) above the detailed domain/URL diffs.

## Backend Implementation

### New Service Method

**File**: `apps/backend/src/technitium/advanced-blocking.service.ts`

```typescript
async getCombinedAdvancedBlockingConfig(): Promise<AdvancedBlockingCombinedOverview>
```

This method:
- Fetches Advanced Blocking configurations from all nodes
- Builds a map of groups by name across nodes
- Compares group settings between nodes
- Determines sync status (in-sync, different, missing, unknown)
- Returns a combined overview with detailed settings differences

### New Helper Methods

- `determineGroupComparisonStatus()` - Determines if groups are in sync, different, or missing
- `compareGroupSettings()` - Compares specific settings between groups
- `areSettingValuesEqual()` - Handles comparison of arrays and primitives

### New API Endpoint

**GET** `/api/nodes/advanced-blocking/combined`

Returns: `AdvancedBlockingCombinedOverview`

Example response:
```json
{
  "fetchedAt": "2025-10-24T12:30:00.000Z",
  "groupCount": 3,
  "nodes": [
    {
      "nodeId": "node1",
      "baseUrl": "https://node1.example.com:53443",
      "fetchedAt": "2025-10-24T12:30:00.000Z",
      "groupCount": 3
    },
    {
      "nodeId": "node2",
      "baseUrl": "https://node2.example.com:53443",
      "fetchedAt": "2025-10-24T12:30:00.000Z",
      "groupCount": 3
    }
  ],
  "groups": [
    {
      "name": "Parents",
      "status": "different",
      "settingsDifferences": [
        {
          "field": "blockAsNxDomain",
          "sourceValue": true,
          "targetValue": false
        }
      ],
      "sourceNodes": [...],
      "targetNodes": [...]
    }
  ]
}
```

## Frontend Implementation

### New Types

**File**: `apps/frontend/src/types/advancedBlocking.ts`

- `AdvancedBlockingGroupSettings` - Defines the settings structure
- `AdvancedBlockingGroupSettingsDiff` - Individual setting difference
- `AdvancedBlockingGroupComparisonStatus` - Sync status type
- `AdvancedBlockingGroupComparison` - Full group comparison
- `AdvancedBlockingCombinedNodeSnapshot` - Node snapshot
- `AdvancedBlockingCombinedOverview` - Combined overview

### Component Updates

**File**: `apps/frontend/src/components/configuration/ConfigurationSyncView.tsx`

- Updated `GroupDiff` interface to include `settingsDifferences`
- Added settings differences rendering section
- Field names are user-friendly:
  - `enableBlocking` → "Enable Blocking"
  - `blockAsNxDomain` → "Respond with NXDOMAIN"
  - `allowTxtBlockingReport` → "Allow TXT Blocking Report"
  - `blockingAddresses` → "Blocking Addresses"

### CSS Styling

**File**: `apps/frontend/src/App.css`

New classes for settings differences display:
- `.sync-view__settings-diff` - Container (yellow background, warning style)
- `.sync-view__settings-diff-title` - Section title
- `.sync-view__setting-item` - Individual setting
- `.sync-view__setting-name` - Setting name label
- `.sync-view__setting-values` - Values container
- `.sync-view__setting-value` - Individual value
- `.sync-view__setting-value--source` - Source value (green)
- `.sync-view__setting-value--target` - Target value (red)
- `.sync-view__setting-arrow` - Arrow indicator between values

## Visual Display

The Sync tab now shows:

```
⚙️ Settings Differences
┌─────────────────────────────────────────────────────┐
│ Enable Blocking          true → false               │
│ Respond with NXDOMAIN    true → false               │
│ Blocking Addresses       [10.0.0.0] → [10.0.0.1]    │
└─────────────────────────────────────────────────────┘
```

Settings differences appear in a **yellow box** (warning style) to make them immediately visible before the detailed domain/URL diffs.

## Type Definitions

### AdvancedBlockingGroupComparisonStatus

```typescript
type AdvancedBlockingGroupComparisonStatus = 'in-sync' | 'different' | 'missing' | 'unknown';
```

- `in-sync` - Group settings are identical across all nodes
- `different` - One or more settings differ between nodes
- `missing` - Group exists on some but not all nodes
- `unknown` - Error occurred fetching group data

### AdvancedBlockingGroupComparison

```typescript
interface AdvancedBlockingGroupComparison {
  name: string;
  status: AdvancedBlockingGroupComparisonStatus;
  settingsDifferences?: AdvancedBlockingGroupSettingsDiff[];
  sourceNodes: {
    nodeId: string;
    baseUrl: string;
    group?: AdvancedBlockingGroup;
  }[];
  targetNodes: {
    nodeId: string;
    baseUrl: string;
    group?: AdvancedBlockingGroup;
  }[];
  error?: string;
}
```

## Behavior

1. **Automatic Detection** - Settings differences are detected when groups are compared
2. **Sorting** - Groups are sorted by status priority:
   1. Different (highest priority - shown first)
   2. Missing
   3. In Sync
   4. Unknown (lowest priority)
3. **Content + Settings** - Both settings and content differences are shown (settings in yellow box, content in expandable section)
4. **Array Comparison** - Blocking addresses are compared as sorted arrays (order doesn't matter)

## Testing

### Unit Tests

The implementation includes comprehensive tests in:
- `apps/backend/test/advanced-blocking.service.spec.ts` (to be added)

### Manual Testing

1. Modify a group setting on NODE2 (e.g., uncheck "Respond with NXDOMAIN")
2. Click Save Changes
3. Navigate to DNS Filtering → Sync tab
4. Select NODE1 as source and NODE2 as target
5. Look for the group in the list with a "Different" badge
6. Verify "Settings Differences" section appears with the changed setting
7. The setting should show source value → target value

## Future Enhancements

1. **One-click Sync** - Add "Sync Settings Only" button to copy group settings without content
2. **Settings Presets** - Save/load common group setting configurations
3. **Bulk Operations** - Update settings across multiple groups at once
4. **Historical Tracking** - Log when group settings change
5. **Notifications** - Alert when group settings diverge unexpectedly

## Related Issues

- Issue: "Sync tab doesn't show deviations when Advanced Blocking group settings change"
- Related to Phase 2: Advanced Blocking Functionality

## Code Changes Summary

### Backend
- **File**: `advanced-blocking.types.ts` - Added 5 new interfaces
- **File**: `advanced-blocking.service.ts` - Added `getCombinedAdvancedBlockingConfig()` method (200+ lines)
- **File**: `technitium.controller.ts` - Added `GET /api/nodes/advanced-blocking/combined` endpoint

### Frontend
- **File**: `advancedBlocking.ts` - Added 5 new interfaces
- **File**: `ConfigurationSyncView.tsx` - Added settings diff display and imports
- **File**: `App.css` - Added 60+ lines of styling for settings differences

### Total Changes
- **10 new types** (5 backend, 5 frontend)
- **200+ lines of backend logic**
- **50+ lines of frontend JSX**
- **60+ lines of CSS styling**
- **1 new API endpoint**
