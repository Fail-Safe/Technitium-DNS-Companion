# Query Logs: New Features Visual Guide

## Date/Time Filters

### Filter Controls Location
```
┌─────────────────────────────────────────────────────────────────┐
│ Query Logs                                          [⚙️ Settings]│
├─────────────────────────────────────────────────────────────────┤
│ Statistics Bar (expandable)                                     │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Total: 1,234  Allowed: 890  Blocked: 344  Cached: 567     │ │
│ └─────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│ Quick Filters                                                    │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Domain: [____________] Client: [____________]              │ │
│ │ Status: [All ▾]        Response: [All ▾]                   │ │
│ │                                                             │ │
│ │ ╔══════════════════════════════════════════════════════╗   │ │
│ │ ║ Start Date/Time: [2025-10-18T10:00]                 ║   │ │
│ │ ║ End Date/Time:   [2025-10-18T15:30]                 ║   │ │
│ │ ║ ─────────────────────────────────────────────────── ║   │ │
│ │ ║ [Last Hour] [Last 24h] [Today] [Yesterday] [Clear] ║   │ │
│ │ ╚══════════════════════════════════════════════════════╝   │ │
│ │                                                             │ │
│ │                                        [Clear filters]      │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Date Input Fields

**Native HTML5 datetime-local input**:
```
Start Date/Time: [📅 10/18/2025 ⏰ 10:00 AM]
                  ↑
                  Clicking opens browser-native picker
```

### Quick Preset Buttons

```
┌──────────────────────────────────────────────────────────┐
│ Quick Date Range Presets:                               │
├──────────────────────────────────────────────────────────┤
│ [Last Hour]  → Last 60 minutes from now                 │
│ [Last 24h]   → Last 24 hours from now                   │
│ [Today]      → Midnight to current time                 │
│ [Yesterday]  → Previous day (00:00-23:59)               │
│ [Clear Dates]→ Remove date filters (red button)         │
└──────────────────────────────────────────────────────────┘
```

### Button States

**Normal State**:
```
┌─────────────┐
│ Last Hour   │ ← White background, gray border
└─────────────┘
```

**Hover State**:
```
┌─────────────┐
│ Last Hour   │ ← Light blue background, darker border
└─────────────┘
```

**Clear Button (when dates active)**:
```
┌──────────────┐
│ Clear Dates  │ ← Light red background, red text
└──────────────┘
```

## Domain Deduplication

### Table Settings Toggle

```
┌────────────────────────────────────────────────────────┐
│ Table settings                                         │
├────────────────────────────────────────────────────────┤
│ Adjust which optional columns appear in the logs table.│
│                                                         │
│ Column Visibility:                                     │
│ ☑ Protocol                                            │
│ ☑ Response Type                                       │
│ ☑ Response Code                                       │
│ ☑ Query Class                                         │
│                                                         │
│ ╔═══════════════════════════════════════════════════╗ │
│ ║ Display Options:                                  ║ │
│ ║ ☑ Deduplicate Domains                            ║ │
│ ║   Show only one query per domain instead of      ║ │
│ ║   separate rows for each query type (A, AAAA,    ║ │
│ ║   HTTPS, etc.). When enabled, the QTYPE column   ║ │
│ ║   will be hidden.                                 ║ │
│ ╚═══════════════════════════════════════════════════╝ │
│                                                         │
│ Live Tail Settings:                                    │
│ Buffer Size: [200 entries ▾]                          │
└────────────────────────────────────────────────────────┘
```

### Deduplication Effect

**Before (Deduplication OFF)**:
```
┌──────────────┬───────────────┬───────┬─────────────┐
│ Timestamp    │ Domain        │ QTYPE │ Answer      │
├──────────────┼───────────────┼───────┼─────────────┤
│ 15:30:45.123 │ example.com   │ A     │ 192.0.2.1   │
│ 15:30:45.124 │ example.com   │ AAAA  │ 2001:db8::1 │
│ 15:30:45.125 │ example.com   │ HTTPS │ (priority)  │
│ 15:30:46.001 │ google.com    │ A     │ 142.250... │
│ 15:30:46.002 │ google.com    │ AAAA  │ 2607:f8b0..│
└──────────────┴───────────────┴───────┴─────────────┘
   5 entries shown
