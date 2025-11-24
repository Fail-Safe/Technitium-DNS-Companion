# Zone Comparison Logic Updates

## Changes Made

Updated the zone comparison logic in `apps/backend/src/technitium/technitium.service.ts` to implement DNS-aware comparison rules.

### Removed Fields from Comparison

1. **`type`** - Zone type (Primary/Secondary)
   - **Reason**: It's valid and expected to have one Primary zone and multiple Secondary zones
   - **Impact**: Zones will no longer be marked as "different" based on type alone

2. **`lastModified`** - Zone last modification timestamp
   - **Reason**: This is a derived timestamp that may differ between nodes even when content is identical
   - **Impact**: No longer flagged as a difference

3. **`expiry`** - Zone expiry timestamp
   - **Reason**: Expiry dates may differ between nodes due to sync timing differences
   - **Note**: `isExpired` (boolean flag) is still compared, which is what matters
   - **Impact**: Zones won't be flagged as different just because expiry times differ

### Retained Fields for Comparison

The following fields are still compared across nodes:

- `dnssecStatus` - DNSSEC validation status
- `soaSerial` - SOA Serial number (zone version)
- `disabled` - Whether zone is disabled
- `internal` - Whether zone is internal
- `notifyFailed` - NOTIFY failures
- `notifyFailedFor` - List of failed notification targets
- `syncFailed` - Whether zone sync failed
- `isExpired` - Whether zone is expired (boolean)

## Business Logic

The new comparison logic follows DNS best practices:

1. **Zone Type Flexibility**: Primary/Secondary distribution is intentional and valid
2. **SOA Serial Authority**: If SOA Serial matches, the zone content is identical
3. **Timestamp Flexibility**: Last Modified and Expiry are operational metadata that may vary

## Impact on Zone Statuses

### Before
Zones with different types or timestamps would be marked as "different"

### After
Zones are marked as "different" only when there are actual content or configuration differences:
- Different DNSSEC status
- Different SOA Serial (zone version mismatch)
- Different disabled/internal/syncFailed status
- Different notification failures

## Testing

✅ All backend tests pass (5 test suites, 11 tests)
✅ TypeScript compilation: No errors
✅ Zone comparison logic working as expected
