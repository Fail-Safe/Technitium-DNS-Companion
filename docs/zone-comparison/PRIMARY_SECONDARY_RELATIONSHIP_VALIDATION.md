# Primary/Secondary Zone Relationship Validation

## Overview

Phase 2 enhancement to validate that Primary and Secondary zones are properly configured for DNS redundancy. Currently, when a zone exists as Primary on one node and Secondary on another, we skip comparison and mark as "in-sync". This enhancement adds deep validation to ensure the relationship is configured correctly.

**Status**: 📝 Specification (Not Yet Implemented)

**Priority**: Medium (Quality of Life improvement)

**Dependencies**:
- Current zone type matching logic (✅ Implemented)
- Technitium DNS API access (✅ Available)

---

## Problem Statement

### Current Behavior
When a domain exists as:
- **Primary Zone** on EQ14
- **Secondary Zone** on EQ12

The system marks them as "in-sync" because different zone types are expected to have different configurations.

### The Gap
We don't validate that the relationship is **properly configured**:

❌ **Missing Validation**:
1. Primary zone should have NS records for BOTH servers
2. Primary's Notify list should include Secondary's IP
3. Primary's Zone Transfer ACL should allow Secondary
4. Secondary should point to correct Primary server
5. SOA serial numbers should match (after successful transfer)

### Real-World Impact

**Example Misconfiguration**:
```
Primary Zone (node1.example.com):
  NS records:
    - ns1.example.com (node1 only) ❌ Missing node2!
  Notify: None configured ❌
  Zone Transfer: Deny ❌

Secondary Zone (node2.example.com):
  Primary Server: 192.168.45.5 ✅
  Zone Transfer failed: Connection refused ❌
```

**Consequences**:
- External DNS resolvers only know about EQ14
- No automatic failover if EQ14 goes down
- Secondary never receives updates
- Defeats purpose of having Secondary zone
- Violates DNS best practices (RFC 1034, RFC 1996)

---

## Proposed Solution

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Zone Comparison Flow (Current + New)                        │
└─────────────────────────────────────────────────────────────┘

1. Fetch zones from all nodes ✅ (existing)
2. Group zones by name ✅ (existing)
3. Check zone type consistency ✅ (existing)

   ┌─────────────────────────────────────────┐
   │ Are zone types the same?                │
   └─────────────────┬───────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
       YES                       NO
        │                         │
        v                         v
   Compare configs          Check if Primary+Secondary
   (existing logic)              combination
                                  │
                     ┌────────────┴────────────┐
                     │                         │
                    YES                       NO
                     │                         │
                     v                         v
              🆕 VALIDATE              Mark as in-sync
              RELATIONSHIP             (existing logic)
              (new logic)
                     │
        ┌────────────┴────────────┐
        │                         │
    All Valid              Has Issues
        │                         │
        v                         v
   Mark as                 Mark as
   "in-sync"              "configuration-error"
                          + List specific issues
```

### Validation Opt-In Model

**User Experience**:
1. **Default behavior**: Same as now (fast, no extra API calls)
2. **Opt-in validation**: User clicks "Validate Relationships" button
3. **Deep validation**: System fetches NS records and validates setup
4. **Show results**: Display issues with actionable suggestions

**UI Mockup**:
```
┌─────────────────────────────────────────────────────────────┐
│ [Differences 0] [Missing 0] [In Sync 13] [All Zones]       │
│                                                             │
│ [ 🔍 Validate Relationships ]  ← New button                │
└─────────────────────────────────────────────────────────────┘

After clicking:
┌─────────────────────────────────────────────────────────────┐
│ example.com                                  [CONFIG ERROR]   │
├─────────────────────────────────────────────────────────────┤
│ Issues Found:                                               │
│ • Primary missing NS record for node2                        │
│ • Primary Notify not configured for Secondary               │
│                                                             │
│ [ 📋 View Details ] [ 🔧 Auto-Fix ]                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Technical Implementation

### 1. New Validation Service

**Location**: `apps/backend/src/technitium/zone-relationship-validator.service.ts`

