# Zone Comparison Decision Tree

## Flow Diagram

```
┌─────────────────────────────────────────────────┐
│  Zone Comparison Request                        │
│  Input: Zones from Node1 and Node2               │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  Step 1: Extract Zone Types                    │
│  Node1: zone.type = "Primary Zone"              │
│  Node2: zone.type = "Secondary Zone"            │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  Step 2: Check Type Consistency                │
│  uniqueTypes = Set(["Primary Zone",            │
│                     "Secondary Zone"])          │
│  uniqueTypes.size = 2                           │
└──────────────────┬──────────────────────────────┘
                   │
         ┌─────────┴─────────┐
         │                   │
    size > 1              size = 1
  (Different)           (Same Type)
         │                   │
         ▼                   ▼
┌─────────────────┐   ┌─────────────────────────┐
│ SKIP COMPARISON │   │ PROCEED WITH COMPARISON │
│                 │   │                         │
│ Return: []      │   │ Compare Settings:       │
│ Status: In-Sync │   │ - Zone Transfer         │
│                 │   │ - Notify                │
│ Reason:         │   │ - Query Access          │
│ Different roles │   │ - SOA Serial            │
│ Expected to     │   │ - etc.                  │
│ have different  │   │                         │
│ configs         │   │ Return: [differences]   │
│                 │   │ Status: Different/      │
│                 │   │         In-Sync         │
└─────────────────┘   └─────────────────────────┘
```

---

## Scenarios

### Scenario A: Primary + Secondary (Your Setup)

```
Input:
  Node1: Primary Zone (example.com)
  Node2: Secondary Zone (example.com)

Decision Tree:
  1. Extract types: ["Primary Zone", "Secondary Zone"]
  2. uniqueTypes.size = 2 (different)
  3. → SKIP COMPARISON
  4. Return: []
  5. Status: IN-SYNC ✅

Reason: Primary and Secondary are different roles
```

### Scenario B: Both Primary (Dual-Master)

```
Input:
  Node1: Primary Zone (example.com)
  Node2: Primary Zone (example.com)

Decision Tree:
  1. Extract types: ["Primary Zone", "Primary Zone"]
  2. uniqueTypes.size = 1 (same)
  3. → PROCEED WITH COMPARISON
  4. Compare: Zone Transfer, Notify, etc.
  5. Return: [differences] or []
  6. Status: DIFFERENT or IN-SYNC

Reason: Both are masters, should have matching configs
```

### Scenario C: Both Secondary (Dual-Replica)

```
Input:
  Node1: Secondary Zone (upstream.com) ← from 1.2.3.4
  Node2: Secondary Zone (upstream.com) ← from 1.2.3.4

Decision Tree:
  1. Extract types: ["Secondary Zone", "Secondary Zone"]
  2. uniqueTypes.size = 1 (same)
  3. → PROCEED WITH COMPARISON
  4. Compare: Primary server, Query Access, etc.
  5. Return: [differences] or []
  6. Status: DIFFERENT or IN-SYNC

Reason: Both are replicas, should point to same upstream
```

---

## Code Implementation

```typescript
function computeZoneDifferences(zones: TechnitiumZoneSummary[]): ZoneComparisonField[] {
  // Early exit
  if (zones.length <= 1) {
    return [];
  }

  // Step 1: Extract types
  const types = zones.map((z) => z.type ?? 'unknown');
  const uniqueTypes = new Set(types);

  // Step 2: Check consistency
  if (uniqueTypes.size > 1) {
    // Different types - skip comparison
    this.logger.debug(
      `Skipping comparison for zones with different types: ${Array.from(uniqueTypes).join(', ')}`
    );
    return []; // No differences (in-sync)
  }

  // Step 3: Same type - proceed with comparison
  const baseline = zones[0];
  const shouldCompareConditional = !SECONDARY_FORWARDER_TYPES.has(baseline.type ?? '');

  // ... rest of comparison logic ...
}
```

---

## Truth Table

| Node1 Type | Node2 Type | Action | Result |
|-----------|-----------|--------|--------|
| Primary | Primary | Compare | Different/In-Sync |
| Primary | Secondary | Skip | In-Sync |
| Primary | Forwarder | Skip | In-Sync |
| Secondary | Secondary | Compare | Different/In-Sync |
| Secondary | Forwarder | Skip | In-Sync |
| Forwarder | Forwarder | Compare | Different/In-Sync |

---

## Visual Example: Your Setup

```
┌───────────────────────────────────────────┐
│  Node1 (192.168.45.5)                      │
│  ┌─────────────────────────────────────┐  │
│  │ Primary Zone: example.com           │  │
│  │ - Notify: [192.168.45.7]            │  │
│  │ - Zone Transfer: Allow [192.168.45.7]│ │
│  │ - SOA Serial: 2025101601            │  │
│  └─────────────────────────────────────┘  │
└───────────────────┬───────────────────────┘
                    │
                    │ NOTIFY + AXFR
                    ▼
┌───────────────────────────────────────────┐
│  Node2 (192.168.45.7)                      │
│  ┌─────────────────────────────────────┐  │
│  │ Secondary Zone: example.com         │  │
│  │ - Notify: (none)                    │  │
│  │ - Zone Transfer: Deny               │  │
│  │ - SOA Serial: 2025101601            │  │
│  └─────────────────────────────────────┘  │
└───────────────────────────────────────────┘

Comparison Logic:
┌───────────────────────────────────────────┐
│ Types: ["Primary Zone", "Secondary Zone"] │
│ uniqueTypes.size = 2                      │
│ → SKIP COMPARISON                         │
│ → Status: IN-SYNC ✅                      │
└───────────────────────────────────────────┘

Why: Primary and Secondary are different roles
     Their configs SHOULD differ
     This is correct DNS architecture
```

---

## Key Decision Points

```
┌─────────────────────────────────┐
│ Are zone types the same?        │
└─────────────┬───────────────────┘
              │
      ┌───────┴────────┐
      │                │
     YES              NO
      │                │
      ▼                ▼
Compare Settings   Skip Comparison
(detect drift)     (expected diff)
```

---

## Summary

- **Same Type**: Compare settings → detect configuration drift
- **Different Types**: Skip comparison → avoid false positives
- **Your Setup**: Primary + Secondary → correctly marked as in-sync
- **Result**: Accurate status reporting aligned with DNS architecture

---

*Visual representation of zone type matching logic*
*Implementation: apps/backend/src/technitium/technitium.service.ts*
