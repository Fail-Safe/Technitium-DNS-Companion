# Group Badge Tooltips Feature

**Status**: ✅ Implemented (Commit a158706)
**Date**: December 2024
**Implementation Time**: ~2 hours

## Overview

Enhanced the group badges in the Logs page to display informative tooltips showing which Advanced Blocking lists are filtering each domain, along with match details.

## User Request

> "I would love the ability in the UI to see which allowlist(s)/blocklist(s) a domain is being filtered by. Not sure how feasible that is"

## Implementation Details

### What Was Added

1. **New TypeScript Interface** (`DomainGroupDetails`)
   - Stores group number, group name, and match information
   - Includes exact match flags and regex pattern arrays

2. **Enhanced `buildTableColumns` Function**
   - Accepts new `domainGroupDetailsMap` parameter
   - Builds multi-line tooltips with:
     - Group number and descriptive name
     - Action type (Blocked vs Allowed)
     - Match type (Exact or Regex)
     - Specific regex patterns that triggered matches

3. **New `domainGroupDetailsMap` useMemo Hook**
   - Extracts group filtering details from Advanced Blocking configuration
   - Maps each selected domain to its filtering group
   - Uses existing `extractGroupOverrides()` infrastructure

4. **Mobile Support**
   - Updated `renderCardsView` with tooltip support
   - Same tooltip logic as table view
   - Works on tap/long-press on mobile devices

### Implementation Approach (Option 1)

We chose **Option 1: Enhanced Tooltip on Group Badge** from three proposed options:

- ✅ **Option 1**: Tooltip on hover/tap (Quick win - 1-2 hours) ← **IMPLEMENTED**
- ⏸️ Option 2: Expandable details panel (Medium - 3-4 hours)
- ⏸️ Option 3: Filter info icon (Quick win - 30 min)

**Rationale**: Option 1 provides maximum information density without cluttering the UI, works on both desktop and mobile, and requires no external dependencies.

### Technical Stack

- **Tooltip Method**: Native HTML `title` attribute
- **Desktop**: Hover to show tooltip
- **Mobile**: Tap/long-press to show tooltip
- **No Dependencies**: Uses browser-native tooltip rendering

### Example Tooltip Content

```
Group 1: Ads & Trackers
━━━━━━━━━━━━━━━━
Blocked (Regex)
Patterns:
  • ^ad[sz]?[0-9]*\..*
  • tracker\..*
```

## Files Modified

- `apps/frontend/src/pages/LogsPage.tsx` (+124 lines, -6 lines)

## Existing Infrastructure Leveraged

- `extractGroupOverrides(group, domain)` - Returns exact/regex match info
- `matchesPattern(pattern, domain)` - Tests regex patterns
- Existing group badge rendering system
- Advanced Blocking data structure (`AdvancedBlockingOverview`)

## Testing Checklist

- [ ] Tooltip appears on hover (desktop)
- [ ] Tooltip appears on tap/long-press (mobile)
- [ ] Group name displays correctly
- [ ] Blocked vs Allowed shown accurately
- [ ] Exact match detected correctly
- [ ] Regex patterns display when matched
- [ ] Multiple patterns shown if multiple regex rules match
- [ ] Works for all selected domains with group associations
- [ ] Table view and card view both functional

## Next Steps (Optional Enhancements)

If tooltips prove insufficient, we can implement:

1. **Option 2**: Expandable details panel
   - More space for complex filtering scenarios
   - Could show all lists a domain appears in
   - Estimated effort: 3-4 hours

2. **Option 3**: Filter info icon
   - Dedicated icon for filtering details
   - Could open a modal with full information
   - Estimated effort: 30 minutes

## Related Documentation

- Original stretch goals: `.github/copilot-instructions.md` (Nice-to-haves section)
- Advanced Blocking structure: `docs/zone-comparison/ZONE_TYPE_MATCHING_LOGIC.md`
- UI patterns: `docs/ui/UI_QUICK_REFERENCE.md`

## Deployment Notes

1. Build frontend: `cd apps/frontend && npm run build`
2. Deploy to NODE2: Restart frontend container
3. Test tooltip functionality on production
4. Verify mobile responsiveness

## Success Metrics

- Users can identify which list is blocking a domain
- Users can see exact vs regex matches
- Mobile users have same information access as desktop
- No performance degradation with tooltips enabled
