# Unified Search UI Update

## Summary

Refactored the Domain Lists tab to use a single unified search box with a Text/Regex toggle instead of separate search inputs. This simplifies the UI and makes it more intuitive.

## Changes Made

### Before
```
┌─────────────────────────────────────┐
│ Text Search:                        │
│ [Search domains...                ] │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Regex Filter:                       │
│ [e.g., ^.*\.google\.(com|net)$     ] │
└─────────────────────────────────────┘
```

### After
```
┌─────────────────────────────────────┐
│ Search Domains:              ✓ Valid│
│ [Search domains...     ] [Text][Regex]│
└─────────────────────────────────────┘
```

## Benefits

1. **Less Visual Clutter**: One input instead of two
2. **Clearer Intent**: Toggle makes search mode explicit
3. **Better UX**: Similar to familiar tools (VS Code, Chrome DevTools, grep tools)
4. **More Space**: Simplified layout leaves room for other features
5. **Mobile Friendly**: Toggle buttons stack nicely on small screens

## Features

### Text Mode (Default)
- Simple substring matching (case-insensitive)
- No special characters needed
- Fast and intuitive
- Example: `google` finds `google.com`, `google.net`, `api.google.com`, etc.

### Regex Mode
- Full regular expression support
- Real-time validation with visual feedback
  - ✓ Green checkmark when valid
  - ✗ Red error message when invalid
- Red border on input when regex is invalid
- Example: `^.*\.google\.(com|net)$` matches domains ending in `.google.com` or `.google.net`

### Toggle Buttons
- **Text** button: Light background, active when in text mode
- **Regex** button: Light background, active when in regex mode
- Active state: Blue background with white text
- Hover effect on inactive buttons
- Click to switch modes instantly

## Implementation Details

### State Changes
- Removed: `regexFilter` (separate state)
- Changed: `searchFilter` now used for both modes
- Added: `searchMode: 'text' | 'regex'` to track current mode

### Logic Changes
- Single validation effect triggered only in regex mode
- Unified filtering logic that checks `searchMode` to decide behavior
- Placeholder text changes based on mode

### CSS Additions
- `.dns-lookup__search-container`: Flexbox layout for input + toggle
- `.dns-lookup__search-input`: Flexible input that takes available space
- `.dns-lookup__search-mode-toggle`: Container for toggle buttons
- `.dns-lookup__toggle-button`: Individual toggle button styling
- `.dns-lookup__toggle-button--active`: Active state (blue background)
- Mobile responsive: Toggle buttons stack below input on small screens

## User Workflow

### Text Search Example
1. Start typing in search box: `facebook`
2. See instant results: facebook.com, m.facebook.com, etc.
3. Refine by typing more: `facebook.com` to narrow results

### Regex Search Example
1. Click "Regex" toggle button
2. Start typing regex: `^.*\.google\.`
3. See validation feedback as you type
4. Complete pattern: `^.*\.google\.(com|net)$`
5. See filtered results matching the pattern

### Switching Modes
1. Type text search: `google`
2. See 1000+ results
3. Click "Regex" to switch modes
4. Your search text is preserved
5. Add regex syntax: `^google\.com$`
6. See refined results

## Future Enhancements

Possible future improvements:
- Regex pattern library/presets (common patterns like "match TLD", "starts with", etc.)
- Search history (recent searches)
- Save favorite searches
- Share search URLs (query string parameters)
- Keyboard shortcuts (Ctrl+F for focus, Ctrl+R for regex toggle)