```

**After (Deduplication ON)**:
```
┌──────────────┬───────────────┬─────────────┐
│ Timestamp    │ Domain        │ Answer      │ (QTYPE hidden)
├──────────────┼───────────────┼─────────────┤
│ 15:30:45.123 │ example.com   │ 192.0.2.1   │ ← Kept A record
│ 15:30:46.001 │ google.com    │ 142.250... │ ← Kept A record
└──────────────┴───────────────┴─────────────┘
   2 entries shown (deduplicated from 5)
```

### Priority System Visualization

```
┌─────────────────────────────────────────────────────────┐
│ Deduplication Priority Rules (Higher Priority Wins)    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Priority 1: BLOCKED entries                           │
│     ↓                                                   │
│  Priority 2: ALLOWED entries                           │
│                                                         │
│  Within same block status:                             │
│     Priority A: A records (most common)                │
│        ↓                                                │
│     Priority B: Other query types (AAAA, HTTPS, etc.)  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Example Scenarios

**Scenario 1: Mixed Query Types (All Allowed)**
```
Input entries:
  • example.com AAAA  → ALLOWED
  • example.com A     → ALLOWED  ← This one kept (A record priority)
  • example.com HTTPS → ALLOWED

Result: Shows example.com A record
```

**Scenario 2: Blocked + Allowed**
```
Input entries:
  • ads.tracker.com A     → ALLOWED
  • ads.tracker.com AAAA  → BLOCKED  ← This one kept (blocked priority)
  • ads.tracker.com HTTPS → ALLOWED

Result: Shows ads.tracker.com AAAA (blocked status more important)
```

**Scenario 3: All Same Type**
```
Input entries:
  • example.com A → ALLOWED ← This one kept (first occurrence)
  • example.com A → ALLOWED
  • example.com A → ALLOWED

Result: Shows first example.com A record
```

## Combined Features in Action

### Use Case: Investigating Yesterday's Blocked Queries

**Step 1: Apply Date Filter**
```
Click [Yesterday] preset button
→ Sets: Start: 2025-10-17T00:00, End: 2025-10-17T23:59
```

**Step 2: Filter by Status**
```
Status: [Blocked ▾] ← Select "Blocked"
```

**Step 3: Enable Deduplication**
```
Open [⚙️ Settings] → Check ☑ Deduplicate Domains
```

**Result**:
```
┌──────────────┬────────────────────┬─────────────┐
│ Timestamp    │ Domain             │ Answer      │
├──────────────┼────────────────────┼─────────────┤
│ Oct 17 08:23 │ ads.tracker.com    │ BLOCKED     │
│ Oct 17 10:15 │ malware.site.evil  │ BLOCKED     │
│ Oct 17 14:47 │ tracking.pixel.io  │ BLOCKED     │
└──────────────┴────────────────────┴─────────────┘
   3 unique blocked domains yesterday
```

### Mobile Layout

**Filters Stack Vertically on Small Screens**:
```
┌──────────────────────────┐
│ Domain: [______________] │
├──────────────────────────┤
│ Client: [______________] │
├──────────────────────────┤
│ Status: [All ▾]          │
├──────────────────────────┤
│ Response: [All ▾]        │
├──────────────────────────┤
│ Start: [2025-10-18T10:00]│
├──────────────────────────┤
│ End: [2025-10-18T15:30]  │
├──────────────────────────┤
│ [Last Hour] [Last 24h]   │
│ [Today] [Yesterday]      │
│ [Clear Dates]            │
├──────────────────────────┤
│    [Clear filters]       │
└──────────────────────────┘
```

## Visual Design Details

### Date Preset Button Colors

```css
/* Normal buttons */
background: #ffffff
border: 1px solid #cfd6e4
color: #4b5778

/* Hover state */
background: #f3f6fb
border: 1px solid #a5b2cc
color: #1e2841

/* Clear button (red variant) */
background: #fff5f5
border: 1px solid #ffcccc
color: #cc3333
```

### Date Preset Section Border