```typescript
@Injectable()
export class ZoneRelationshipValidatorService {
  constructor(private readonly technitiumService: TechnitiumService) {}

  async validatePrimarySecondaryRelationship(
    primaryZone: TechnitiumZoneNodeState,
    secondaryZone: TechnitiumZoneNodeState,
  ): Promise<ZoneRelationshipValidationResult> {
    const issues: ZoneRelationshipIssue[] = [];

    // Check 1: NS Records
    const nsIssues = await this.validateNsRecords(primaryZone, secondaryZone);
    issues.push(...nsIssues);

    // Check 2: Notify Configuration
    const notifyIssues = this.validateNotifyConfiguration(primaryZone, secondaryZone);
    issues.push(...notifyIssues);

    // Check 3: Zone Transfer ACL
    const transferIssues = this.validateZoneTransferAcl(primaryZone, secondaryZone);
    issues.push(...transferIssues);

    // Check 4: Secondary Points to Primary
    const primaryServerIssues = this.validatePrimaryServer(primaryZone, secondaryZone);
    issues.push(...primaryServerIssues);

    // Check 5: SOA Serial Synchronization
    const soaIssues = this.validateSoaSerial(primaryZone, secondaryZone);
    issues.push(...soaIssues);

    return {
      isValid: issues.length === 0,
      issues,
      recommendations: this.generateRecommendations(issues),
    };
  }
}
```

### 2. NS Record Validation

**Challenge**: Need to fetch actual DNS records from zones

**API Call Required**: `/api/zones/records/get?zone=example.com&domain=@&type=NS`

```typescript
private async validateNsRecords(
  primaryZone: TechnitiumZoneNodeState,
  secondaryZone: TechnitiumZoneNodeState,
): Promise<ZoneRelationshipIssue[]> {
  const issues: ZoneRelationshipIssue[] = [];

  // Fetch NS records from Primary zone
  const nsRecords = await this.technitiumService.getZoneRecords(
    primaryZone.nodeId,
    primaryZone.zone!.name,
    '@',  // apex/root of zone
    'NS',
  );

  // Extract nameserver hostnames
  const nameservers = nsRecords.map(record => record.rData?.nameServer).filter(Boolean);

  // Check if both nodes are represented
  const primaryNsFound = this.findMatchingNs(nameservers, primaryZone.baseUrl);
  const secondaryNsFound = this.findMatchingNs(nameservers, secondaryZone.baseUrl);

  if (!primaryNsFound) {
    issues.push({
      severity: 'error',
      type: 'missing-ns-record',
      message: `Primary zone missing NS record for ${primaryZone.nodeId}`,
      affectedNode: primaryZone.nodeId,
      recommendation: `Add NS record: @ IN NS ns1.${primaryZone.zone!.name}`,
    });
  }

  if (!secondaryNsFound) {
    issues.push({
      severity: 'error',
      type: 'missing-ns-record',
      message: `Primary zone missing NS record for ${secondaryZone.nodeId}`,
      affectedNode: secondaryZone.nodeId,
      recommendation: `Add NS record: @ IN NS ns2.${primaryZone.zone!.name}`,
    });
  }

  return issues;
}
```

### 3. Notify Configuration Validation

**Validation**: Primary's Notify list should include Secondary's IP

```typescript
private validateNotifyConfiguration(
  primaryZone: TechnitiumZoneNodeState,
  secondaryZone: TechnitiumZoneNodeState,
): ZoneRelationshipIssue[] {
  const issues: ZoneRelationshipIssue[] = [];
  const primary = primaryZone.zone!;

  // Extract Secondary's IP from baseUrl
  const secondaryIp = this.extractIpFromUrl(secondaryZone.baseUrl);

  if (!primary.notify || primary.notify === 'None') {
    issues.push({
      severity: 'warning',
      type: 'notify-not-configured',
      message: 'Primary zone Notify not configured',
      affectedNode: primaryZone.nodeId,
      recommendation: 'Enable Notify and add Secondary server IP',
    });
  } else if (primary.notify === 'SpecifiedNameServers') {
    if (!primary.notifyNameServers?.includes(secondaryIp)) {
      issues.push({
        severity: 'warning',
        type: 'notify-missing-secondary',
        message: `Primary Notify list missing Secondary IP (${secondaryIp})`,
        affectedNode: primaryZone.nodeId,
        recommendation: `Add ${secondaryIp} to Notify Name Servers list`,
      });
    }
  }

  return issues;
}
```

### 4. Zone Transfer ACL Validation

**Validation**: Primary should allow Secondary to perform zone transfers

