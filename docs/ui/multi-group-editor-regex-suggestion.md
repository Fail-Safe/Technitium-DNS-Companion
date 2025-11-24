# Multi-Group Domain Editor - Regex Format Suggestion

## Overview
Added smart regex format suggestion that detects plain domains in regex fields and offers to auto-format them using the standard domain + subdomain regex format: `(\.|^)domain\.com$`

## Feature Details

### What It Does
When a user types a domain in the "Blocked Regex" or "Allowed Regex" field, the system automatically:
1. Detects if the input looks like a plain domain (e.g., `9cache.com`)
2. Shows a friendly suggestion box with the properly formatted regex
3. Allows one-click application of the suggested format

### Domain + Subdomain Standard Format
```regex
(\.|^)domain\.com$
```

**Components**:
- `(\.|^)` - Matches either a dot (subdomain) or start of string (root domain)
- `domain\.com` - The domain with escaped dots
- `$` - End of string anchor

**Why It Matters**:
- Matches both `domain.com` AND `subdomain.domain.com`
- Prevents false positives (e.g., `notdomain.com`)

### Detection Logic

The system suggests formatting in these cases:

#### Case 1: Plain Domain
**Input**: `9cache.com`
**Suggestion**: `(\.|^)9cache\.com$`
**Reason**: Looks like a plain domain (no regex syntax)

#### Case 2: Partially Formatted
**Input**: `9cache\.com` (escaped dots but no prefix/suffix)
**Suggestion**: `(\.|^)9cache\.com$`
**Reason**: Already has escaped dots, just needs wrapping

#### Case 3: Missing Prefix
**Input**: `example\.com$`
**Suggestion**: `(\.|^)example\.com$`
**Reason**: Has suffix but missing prefix

#### Case 4: Missing Suffix
**Input**: `(\.|^)example\.com`
**Suggestion**: `(\.|^)example\.com$`
**Reason**: Has prefix but missing suffix

### Visual Design

**Suggestion Box** (yellow/amber theme):
```
┌─────────────────────────────────────────────────┐
│ 💡  Suggestion: Use domain + subdomain standard format to │
│     match domain and subdomains:                │
│                                                 │
│     ┌─────────────────────────────────────┐   │
│     │ (\.|^)9cache\.com$                  │   │
│     └─────────────────────────────────────┘   │
│                                  [Apply]       │
└─────────────────────────────────────────────────┘
```

**Colors**:
- Background: `#fff9e6` (light yellow)
- Border: `#ffd666` (amber)
- Code box: White background with amber border
- Text: Orange/brown for code

### User Workflow

1. User selects "Blocked Regex" from dropdown
2. Types `9cache.com` in input field
3. Yellow suggestion box appears below
4. Shows: `(\.|^)9cache\.com$`
5. User clicks "Apply" button
6. Input field updates with formatted regex
7. User submits form (adds to all selected groups)

### Smart Behavior

**Only Shows When Relevant**:
- ✅ Only for `blockedRegex` or `allowedRegex` types
- ✅ Only when input looks improvable
- ✅ Disappears when input is empty
- ✅ Disappears when already properly formatted

**Doesn't Interfere**:
- ❌ Doesn't show for exact domain types
- ❌ Doesn't show for complex regex (e.g., `(foo|bar)`)
- ❌ Doesn't force suggestion - user can ignore and submit original

## Technical Implementation

### Detection Function
```tsx
const regexSuggestion = useMemo(() => {
    if (!newDomain.trim() || !isRegexType) {
        return null;
    }

    const domain = newDomain.trim();

    // Plain domain: alphanumeric, dots, hyphens only
    const plainDomainPattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;

    if (plainDomainPattern.test(domain)) {
        return `(\\.|^)${domain.replace(/\./g, '\\.')}$`;
    }

    // Already escaped but incomplete
    if (hasEscapedDots && (!hasPrefix || !hasSuffix)) {
        let suggested = domain;
        if (!hasPrefix) suggested = `(\\.|^)${suggested}`;
        if (!hasSuffix) suggested = `${suggested}$`;
        return suggested;
    }

    return null;
}, [newDomain, activeDomainType]);
```

### Application Function
```tsx
const applyRegexSuggestion = useCallback(() => {
    if (regexSuggestion) {
        setNewDomain(regexSuggestion);
    }
}, [regexSuggestion]);
```

### Memoization
- Uses `useMemo` to avoid recalculating on every render
- Only recalculates when `newDomain` or `activeDomainType` changes
- Efficient for real-time updates as user types

## Examples

### Example 1: Basic Domain
```
Input:    google.com
Suggests: (\.|^)google\.com$
Matches:  google.com, www.google.com, analytics.google.com
Avoids:   notgoogle.com, google.com.fake.site
```

### Example 2: Subdomain
```
Input:    analytics.google.com
Suggests: (\.|^)analytics\.google\.com$
Matches:  analytics.google.com, www.analytics.google.com
Avoids:   google.com (too broad), fakeanalytics.google.com
```

### Example 3: Already Escaped
```
Input:    tracking\.site\.com
Suggests: (\.|^)tracking\.site\.com$
Result:   Adds prefix and suffix to existing escaped pattern
```

## Benefits

1. **Educational**: Teaches users the proper format through examples
2. **Time-saving**: One click vs. manual typing of complex regex
3. **Error Prevention**: Reduces typos in regex syntax
4. **Consistency**: Ensures all regex patterns follow same standard
5. **Optional**: Doesn't force users - they can still use custom regex

## Mobile Responsive
- Suggestion box stacks vertically on mobile (<768px)
- Touch-friendly "Apply" button
- Code wraps properly on narrow screens

## Files Modified

1. **MultiGroupDomainEditor.tsx**
   - Added `regexSuggestion` memoized logic
   - Added `applyRegexSuggestion` callback
   - Added suggestion UI box with Apply button

2. **App.css**
   - Added `.multi-group-editor__regex-suggestion` styles
   - Added yellow/amber theme for suggestion box
   - Added mobile responsive stacking

## Testing Checklist

- [ ] Type plain domain (e.g., `test.com`) → Shows suggestion
- [ ] Type partially formatted regex → Shows improved suggestion
- [ ] Click "Apply" → Input updates with suggested format
- [ ] Type complex regex (e.g., `(foo|bar)`) → No suggestion
- [ ] Switch to "Blocked Domain" → No suggestion
- [ ] Empty input → No suggestion
- [ ] Mobile: Suggestion box stacks vertically

---
**Status**: ✅ Complete
**Date**: October 17, 2025