```
The preset buttons section has:
- Top border: 1px solid #e8ecf4
- Padding top: 0.5rem
- Full width (flex-basis: 100%)
- Wraps on small screens
```

### Settings Modal Layout

```
┌─────────────────────────────────────┐
│ Table settings              [Close] │
├─────────────────────────────────────┤
│                                     │
│ Column Visibility                   │
│ [Checkboxes for columns...]         │
│                                     │
│ ─────────────────────────────────── │ ← Visual separator
│                                     │
│ Display Options            ← NEW    │
│ [Deduplication checkbox]            │
│                                     │
│ ─────────────────────────────────── │
│                                     │
│ Live Tail Settings                  │
│ [Buffer size dropdown]              │
│                                     │
└─────────────────────────────────────┘
```

## Accessibility Features

### Date Inputs
- Native `datetime-local` input provides keyboard navigation
- Clear labels: "Start Date/Time", "End Date/Time"
- Placeholder text guides users

### Preset Buttons
- `title` attributes for tooltips on hover
- Descriptive button text
- Visual feedback on hover/active states
- "Clear Dates" only appears when relevant

### Deduplication Toggle
- Checkbox with descriptive label
- Helper text explains behavior
- Clearly states QTYPE column will hide

## Animation & Transitions

```css
/* Button interactions */
.logs-page__date-preset {
    transition: all 0.15s ease;
}

/* Active state feedback */
.logs-page__date-preset:active {
    transform: translateY(1px); /* Subtle press effect */
}

/* Statistics bar when filtering */
opacity transition: 0.15s ease
```

## Storage & Persistence

### LocalStorage Keys

```javascript
// Deduplication preference
'technitiumLogs.deduplicateDomains' → boolean

// Date filters (NOT persisted currently)
// User must re-select dates each session
```

### Future Enhancement: Date Persistence

```javascript
// Could add:
'technitiumLogs.lastStartDate' → ISO string
'technitiumLogs.lastEndDate' → ISO string
'technitiumLogs.rememberDateFilter' → boolean
```

## Keyboard Shortcuts (Future Enhancement)

```
Potential shortcuts:
Ctrl+D → Toggle deduplication
Ctrl+T → Focus start date input
Ctrl+1 → Apply "Last Hour" preset
Ctrl+2 → Apply "Last 24h" preset
Ctrl+Shift+C → Clear date filters
```

## Browser Compatibility

### Date Input Support
- ✅ Chrome/Edge: Full support with native picker
- ✅ Firefox: Full support with native picker
- ✅ Safari: Full support (iOS has excellent datetime picker)
- ⚠️ Fallback: Text input if browser doesn't support datetime-local

### Map() and Array.from()
- ✅ All modern browsers (ES6+)
- Deduplication uses Map for O(n) performance

## Performance Indicators

```
Before Deduplication:
┌─────────────────────────────────────┐
│ Total: 5,000 entries                │
└─────────────────────────────────────┘

After Deduplication:
┌─────────────────────────────────────┐
│ Total: 1,200 entries (deduplicated) │
│ ↑ 76% reduction in rows            │
└─────────────────────────────────────┘
```

## Error States & Edge Cases

### Empty Date Range
```
User sets: Start > End
Backend handles: Returns empty result set
UI shows: "No entries found" message
```

### Future Date
```
User sets: End = tomorrow
Backend handles: Returns entries up to current time
UI shows: Normal results
```

### No Results
```
Date range has no matching entries
┌─────────────────────────────────────┐
│ No query logs found for this period │
│ Try adjusting your date range or    │
│ clearing filters.                   │
└─────────────────────────────────────┘
```

## Testing Screenshots (To Be Captured)

1. Date filters with all presets visible
2. "Clear Dates" button in red styling
3. Deduplication checkbox in settings
4. Table with QTYPE column visible
5. Table with QTYPE column hidden (deduplicated)
6. Mobile layout with stacked filters
7. Date picker native UI (varies by browser/OS)
8. Combined filters + deduplication + dates active

---

**Visual Guide Version**: 1.0
**Last Updated**: October 18, 2025
**Related Docs**: `query-logs-deduplication-and-date-filters.md`