```typescript
private validateZoneTransferAcl(
  primaryZone: TechnitiumZoneNodeState,
  secondaryZone: TechnitiumZoneNodeState,
): ZoneRelationshipIssue[] {
  const issues: ZoneRelationshipIssue[] = [];
  const primary = primaryZone.zone!;
  const secondaryIp = this.extractIpFromUrl(secondaryZone.baseUrl);

  if (primary.zoneTransfer === 'Deny') {
    issues.push({
      severity: 'error',
      type: 'zone-transfer-denied',
      message: 'Primary zone Zone Transfer is set to Deny',
      affectedNode: primaryZone.nodeId,
      recommendation: 'Change Zone Transfer to "Allow" or "AllowOnlyZoneNameServers"',
    });
  } else if (primary.zoneTransfer === 'AllowOnlySpecifiedNetworkACL') {
    if (!primary.zoneTransferNetworkACL?.some(acl => this.ipMatchesAcl(secondaryIp, acl))) {
      issues.push({
        severity: 'error',
        type: 'zone-transfer-acl-missing-secondary',
        message: `Zone Transfer ACL missing Secondary IP (${secondaryIp})`,
        affectedNode: primaryZone.nodeId,
        recommendation: `Add ${secondaryIp} to Zone Transfer Network ACL`,
      });
    }
  }

  return issues;
}
```

### 5. Primary Server Validation

**Validation**: Secondary should point to correct Primary server

```typescript
private validatePrimaryServer(
  primaryZone: TechnitiumZoneNodeState,
  secondaryZone: TechnitiumZoneNodeState,
): ZoneRelationshipIssue[] {
  const issues: ZoneRelationshipIssue[] = [];
  const secondary = secondaryZone.zone!;
  const primaryIp = this.extractIpFromUrl(primaryZone.baseUrl);

  if (!secondary.primaryNameServerAddresses || secondary.primaryNameServerAddresses.length === 0) {
    issues.push({
      severity: 'error',
      type: 'primary-server-not-set',
      message: 'Secondary zone has no Primary Name Server configured',
      affectedNode: secondaryZone.nodeId,
      recommendation: `Set Primary Name Server to ${primaryIp}`,
    });
  } else if (!secondary.primaryNameServerAddresses.includes(primaryIp)) {
    issues.push({
      severity: 'warning',
      type: 'primary-server-mismatch',
      message: `Secondary pointing to ${secondary.primaryNameServerAddresses[0]} instead of ${primaryIp}`,
      affectedNode: secondaryZone.nodeId,
      recommendation: `Update Primary Name Server to ${primaryIp}`,
    });
  }

  return issues;
}
```

### 6. SOA Serial Validation

**Validation**: Secondary's SOA serial should match Primary (after successful transfer)

```typescript
private validateSoaSerial(
  primaryZone: TechnitiumZoneNodeState,
  secondaryZone: TechnitiumZoneNodeState,
): ZoneRelationshipIssue[] {
  const issues: ZoneRelationshipIssue[] = [];
  const primary = primaryZone.zone!;
  const secondary = secondaryZone.zone!;

  if (primary.soaSerial !== undefined && secondary.soaSerial !== undefined) {
    if (primary.soaSerial !== secondary.soaSerial) {
      issues.push({
        severity: 'warning',
        type: 'soa-serial-mismatch',
        message: `SOA Serial out of sync (Primary: ${primary.soaSerial}, Secondary: ${secondary.soaSerial})`,
        affectedNode: secondaryZone.nodeId,
        recommendation: 'Check zone transfer logs. May indicate transfer failure.',
      });
    }
  }

  // Check if Secondary has transfer errors
  if (secondary.syncFailed) {
    issues.push({
      severity: 'error',
      type: 'zone-transfer-failed',
      message: 'Secondary zone reports sync failed',
      affectedNode: secondaryZone.nodeId,
      recommendation: 'Check Zone Transfer ACL and network connectivity',
    });
  }

  return issues;
}
```

---

## New Types & Interfaces

### Backend Types

