# PWA Implementation Guide

## Overview

Technitium DNS Companion is now a fully-functional Progressive Web App (PWA) optimized for mobile DNS server management. This document covers the PWA features, installation, and testing.

## Features Implemented

### ✅ Core PWA Features

1. **Web App Manifest**
   - App name, icons, theme colors configured
   - Shortcuts to common pages (Logs, Zones, Configuration)
   - Standalone display mode for native-app feel

2. **Service Worker**
   - Auto-updates on reload (no stale content)
   - Smart caching strategies:
     - **API calls**: Network-first with 5s timeout, cache fallback
     - **Static assets**: Cache-first with 30-day expiration
     - **HTML pages**: Network-first with cache fallback
   - Offline support with cached data

3. **Install Experience**
   - Custom "Install App" button (floating bottom-right)
   - iOS-specific installation instructions modal
   - Auto-dismissible (remembers per session)
   - Works on Chrome, Edge, Safari (iOS 16.4+)

4. **Offline Mode**
   - Visual indicator banner when offline/online
   - Cached data remains accessible
   - "Back online" notification with auto-dismiss

5. **Mobile Optimizations**
   - Touch gesture optimization (prevents double-tap zoom)
   - Safe area insets for notched devices (iPhone X+)
   - Responsive layouts for all screen sizes
   - Touch-friendly tap targets (minimum 44x44px)

## Installation

### Desktop (Chrome/Edge)

1. Visit the app in Chrome or Edge
2. Click the "Install App" button (bottom-right)
3. Or use browser's install prompt in address bar
4. App appears in your applications/start menu

### iOS (Safari)

1. Open the app in Safari (must be Safari, not Chrome/Firefox)
2. Tap the "Install App" button
3. Follow the instructions:
   - Tap Share button (bottom toolbar)
   - Scroll and tap "Add to Home Screen"
   - Tap "Add" (top-right)
4. App icon appears on home screen

### Android (Chrome)

1. Visit the app in Chrome
2. Tap "Install App" button or browser's install prompt
3. Confirm installation
4. App appears in app drawer and home screen

## Testing PWA Features

### Local Development

```bash
# Build with PWA enabled
npm run build

# Preview production build (PWA only works in production)
npm run preview
```

**Note**: PWA features (service worker, install prompt) are disabled in dev mode for easier debugging. Test with production build.

### Test Checklist

- [ ] **Manifest**: Open DevTools → Application → Manifest (verify icons, name, colors)
- [ ] **Service Worker**: DevTools → Application → Service Workers (should be "activated")
- [ ] **Cache**: DevTools → Application → Cache Storage (verify cached assets)
- [ ] **Install Prompt**: Button appears bottom-right after page load
- [ ] **iOS Instructions**: On iOS, tap install button shows modal with steps
- [ ] **Offline Mode**:
  - Disconnect network
  - Banner shows "You're offline"
  - Navigate to cached pages (should work)
  - Reconnect → "Back online" banner appears
- [ ] **Auto-Update**: Make code change, rebuild, reload → new version loads automatically

### Lighthouse Audit

Run Lighthouse PWA audit to verify compliance:

```bash
# In Chrome DevTools
# 1. Open DevTools (F12)
# 2. Go to Lighthouse tab
# 3. Select "Progressive Web App" category
# 4. Click "Generate report"
```

**Expected scores**:
- PWA: 100/100 (or close)
- Performance: 90+ (with caching enabled)
- Accessibility: 95+
- Best Practices: 95+

## Configuration

### Vite Config (`vite.config.ts`)

```typescript
VitePWA({
  registerType: 'autoUpdate', // Auto-reload on update
  workbox: {
    runtimeCaching: [
      // API caching strategy
      {
        urlPattern: /^https?:\/\/.*\/api\/.*/i,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'api-cache',
          networkTimeoutSeconds: 5,
          expiration: { maxAgeSeconds: 60 * 5 }
        }
      }
      // ... more strategies
    ]
  }
})
```

### Manifest (`public/manifest.json`)

Generated automatically by `scripts/generate-pwa-icons.js`. To regenerate:

```bash
node scripts/generate-pwa-icons.js
```

### Icons

Current icons are SVG placeholders. To create production-ready PNG icons:

1. Design icons in Figma/Sketch/Illustrator
2. Export as 512x512 PNG
3. Use image optimization tool (e.g., sharp, imagemagick)
4. Generate required sizes: 192x192, 512x512, maskable variants
5. Update manifest icon paths

## Deployment

### Production Build

```bash
# Build frontend with PWA
cd apps/frontend
npm run build

# Output: dist/ folder with service worker and manifest
```

### HTTPS Requirement

**Important**: PWAs require HTTPS in production. Service workers will NOT register on HTTP (except localhost).

Current deployment on EQ12 uses HTTPS:
- Frontend: `https://eq12.home-dns.com:5174`
- Backend: `https://eq12.home-dns.com:3443`

Ensure SSL certificates are valid and trusted.

### Update Strategy

1. Make code changes
2. Build: `npm run build`
3. Deploy new `dist/` folder
4. Users get auto-update on next visit (no manual refresh needed)
5. Service worker updates in background

## Troubleshooting

### Install button doesn't appear

- **Desktop**: Check browser supports PWA (Chrome 70+, Edge 79+)
- **iOS**: Must use Safari 16.4+ (not Chrome/Firefox on iOS)
- **Android**: Must use Chrome 70+
- **All**: Check HTTPS is enabled (or using localhost)

### Service worker not registering

```javascript
// Check in browser console
navigator.serviceWorker.getRegistrations().then(registrations => {
  console.log('SW registrations:', registrations);
});
```

- Verify HTTPS is enabled
- Check DevTools → Console for errors
- Clear browser cache and reload
- Ensure `dist/sw.js` exists after build

### Offline mode not working

- Check service worker is active (DevTools → Application → Service Workers)
- Verify cache storage has entries (DevTools → Application → Cache Storage)
- Test API responses are cacheable (200 status, valid headers)
- Check `networkTimeoutSeconds` is reasonable (5s default)

### iOS install issues

- **Must use Safari**: PWA install only works in Safari on iOS
- **iOS 16.4+**: Older iOS versions have limited PWA support
- **Home screen**: Verify icon appears after "Add to Home Screen"
- **Standalone mode**: Open from home screen (not browser tab)

### Content not updating

Service worker is caching old content:

1. Open DevTools → Application → Service Workers
2. Click "Unregister" on active worker
3. Clear cache (Application → Cache Storage → Delete all)
4. Hard reload (Cmd+Shift+R / Ctrl+Shift+R)

## Browser Support

| Feature | Chrome | Edge | Safari | Firefox | Samsung Internet |
|---------|--------|------|--------|---------|------------------|
| Service Worker | ✅ 70+ | ✅ 79+ | ✅ 11.1+ | ✅ 44+ | ✅ 10+ |
| Web App Manifest | ✅ 70+ | ✅ 79+ | ✅ 16.4+ | ⚠️ Partial | ✅ 10+ |
| Install Prompt | ✅ | ✅ | ❌ (manual) | ❌ | ✅ |
| Background Sync | ✅ | ✅ | ❌ | ❌ | ✅ |
| Push Notifications | ✅ | ✅ | ⚠️ iOS 16.4+ | ✅ | ✅ |

**Legend**: ✅ Full support | ⚠️ Partial support | ❌ Not supported

## Future Enhancements

### Potential Features

- [ ] **Background Sync**: Queue changes when offline, sync when reconnected
- [ ] **Push Notifications**: Alert for DNS query anomalies or sync conflicts
- [ ] **Share Target**: Share domains directly to app for blacklist/whitelist
- [ ] **File Handling**: Import/export zone files via PWA
- [ ] **Badge API**: Show unread notification count on app icon
- [ ] **Shortcuts API**: Long-press icon for quick actions (already implemented)

### Icon Upgrade

Replace placeholder SVG with professional PNG icons:

```bash
# Install sharp for image processing
npm install --save-dev sharp

# Run generator script (future implementation)
node scripts/generate-pwa-icons-with-sharp.js
```

## References

- [PWA Documentation](https://web.dev/progressive-web-apps/)
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app/)
- [Workbox Documentation](https://developer.chrome.com/docs/workbox/)
- [iOS PWA Support](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

---

**Version**: 1.0.0
**Last Updated**: November 5, 2025
**Maintainer**: Technitium DNS Companion Team
