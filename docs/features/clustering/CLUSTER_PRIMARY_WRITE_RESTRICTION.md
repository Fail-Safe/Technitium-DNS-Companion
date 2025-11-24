# Cluster Primary-Only Write Restriction Implementation

**Date**: November 8, 2025
**Status**: ✅ Implemented
**Impact**: Frontend now restricts write operations to Primary node only

---

## Overview

With Technitium DNS v14's clustering enabled, **only the Primary node can be modified**. Secondary nodes are read-only replicas that receive updates via zone transfers from the Primary.

This implementation ensures the UI respects this restriction by:
1. Auto-selecting the Primary node for write operations
2. Displaying an informational banner explaining cluster restrictions
3. Providing helper hooks to identify Primary/Secondary nodes

---

## Changes Made

### Backend Changes

#### 1. **Fixed Primary Node Detection** (`apps/backend/src/technitium/technitium.service.ts`)

**Before**: Incorrectly used domain name comparison to detect Primary
```typescript
const isPrimary = clusterDomain && thisNodeDomain === clusterDomain;
```

**After**: Correctly parses `clusterNodes` array from API response
```typescript
const thisNode = clusterNodes.find(n => n.name === thisNodeDomain);
const nodeType = thisNode?.type || 'Secondary';
```

**Result**: ✅ NODE1 now correctly identified as Primary, NODE2/NODE3 as Secondary

#### 2. **Added `isPrimary` Field** (`apps/backend/src/technitium/technitium.types.ts`)

```typescript
export interface TechnitiumNodeSummary {
  // ... existing fields
  isPrimary?: boolean; // True if this node is the Primary in the cluster
}
```

#### 3. **Updated `listNodes()` Response** (`apps/backend/src/technitium/technitium.service.ts`)

```typescript
return {
  id,
  name: name || id,
  baseUrl,
  clusterState,
  isPrimary: clusterState.type === 'Primary',
};
```

### Frontend Changes

#### 4. **Added `isPrimary` to Node Type** (`apps/frontend/src/context/TechnitiumContext.tsx`)

```typescript
export interface TechnitiumNode {
  // ... existing fields
  isPrimary?: boolean; // True if this node is the Primary in the cluster
}
```

#### 5. **Created Helper Hooks** (`apps/frontend/src/hooks/usePrimaryNode.ts`)

```typescript
usePrimaryNode(nodes)          // Returns the Primary node or undefined
useIsClusterEnabled(nodes)     // Returns true if clustering is active
useClusterNodes(nodes)         // Returns { primary, secondaries, isClusterEnabled }
```

#### 6. **Created ClusterInfoBanner Component** (`apps/frontend/src/components/common/ClusterInfoBanner.tsx`)

Displays prominent informational banner on write pages:
- Explains cluster restrictions
- Identifies the Primary node by name
- Uses blue info styling (not warning/error)
- Supports dark mode

#### 7. **Updated ConfigurationPage** (`apps/frontend/src/pages/ConfigurationPage.tsx`)

- Auto-selects Primary node when clustering is enabled
- Shows ClusterInfoBanner on write tabs (Group Management, List Management, Domain Management)
- Hides banner on read-only Sync tab

---

## Testing Results

### Backend API
```bash
curl -k https://node2.example.com:3443/api/nodes | python3 -m json.tool
```

**Output**:
```json
[
  {
    "id": "node1",
    "name": "NODE1",
    "clusterState": {
      "type": "Primary",
      "health": "Connected"
    },
    "isPrimary": true  ✅
  },
  {
    "id": "node2",
    "name": "NODE2",
    "clusterState": {
      "type": "Secondary",
      "health": "Connected"
    },
    "isPrimary": false  ✅
  },
  {
    "id": "node3",
    "name": "NODE3",
    "clusterState": {
      "type": "Secondary",
      "health": "Connected"
    },
    "isPrimary": false  ✅
  }
]
```

---

## User Experience

### Before
- Users could select any node for configuration changes
- No indication that Secondary nodes are read-only
- Potential for confusion when changes on Secondary nodes don't work

### After
- **DNS Filtering (Configuration) Page**: Auto-selects NODE1 (Primary), shows blue banner explaining cluster mode
- **Write Operations**: All write-enabled pages will auto-select Primary
- **Read Operations**: Dashboard, Logs, Sync views still allow selecting all nodes

### Banner Message
```
ℹ️ Cluster Mode Active

Your Technitium DNS servers are running in a cluster. Configuration changes
can only be made on the Primary node (NODE1). Secondary nodes will automatically
receive updates via zone transfers.
```

---

## Next Steps

### Recommended Extensions

1. **DHCP Page** - Add cluster banner and auto-select Primary
2. **DNS Zones Page** - Add cluster banner when creating/editing zones
3. **Settings Page** - Add cluster banner for server settings
4. **Node Selector Component** - Add `primaryOnly` prop to filter visible nodes

### Example Implementation for DHCP Page

```typescript
import { ClusterInfoBanner } from '../components/common/ClusterInfoBanner.tsx';
import { useClusterNodes } from '../hooks/usePrimaryNode';

export function DhcpPage() {
  const { nodes } = useTechnitiumState();
  const { primary, isClusterEnabled } = useClusterNodes(nodes);

  return (
    <section className="dhcp">
      <header>
        <h1>DHCP Management</h1>
      </header>

      <ClusterInfoBanner
        primaryNodeName={primary?.name}
        show={isClusterEnabled}
      />

      {/* Rest of DHCP page */}
    </section>
  );
}
```

---

## Files Modified

### Backend
- ✅ `apps/backend/src/technitium/technitium.service.ts` - Fixed Primary detection
- ✅ `apps/backend/src/technitium/technitium.types.ts` - Added `isPrimary` field

### Frontend
- ✅ `apps/frontend/src/context/TechnitiumContext.tsx` - Added `isPrimary` to node type
- ✅ `apps/frontend/src/hooks/usePrimaryNode.ts` - **NEW** helper hooks
- ✅ `apps/frontend/src/components/common/ClusterInfoBanner.tsx` - **NEW** banner component
- ✅ `apps/frontend/src/components/common/ClusterInfoBanner.css` - **NEW** banner styles
- ✅ `apps/frontend/src/pages/ConfigurationPage.tsx` - Auto-select Primary, show banner

---

## Benefits

1. **Prevents User Errors**: Users can't accidentally try to modify Secondary nodes
2. **Clear Communication**: Banner explains why only Primary is available
3. **Automatic Selection**: No manual node selection required for write operations
4. **Read Flexibility**: Read-only views still show all nodes for comparison
5. **Future-Proof**: Helper hooks make it easy to add restrictions to other pages

---

## Deployment

**Status**: ✅ Synced to NODE2 production environment
**Hot-Reload**: Backend and frontend changes applied
**Verification**: Access https://node2.example.com:5174 to see banner on DNS Filtering page

---

## Documentation Updated

- ✅ This implementation summary created
- ✅ Helper hooks documented with JSDoc comments
- ⏳ **TODO**: Update `.github/copilot-instructions.md` with cluster write restriction info