```typescript
// apps/backend/src/technitium/zone-relationship.types.ts

export type ZoneRelationshipIssueSeverity = 'error' | 'warning' | 'info';

export type ZoneRelationshipIssueType =
  | 'missing-ns-record'
  | 'notify-not-configured'
  | 'notify-missing-secondary'
  | 'zone-transfer-denied'
  | 'zone-transfer-acl-missing-secondary'
  | 'primary-server-not-set'
  | 'primary-server-mismatch'
  | 'soa-serial-mismatch'
  | 'zone-transfer-failed';

export interface ZoneRelationshipIssue {
  severity: ZoneRelationshipIssueSeverity;
  type: ZoneRelationshipIssueType;
  message: string;
  affectedNode: string;
  recommendation: string;
  autoFixable?: boolean;  // Can be automatically corrected
}

export interface ZoneRelationshipValidationResult {
  isValid: boolean;
  issues: ZoneRelationshipIssue[];
  recommendations: string[];
}

export interface ZoneRelationshipValidationRequest {
  zoneName: string;
  deepValidation?: boolean;  // Include NS record checks (slower)
}

export interface ZoneRelationshipValidationResponse {
  zoneName: string;
  validatedAt: string;
  primaryNode: string;
  secondaryNode: string;
  result: ZoneRelationshipValidationResult;
}
```

### Frontend Types

```typescript
// apps/frontend/src/types/zones.ts

export type TechnitiumZoneStatus =
  | 'in-sync'
  | 'missing'
  | 'different'
  | 'unknown'
  | 'configuration-error';  // New status

export interface TechnitiumZoneRelationshipIssue {
  severity: 'error' | 'warning' | 'info';
  type: string;
  message: string;
  affectedNode: string;
  recommendation: string;
  autoFixable?: boolean;
}

export interface TechnitiumZoneComparison {
  name: string;
  status: TechnitiumZoneStatus;
  differences?: string[];
  relationshipIssues?: TechnitiumZoneRelationshipIssue[];  // New field
  nodes: TechnitiumZoneNodeState[];
}
```

---

## API Endpoints

### New Endpoint: Validate Zone Relationship

```typescript
// apps/backend/src/technitium/technitium.controller.ts

@Get('zones/:zoneName/validate-relationship')
async validateZoneRelationship(
  @Param('zoneName') zoneName: string,
  @Query('deepValidation') deepValidation?: boolean,
): Promise<ZoneRelationshipValidationResponse> {
  // Implementation in controller
}
```

**Usage**:
```bash
GET /api/zones/example.com/validate-relationship?deepValidation=true
```

**Response**:
```json
{
  "zoneName": "example.com",
  "validatedAt": "2025-10-16T20:30:00Z",
  "primaryNode": "node1",
  "secondaryNode": "node2",
  "result": {
    "isValid": false,
    "issues": [
      {
        "severity": "error",
        "type": "missing-ns-record",
        "message": "Primary zone missing NS record for node2",
        "affectedNode": "node1",
        "recommendation": "Add NS record: @ IN NS ns2.example.com",
        "autoFixable": true
      },
      {
        "severity": "warning",
        "type": "notify-missing-secondary",
        "message": "Primary Notify list missing Secondary IP (192.168.45.7)",
        "affectedNode": "node1",
        "recommendation": "Add 192.168.45.7 to Notify Name Servers list",
        "autoFixable": true
      }
    ],
    "recommendations": [
      "Configure NS records for both servers in Primary zone",
      "Enable Notify on Primary and add Secondary IP",
      "Verify Zone Transfer ACL includes Secondary"
    ]
  }
}
```

### New Endpoint: Get Zone Records

**Required for NS record validation**:

```typescript
// apps/backend/src/technitium/technitium.controller.ts

@Get('zones/:zoneName/records')
async getZoneRecords(
  @Param('zoneName') zoneName: string,
  @Query('domain') domain: string = '@',
  @Query('type') type?: string,
): Promise<TechnitiumZoneRecordsResponse> {
  // Proxy to Technitium DNS API: /api/zones/records/get
}
```

---

## UI Implementation

### 1. Validate Relationships Button

**Location**: Zones page toolbar (next to filter buttons)

```tsx
// apps/frontend/src/pages/ZonesPage.tsx

const [validationMode, setValidationMode] = useState<'off' | 'validating' | 'complete'>('off');
const [validationResults, setValidationResults] = useState<Map<string, ValidationResult>>(new Map());

const handleValidateRelationships = async () => {
  setValidationMode('validating');

  // Find all zones with Primary+Secondary combinations
  const zonesToValidate = overview.zones.filter(zone => {
    const types = zone.nodes.map(n => n.zone?.type);
    return types.includes('Primary') && types.includes('Secondary');
  });

  // Validate each zone
  const results = await Promise.all(
    zonesToValidate.map(zone => validateZoneRelationship(zone.name, { deepValidation: true }))
  );

  // Store results
  const resultsMap = new Map(results.map(r => [r.zoneName, r.result]));
  setValidationResults(resultsMap);
  setValidationMode('complete');
};
```

