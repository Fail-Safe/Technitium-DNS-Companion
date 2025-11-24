# Automatic Configuration Change Detection

## Overview

The domain list cache service now automatically detects when Advanced Blocking list URLs are added or removed from Technitium DNS configuration and invalidates the cache accordingly. This ensures we stay in-sync with the current running configuration without requiring manual cache refreshes.

## Problem Solved

**Before this feature:**
- If someone added a new blocklist URL via Technitium's web UI, our cache wouldn't know about it
- If someone removed a URL, we'd still serve cached data from that URL
- Users had to manually click "Refresh Lists" or wait for the scheduled refresh (up to 24 hours)
- This created a sync gap between Technitium's config and our cached data

**After this feature:**
- Config changes are detected automatically on every request
- Cache is invalidated immediately when URLs are added/removed
- Users always see current data based on the live Technitium DNS configuration
- No manual intervention needed

## How It Works

### 1. Configuration Hashing

The service generates a SHA-256 hash of all configured list URLs (sorted for consistency):
- Blocklist URLs
- Allowlist URLs
- Regex Blocklist URLs
- Regex Allowlist URLs

Example:
```typescript
// URLs from all groups across all list types
URLs: ['https://list1.com', 'https://list2.com', 'https://list3.com']
↓ Sort
↓ Join with '|'
↓ SHA-256 hash
Hash: "a1b2c3d4e5f6..."
```

### 2. Change Detection

On every API request that needs list data, we:
Technitium DNS . Fetch current config from Technitium
2. Generate hash of current URL configuration
3. Compare with previously stored hash
4. If hashes differ → config changed

### 3. Cache Invalidation

When a config change is detected:
1. Log the change: `Configuration change detected for node node1`
2. Clear all cached domain lists for that node
3. Clear all cached regex pattern lists for that node
4. Store new config hash
5. Re-fetch lists with new configuration

### 4. Transparent Operation

This happens automatically on these operations:
- `getListsMetadata()` - Get list info
- `getAllDomains()` - Domain Lists tab
- `checkDomain()` - Global domain lookup
- `simulateGroupPolicy()` - Policy simulator
- `searchDomains()` - Domain search

## Implementation Details

### New State Management

```typescript
private readonly configHashes = new Map<string, string>();
// nodeId → SHA-256 hash of URL configuration
```

### Key Methods

#### `generateConfigHash(config)`
Creates a deterministic hash of all list URLs in the configuration:
- Collects URLs from all groups
- Removes duplicates
- Sorts alphabetically
- Generates SHA-256 hash

#### `checkConfigChanged(nodeId)`
Compares current config hash with stored hash:
- Returns `true` if configuration changed
- Returns `false` if unchanged or first check
- Handles errors gracefully

#### `ensureCacheValid(nodeId)`
Called before every operation that uses cached data:
- Checks if config changed
- Invalidates cache if needed
- Transparent to calling code

## Scenarios

### Scenario 1: Adding a New Blocklist

**User Actions:**
1. Opens Technitium DNS web UI
2. Goes to Advanced Blocking settings
3. Adds new blocklist URL: `https://newlist.com/blocklist.txt`
4. Saves configuration

**System Response:**
1. Next API request to technitium-dns-companion detects config change
2. Cache is automatically cleared
3. New list is fetched and cached
4. User sees updated data immediately

### Scenario 2: Removing a List

**User Actions:**
1. Opens Technitium DNS web UI
2. Removes an old blocklist URL
3. Saves configuration

**System Response:**
1. Next API request detects URL removal
2. Cache is cleared
3. Only remaining lists are fetched
4. Removed list data no longer appears

### Scenario 3: Changing List URLs

**User Actions:**
1. Modifies a URL (e.g., updates version number in URL)
2. Saves configuration

**System Response:**
1. Config hash changes (URL is different)
2. Cache is invalidated
3. New URL content is fetched
4. Updated content is displayed

### Scenario 4: Reordering Groups

**User Actions:**
Technitium DNS . Changes group order in Technitium
2. No URL changes, just reordering

**System Response:**
1. Config hash remains the same (URLs are sorted before hashing)
2. Cache remains valid
3. No unnecessary re-fetching

## Performance Considerations

### Minimal Overhead
- Hash generation is fast (microseconds)
- Only compares hash strings (64 hex characters)
- No network calls unless config actually changed

### Smart Invalidation
- Only clears cache when URLs actually change
- Group reordering doesn't trigger invalidation
- URL order doesn't matter (sorted before hashing)

### First Request
- First time checking a node: stores hash but doesn't invalidate
- Avoids unnecessary cache clear on startup

## Logging

The service logs config changes for monitoring:

```
[DomainListCacheService] Configuration change detected for node node1
[DomainListCacheService] Config changed for node node1, invalidating cache
```

## Benefits

1. **Always Current**: Data reflects live Technitium DNS configuration
2. **No Manual Refresh**: Cache automatically invalidates when needed
3. **Transparent**: Works behind the scenes, no user action required
4. **Efficient**: Only invalidates when actually needed
5. **Multi-Node**: Each node's config tracked independently

## Future Enhancements

Possible improvements:
- Webhook integration: Technitium DNS notifies us of config changes
- Granular invalidation: Only clear affected list types (block vs allow)
- Change notifications: Alert users when config changes detected
- Config diff display: Show what URLs were added/removed
- Audit log: Track all config changes over time

## Related Features

- **Scheduled Refreshes**: Still runs periodically to catch content updates
- **Manual Refresh**: Users can still force refresh via UI
- **Cache Management**: Cache can be cleared per-node or globally

## Testing

To test config change detection:

1. **Add a URL**:
   ```bash
   # Via Technitium DNS UI: Add new blocklist URL
   # Then query Domain Lists tab
   # Should see new list immediately
   ```

2. **Remove a URL**:
   ```bash
   # Via Technitium DNS UI: Remove a blocklist URL
   # Then query Domain Lists tab
   # Should not see removed list
   ```

3. **Check Logs**:
   ```bash
   # Backend logs should show:
   # "Configuration change detected for node node1"
   # "Config changed for node node1, invalidating cache"
   ```

## Backwards Compatibility

This feature:
- ✅ Doesn't change any API contracts
- ✅ Doesn't require frontend changes
- ✅ Works with existing scheduled refreshes
- ✅ Compatible with manual refresh
- ✅ No breaking changes

All existing functionality continues to work as before, with the added benefit of automatic change detection.
