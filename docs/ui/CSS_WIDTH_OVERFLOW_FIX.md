# CSS Width Overflow Fix

## Problem
Grid and flex children were expanding beyond their container width, causing massive negative margins and pushing content off-screen. This was particularly evident in the Zones page where elements were showing widths like 2188px on a ~1280px viewport.

## Root Cause
1. **Missing `box-sizing: border-box`** - Padding was adding to width instead of being included
2. **Missing `max-width: 100%`** - Elements could expand beyond parent
3. **Missing `min-width: 0`** - Critical for flex/grid children to properly shrink
4. **`.app-content--wide` had `max-width: none`** - Allowed unconstrained expansion

## Solution Applied

### 1. Global Width Constraints (Top of App.css)
```css
* {
  box-sizing: border-box;
}

[class*="__list"],
[class*="__grid"],
[class*="__items"],
[class*="__details"],
[class*="__body"],
[class*="__content"],
[class*="__header"],
[class*="-grid"],
[class*="-body"],
[class*="-content"] {
  max-width: 100%;
  min-width: 0;
}
```

### 2. Container Constraints
- `.app-content--wide`: Added `max-width: 100vw`, `box-sizing: border-box`, `overflow-x: hidden`
- `.zones-page`: Added width constraints and `overflow-x: hidden`
- `.zones-page__list`: Set to `grid-template-columns: 1fr` temporarily, with full width constraints

### 3. Specific Element Fixes
Applied to all zones page elements:
- `.zones-page__zone-card`
- `.zones-page__zone-header`
- `.zones-page__zone-name`
- `.zones-page__differences`
- `.zones-page__zone-nodes`
- `.zones-page__zone-node`
- `.zones-page__zone-node-body`
- `.zones-page__details-grid`
- `.zones-page__detail-item`
- `.zones-page__detail-label`
- `.zones-page__detail-value`

Each received:
```css
max-width: 100%;
width: 100%; /* where appropriate */
box-sizing: border-box;
min-width: 0; /* for flex/grid children */
overflow: hidden; /* where needed */
```

## Prevention
The global rules at the top of `App.css` should prevent this issue in:
- Logs page
- DHCP page
- Migration page
- Future pages

The pattern matching catches common BEM naming conventions automatically.

## Testing Checklist
- [x] Zones page displays without horizontal scroll
- [ ] Zones page works on mobile (< 768px)
- [ ] Zones page works on tablet (768px - 1024px)
- [ ] Zones page works on desktop (> 1024px)
- [ ] Logs page checked for similar issues
- [ ] DHCP page checked for similar issues
- [ ] All pages work with browser zoom at 50%, 100%, 150%, 200%

## Notes
- The zones page is currently set to single column (`grid-template-columns: 1fr`)
- Once width issues are fully resolved, can restore multi-column layout
- Monitor DevTools Box Model for any elements showing negative margins
- The `min-width: 0` is critical for grid children - don't remove it!