### 2. Configuration Error Badge

**New badge style**:

```css
/* apps/frontend/src/pages/ZonesPage.css */

.badge--config-error {
    background: rgba(255, 159, 67, 0.15);
    color: #d97706;
    border: 1px solid rgba(255, 159, 67, 0.3);
}
```

### 3. Issue Display

**Show validation issues in zone card**:

```tsx
{zone.relationshipIssues && zone.relationshipIssues.length > 0 && (
  <div className="zones-page__relationship-issues">
    <div className="zones-page__issues-header">
      <AlertTriangle size={16} />
      <span>Configuration Issues Found</span>
    </div>
    <ul className="zones-page__issues-list">
      {zone.relationshipIssues.map((issue, idx) => (
        <li key={idx} className={`zones-page__issue zones-page__issue--${issue.severity}`}>
          <div className="zones-page__issue-message">{issue.message}</div>
          <div className="zones-page__issue-recommendation">
            💡 {issue.recommendation}
          </div>
          {issue.autoFixable && (
            <button className="zones-page__issue-fix-btn">
              Auto-Fix
            </button>
          )}
        </li>
      ))}
    </ul>
  </div>
)}
```

---

## Auto-Fix Functionality

### Phase 2.1: Auto-Fix Support

**Concept**: For certain issues, provide "Auto-Fix" button that makes API calls to correct the problem

**Example**: Missing NS record

```typescript
async function autoFixMissingNsRecord(
  zoneName: string,
  primaryNodeId: string,
  secondaryNodeId: string,
  secondaryHostname: string,
) {
  // Add NS record to Primary zone
  await technitiumApi.addZoneRecord(primaryNodeId, {
    zone: zoneName,
    domain: '@',
    type: 'NS',
    ttl: 3600,
    rdata: {
      nameServer: secondaryHostname,
    },
  });

  // Show success toast
  pushToast({
    message: `Added NS record for ${secondaryHostname}`,
    tone: 'success',
  });

  // Refresh zone data
  await fetchOverview('refresh');
}
```

**Auto-Fixable Issues**:
- ✅ Missing NS records (add record)
- ✅ Notify configuration (enable and add IP)
- ✅ Zone Transfer ACL (add Secondary IP)
- ⚠️ Zone Transfer mode (change from Deny to Allow - requires confirmation)
- ❌ SOA serial mismatch (not auto-fixable, requires investigation)

---

## Performance Considerations

### Validation Timing

**Option 1: On-Demand** (Recommended)
- User clicks "Validate Relationships" button
- Only validates when requested
- No performance impact on normal zone comparison
- ✅ **Best user experience**

**Option 2: Background Validation**
- Automatically validate during zone fetch
- Show issues immediately
- Slower initial load
- ❌ **May be too slow**

**Option 3: Hybrid**
- Quick validation (no NS record fetch) during normal comparison
- Deep validation (with NS records) on-demand
- ✅ **Good balance**

### Caching Strategy

**Cache validation results** for 5 minutes:
```typescript
const validationCache = new Map<string, {
  result: ZoneRelationshipValidationResult;
  timestamp: number;
}>();

// Check cache before validating
if (cached && Date.now() - cached.timestamp < 300000) {
  return cached.result;
}
```

---

## Testing Strategy

### Unit Tests

```typescript
// zone-relationship-validator.service.spec.ts

describe('ZoneRelationshipValidatorService', () => {
  describe('validateNsRecords', () => {
    it('should detect missing NS record for secondary', async () => {
      // Test implementation
    });

    it('should pass when both NS records exist', async () => {
      // Test implementation
    });
  });

  describe('validateNotifyConfiguration', () => {
    it('should warn when Notify not configured', () => {
      // Test implementation
    });

    it('should error when Secondary IP missing from Notify list', () => {
      // Test implementation
    });
  });
});
```

### Integration Tests

```typescript
// technitium.controller.e2e-spec.ts

describe('Zone Relationship Validation (e2e)', () => {
  it('should validate Primary/Secondary relationship', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/zones/example.com/validate-relationship')
      .query({ deepValidation: true })
      .expect(200);

    expect(response.body.result.isValid).toBeDefined();
    expect(response.body.result.issues).toBeInstanceOf(Array);
  });
});
```

