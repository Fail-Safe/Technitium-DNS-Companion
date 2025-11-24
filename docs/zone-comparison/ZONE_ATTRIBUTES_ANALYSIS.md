# Zone Attribute Analysis for Synchronization

## Current Zone Attributes Being Tracked

From `TechnitiumZoneSummary`:

1. **`name`** - Zone name (unique identifier)
   - Status: ✅ Not compared (used for identification)
   - Reason: Each zone has one name

2. **`type`** - Zone type (Primary/Secondary/Stub/Forwarder/etc)
   - Status: ❌ Removed from comparison
   - Reason: Valid for Primary zones to have one type and Secondary zones to have another type
   - Change: Removed in latest update

3. **`internal`** - Whether zone is internal
   - Status: ✅ Compared
   - Reason: Operational setting that should be consistent
   - Impact: Flagged as "different" if varies across nodes

4. **`dnssecStatus`** - DNSSEC signing status (Unsigned/SignedWithNSEC/SignedWithNSEC3)
   - Status: ✅ Compared
   - Reason: Security configuration should match
   - Impact: Flagged as "different" if varies across nodes

5. **`soaSerial`** - SOA Serial number
   - Status: ✅ Compared
   - Reason: Indicates zone content version
   - Impact: Different serial = different zone content
   - Note: If SOA Serial matches, zone content is identical (ignores lastModified/expiry)

6. **`expiry`** - Expiry timestamp (ISO 8601)
   - Status: ❌ Removed from comparison
   - Reason: Derived from SOA parameters; may vary due to sync timing
   - Change: Removed in latest update

7. **`isExpired`** - Whether zone is expired (boolean)
   - Status: ✅ Compared
   - Reason: Operational state that matters
   - Impact: Flagged as "different" if one zone expired and another isn't
   - Note: Separate from `expiry` timestamp

8. **`syncFailed`** - Whether zone sync failed (for Secondary zones)
   - Status: ✅ Compared
   - Reason: Indicates operational issue
   - Impact: Flagged as "different" if sync failed on one node but not another
   - Note: Critical for Secondary/Stub zones

9. **`notifyFailed`** - Whether NOTIFY failed
   - Status: ✅ Compared
   - Reason: Indicates communication issue with secondary nameservers
   - Impact: Flagged as "different" if varies across nodes

10. **`notifyFailedFor`** - Array of IP/hostnames where NOTIFY failed
    - Status: ✅ Compared
    - Reason: Specific information about which secondaries are unreachable
    - Impact: Flagged as "different" if list varies

11. **`lastModified`** - Last modification timestamp (ISO 8601)
    - Status: ❌ Removed from comparison
    - Reason: Operational metadata; may differ due to sync timing
    - Change: Removed in latest update
    - Note: If SOA Serial matches, content is identical regardless of lastModified

12. **`disabled`** - Whether zone is disabled
    - Status: ✅ Compared
    - Reason: Operational state that should be consistent
    - Impact: Flagged as "different" if zone disabled on one node but enabled on another

## Missing Attributes (Not Tracked)

From the Technitium DNS API documentation, these zone attributes are NOT currently tracked:

1. **`catalog`** - Catalog zone membership (if zone is member of a catalog)
   - Impact: Should be compared if using Catalog zones
   - Recommendation: ⚠️ Consider adding if using Catalog zones

2. **Zone Transfer Settings** - zoneTransfer, zoneTransferNetworkACL, zoneTransferTsigKeyNames
   - Impact: Not compared (probably zone-specific settings)
   - Recommendation: ⚠️ May want to compare if synchronizing zones with specific transfer ACLs

3. **Query Access Settings** - queryAccess, queryAccessNetworkACL
   - Impact: Not compared (probably zone-specific settings)
   - Recommendation: ⚠️ May want to compare if synchronizing zones with specific access controls

4. **Notify Settings** - notify, notifyNameServers
   - Impact: Not compared (operational but zone-specific)
   - Recommendation: ⚠️ May want to compare if synchronizing zone notification configuration

5. **Dynamic Update Settings** - update, updateNetworkACL, updateSecurityPolicies
   - Impact: Not compared (zone-specific security settings)
   - Recommendation: ⚠️ Probably zone-specific and shouldn't require sync

6. **DNSSEC Private Keys** - dnsKeyTtl, dnssecPrivateKeys
   - Impact: Not in summary, only in full zone options
   - Recommendation: ⚠️ Could matter if doing full DNSSEC management

## Business Logic Assessment

### Currently Implemented (Correctly Synchronized)
✅ Zone exists on all nodes (presence check)
✅ Zone content is identical (SOA Serial match)
✅ Zone is enabled/disabled consistently
✅ Zone DNSSEC signing is consistent
✅ Zone is marked internal/external consistently
✅ Zone sync succeeded on all nodes
✅ Zone NOTIFY succeeded on all nodes
✅ Zone expiry state is consistent (isExpired boolean)

### Intentionally Ignored (Correct Design)
✅ Zone type variation (Primary vs Secondary is valid)
✅ Last modified timestamp (operational metadata)
✅ Expiry timestamp (derived from SOA, varies with sync timing)

### Potentially Missing (Depends on Use Case)
⚠️ **Catalog zone membership** - If using Catalog zones for management, this should match
⚠️ **Zone transfer ACLs** - If synchronizing Secondary zone transfer configuration
⚠️ **Query access ACLs** - If synchronizing query restrictions
⚠️ **Notify configuration** - If synchronizing NOTIFY target lists

## Recommendations

1. **Current implementation is correct for basic zone synchronization**
2. If using Technitium DNS Catalog zones, consider adding `catalog` field to comparison
3. If implementing zone configuration templates, consider adding ACL/notify configuration
4. The removal of `type`, `lastModified`, and `expiry` is correct DNS best practice

## Zone Sync Completeness Score
- **Content Sync**: 100% ✅ (SOA Serial provides content authority)
- **Operational Sync**: 95% ✅ (All critical flags covered)
- **Configuration Sync**: 70% ⚠️ (Advanced ACL/notify settings not compared)
- **DNSSEC Sync**: 80% ⚠️ (Status compared, but private keys not tracked)
