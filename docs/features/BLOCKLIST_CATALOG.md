# Block List Catalog Feature

## Overview

The Block List Catalog feature allows users to check for updates to popular DNS block lists (primarily Hagezi) directly from within the Built-in Blocking settings. This provides a "partner not manager" approach - the app checks upstream sources and presents available lists, letting users decide what to add.

## How It Works

### Backend Service (`blocklist-catalog`)

The backend service fetches and parses the Hagezi README from GitHub to extract current block list URLs.

**Endpoint:** `GET /api/blocklist-catalog/hagezi`

**Query Parameters:**
- `refresh=true` - Force refresh, bypassing the 1-hour cache

**Response:**
```json
{
  "success": true,
  "timestamp": "2025-01-15T12:30:00.000Z",
  "lists": [
    {
      "id": "hagezi-pro",
      "name": "Hagezi Pro",
      "url": "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/pro-onlydomains.txt",
      "description": "Extended protection - Balanced blocking",
      "category": "multi"
    }
  ]
}
```

### Categories

Lists are categorized into:
- **multi** - General-purpose ad/tracking/malware blocking (Light, Normal, Pro, Pro++, Ultimate)
- **security** - Threat intelligence and security-focused (TIF, Fake, DoH bypass)
- **content** - Content filtering (Gambling, NSFW, Social, Anti-Piracy)

### Frontend Integration

The Built-in Blocking Editor (`BuiltInBlockingEditor.tsx`) includes:

1. **"Check Hagezi for Updates" button** - Fetches the latest catalog from the backend
2. **Catalog Updates Panel** - Shows available lists not yet added to the configuration
3. **One-click add** - Add any list to pending changes with a single click

### Hook: `useBlockListCatalog`

```typescript
import { useBlockListCatalog } from '../hooks/useBlockListCatalog';

const {
  fetchHageziCatalog,  // Fetch latest catalog
  isLoading,           // Loading state
  error,               // Error message if failed
  catalog              // Last fetched catalog result
} = useBlockListCatalog();
```

## Caching

The backend caches the parsed catalog for 1 hour to avoid excessive GitHub API calls. Users can force a refresh using the "Check for Updates" button.

## URL Format

Hagezi lists are served via jsDelivr CDN for fast, reliable delivery:
```
https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/{list}-onlydomains.txt
```

The `-onlydomains.txt` format is recommended for TechnitiumDNS as it contains only domain names without additional metadata.

## Files

### Backend
- `apps/backend/src/blocklist-catalog/blocklist-catalog.module.ts` - NestJS module
- `apps/backend/src/blocklist-catalog/blocklist-catalog.service.ts` - Service with fetch/parse logic
- `apps/backend/src/blocklist-catalog/blocklist-catalog.controller.ts` - REST API endpoints

### Frontend
- `apps/frontend/src/hooks/useBlockListCatalog.ts` - React hook for API calls
- `apps/frontend/src/components/configuration/BuiltInBlockingEditor.tsx` - UI integration
- `apps/frontend/src/components/configuration/BuiltInBlockingEditor.css` - Styles

### Data (Static)
- `apps/frontend/src/data/predefinedBlockLists.json` - Static catalog for Quick Add dropdown
- `apps/frontend/src/types/blockListCatalog.ts` - TypeScript types

## Future Enhancements

1. **Steven Black integration** - Parse StevenBlack repository for updates
2. **OISD integration** - Check for OISD list changes
3. **Auto-check on load** - Optionally check for updates when opening settings
4. **Update notifications** - Badge showing available updates in the sidebar
5. **Version tracking** - Track which version of each list is installed