### Manual Testing Checklist

- [ ] Validate zone with proper NS records (should pass)
- [ ] Validate zone missing Secondary NS record (should error)
- [ ] Validate zone with Notify misconfigured (should warn)
- [ ] Validate zone with Transfer denied (should error)
- [ ] Validate zone with SOA mismatch (should warn)
- [ ] Test Auto-Fix for NS record
- [ ] Test Auto-Fix for Notify configuration
- [ ] Verify validation caching works
- [ ] Test with slow network (validation timeout)

---

## Documentation Updates

### Update copilot-instructions.md

Add to "Common Patterns & Gotchas":

```markdown
**Zone Relationship Validation** (Phase 2):
- Primary/Secondary relationships can be validated on-demand
- Click "Validate Relationships" to perform deep validation
- Auto-Fix available for common issues (NS records, Notify, ACLs)
- Validation results cached for 5 minutes
```

### Create User Guide

**Location**: `docs/ui/ZONE_RELATIONSHIP_VALIDATION_GUIDE.md`

**Contents**:
- What is validated
- How to interpret issues
- How to use Auto-Fix
- Manual fix procedures
- Best practices for Primary/Secondary setup

---

## Rollout Plan

### Phase 2.0: Basic Validation
- ✅ Validate Notify configuration
- ✅ Validate Zone Transfer ACL
- ✅ Validate Primary Server setting
- ✅ Validate SOA serial
- ✅ UI: Validate button
- ✅ UI: Issue display
- ⏸️ NS record validation (requires new API endpoint)

**Estimated Effort**: 2-3 days

### Phase 2.1: Deep Validation
- ✅ Implement getZoneRecords endpoint
- ✅ Validate NS records
- ✅ Full deep validation

**Estimated Effort**: 1-2 days

### Phase 2.2: Auto-Fix
- ✅ Auto-fix for NS records
- ✅ Auto-fix for Notify
- ✅ Auto-fix for Zone Transfer ACL
- ✅ Confirmation dialogs for destructive changes

**Estimated Effort**: 2-3 days

### Phase 2.3: Enhancements
- ✅ Validation result caching
- ✅ Bulk validation
- ✅ Export validation report
- ✅ Email notifications for issues

**Estimated Effort**: 1-2 days

**Total Estimated Effort**: 6-10 days

---

## Open Questions

1. **Should validation be automatic** or always opt-in?
   - **Recommendation**: Opt-in to avoid performance impact

2. **Should we validate all relationship types** (not just Primary/Secondary)?
   - Example: Primary Forwarder + Secondary Forwarder
   - **Recommendation**: Start with Primary/Secondary, expand later

3. **How aggressive should Auto-Fix be?**
   - Should we auto-fix without confirmation?
   - **Recommendation**: Always confirm before making changes

4. **Should we validate across more than 2 nodes?**
   - Example: 1 Primary + 2 Secondaries
   - **Recommendation**: Yes, validate all relationships

5. **Should validation be configurable per zone?**
   - Some zones might intentionally not follow best practices
   - **Recommendation**: Add "ignore validation" flag per zone

---

## Success Metrics

**User Experience**:
- ✅ Users can identify misconfigured Primary/Secondary zones
- ✅ Users can fix issues with 1-2 clicks
- ✅ Validation completes in < 5 seconds per zone

**Technical**:
- ✅ 95% of common issues auto-fixable
- ✅ Validation cached to avoid repeated API calls
- ✅ No false positives (correct configurations not flagged)

**Documentation**:
- ✅ User guide explains all validation checks
- ✅ Developer docs explain validation architecture
- ✅ API docs include validation endpoints

---

## Related Documentation

- [Zone Type Matching Logic](./ZONE_TYPE_MATCHING_LOGIC.md) - Current implementation
- [Zone Comparison Flow](./ZONE_COMPARISON_FLOW_DIAGRAM.md) - Visual diagrams
- [Architecture Overview](../architecture.md) - System design
- [Technitium DNS API](https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md) - Upstream docs

---

## Changelog

- **2025-10-16**: Initial specification created
- **TBD**: Implementation started (Phase 2.0)
- **TBD**: Deep validation completed (Phase 2.1)
- **TBD**: Auto-Fix implemented (Phase 2.2)
- **TBD**: Enhancements deployed (Phase 2.3)
