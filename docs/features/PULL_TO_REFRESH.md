# Pull-to-Refresh Feature

## Overview

The PWA now supports native pull-to-refresh functionality on mobile devices. Users can pull down from the top of the screen to refresh data.

## Implementation

### Hook: `usePullToRefresh`

Located in `apps/frontend/src/hooks/usePullToRefresh.ts`

**Features:**
- Touch-based gesture detection
- Configurable pull threshold (default 80px)
- Resistance effect (diminishing returns as you pull further)
- Only activates when scrolled to top
- Prevents accidental triggers
- Can be disabled per-page

**Usage:**
```tsx
const pullToRefresh = usePullToRefresh({
    onRefresh: async () => {
        await fetchData();
    },
    threshold: 80,
    disabled: false,
});

return (
    <div ref={pullToRefresh.containerRef}>
        <PullToRefreshIndicator
            pullDistance={pullToRefresh.pullDistance}
            threshold={pullToRefresh.threshold}
            isRefreshing={pullToRefresh.isRefreshing}
        />
        {/* Your content */}
    </div>
);
```

### Component: `PullToRefreshIndicator`

Located in `apps/frontend/src/components/common/PullToRefreshIndicator.tsx`

**Visual States:**
1. **Pulling**: Shows rotating arrow icon with "Pull to refresh" text
2. **Ready**: At threshold, shows "Release to refresh" message
3. **Refreshing**: Shows animated spinner with "Refreshing..." text

**Styling:**
- Fixed position at top center of screen
- Smooth animations and transitions
- Dark mode support
- Non-intrusive, positioned above content

## Pages with Pull-to-Refresh

### ✅ Overview Page (`/`)
- Refreshes node status and statistics
- Disabled when no nodes configured

### ✅ DNS Logs Page (`/logs`)
- Refreshes query logs
- Works in both paginated and tail modes
- Integrates with existing auto-refresh system

## User Experience

### Mobile Behavior:
1. User scrolls to top of page
2. User pulls down with finger
3. Indicator appears showing pull progress
4. At 80px threshold, message changes to "Release to refresh"
5. User releases finger
6. Spinner shows while refreshing
7. Data updates, indicator disappears

### Design Principles:
- ✅ **Native feel**: Mimics standard iOS/Android pull-to-refresh
- ✅ **Visual feedback**: Clear indication of pull distance and refresh state
- ✅ **Smooth animations**: 60fps animations with requestAnimationFrame
- ✅ **Accessibility**: Doesn't interfere with normal scrolling
- ✅ **Performance**: Minimal overhead, only active on mobile

## Browser Compatibility

Tested and working on:
- ✅ iOS Safari (iPhone)
- ✅ Chrome Mobile (Android)
- ✅ PWA mode (installed apps)
- ✅ Desktop browsers (no effect, gracefully ignored)

## Future Enhancements

Potential improvements:
- [ ] Add haptic feedback on iOS devices
- [ ] Add to additional pages (Configuration, DNS Zones, DHCP)
- [ ] Customize indicator per page (different colors/icons)
- [ ] Add pull-to-refresh to individual components (not just pages)
