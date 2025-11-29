# UI Components Quick Reference

Quick reference guide for using the new UI components and styles.

## Iconography

### Emojis

!Important: Do NOT use unless absolutely necessary. Prefer FontAwesome icons.

### Using FontAwesome Icons
```tsx
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSync } from '@fortawesome/free-solid-svg-icons';

<FontAwesomeIcon icon={faSync} />
```

### FontAwesome Icon Sizing
```tsx
<FontAwesomeIcon icon={faCode} style={{ fontSize: '1.25em' }} />
```

### FontAwesome Layered Icons
```tsx
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircle, faCheck } from '@fortawesome/free-solid-svg-icons';

export function ExamplePage() {
    // Custom layered icon
    const LayeredIcon: React.FC<{
        backgroundIcon: IconDefinition;
        foregroundIcon: IconDefinition;
        bgColor: string;
        fgColor: string;
        bgFontSize?: string;
        fgFontSize?: string;
    }> = ({ backgroundIcon, foregroundIcon, bgColor, fgColor, bgFontSize, fgFontSize }) => (
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <FontAwesomeIcon icon={backgroundIcon} style={{ color: bgColor, fontSize: bgFontSize }} />
            <FontAwesomeIcon icon={foregroundIcon} style={{ position: 'absolute', color: fgColor, fontSize: fgFontSize }} />
        </div>
    );

    return (
        <>
          <button
              type="button"
              onClick={() => setActiveDomainType('blockedRegex')}
              style={{
                  padding: '0.6rem 0.5rem',
                  borderRadius: '0.5rem',
                  border: activeDomainType === 'blockedRegex' ? '1px solid #f2dede' : '1px solid #dce3ee',
                  background: activeDomainType === 'blockedRegex' ? '#f2dede' : '#ffffff',
                  color: activeDomainType === 'blockedRegex' ? '#a94442' : '#5d6786',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  transition: 'all 0.5s',
              }}
          >
              <LayeredIcon backgroundIcon={faCode} foregroundIcon={faBan}
                  bgColor="#5d6786" fgColor={activeDomainType === 'blockedRegex' ? '#a94442' : '#5d6786'}
                  bgFontSize='0.85em' fgFontSize='1.5em' /> Blocked Regex
          </button>
        </>
    );
}
```

## Buttons

### Basic Usage
```tsx
// Primary action button
<button className="button primary">Save Changes</button>

// Secondary action button
<button className="button secondary">Cancel</button>

// Danger/destructive action
<button className="button danger">Delete Zone</button>

// Disabled state
<button className="button primary" disabled>Disabled</button>

// Loading state
<button className="button primary button--loading">
  Loading...
</button>
```

### With Iconography
```tsx
<button className="button primary">
  <FontAwesomeIcon icon={faSync} />
  <span>Sync Now</span>
</button>
```

---

## Badges

### Status Badges
```tsx
// Success
<span className="badge badge--success">Online</span>

// Error
<span className="badge badge--error">Failed</span>

// Warning
<span className="badge badge--warning">Pending</span>

// Info
<span className="badge badge--info">Syncing</span>

// Muted/Neutral
<span className="badge badge--muted">Disabled</span>
```

### Badge without dot indicator
```tsx
// Override the ::before pseudo-element in custom CSS
<span className="badge badge--success" style={{ paddingLeft: '0.75rem' }}>
  Custom Badge
</span>
```

---

## Loading States

### Skeleton Loaders
```tsx
// Text loading
<div className="skeleton skeleton--text" />
<div className="skeleton skeleton--text" style={{ width: '80%' }} />
<div className="skeleton skeleton--text" style={{ width: '60%' }} />

// Title loading
<div className="skeleton skeleton--title" />

// Card loading
<div className="skeleton skeleton--card" />

// Custom skeleton
<div className="skeleton" style={{ height: '100px', borderRadius: '1rem' }} />
```

### Button Loading
```tsx
const [loading, setLoading] = useState(false);

<button
  className={`button primary ${loading ? 'button--loading' : ''}`}
  disabled={loading}
  onClick={handleClick}
>
  {loading ? 'Processing...' : 'Submit'}
</button>
```

---

## Cards

### Basic Card Structure
```tsx
<div className="zones-page__zone-card">
  <header className="zones-page__zone-header">
    <h2 className="zones-page__zone-name">example.com</h2>
    <span className="badge badge--success">In Sync</span>
  </header>

  <div className="zones-page__differences">
    <span className="badge badge--info">Type</span>
    <span className="badge badge--info">DNSSEC</span>
  </div>

  <div className="zones-page__zone-nodes">
    {/* Node cards here */}
  </div>
</div>
```

### Summary Card
```tsx
<div className="zones-page__summary-card">
  <dt>Total zones</dt>
  <dd>42</dd>
</div>
```

### Node Card
```tsx
<div className="zones-page__node-card">
  <div className="zones-page__node-title">Node1</div>
  <div className="zones-page__node-meta">
    <span>256 zones</span>
    <span>Updated 2 minutes ago</span>
  </div>
</div>
```

---

## Filter Buttons

### Filter Group
```tsx
const [filter, setFilter] = useState('all');

<div className="zones-page__filters">
  {['all', 'different', 'missing', 'in-sync'].map((option) => (
    <button
      key={option}
      className={`zones-page__filter-button ${
        filter === option ? 'zones-page__filter-button--active' : ''
      }`}
      onClick={() => setFilter(option)}
    >
      <span>{formatLabel(option)}</span>
      <span className="zones-page__filter-count">{counts[option]}</span>
    </button>
  ))}
</div>
```

---

## Zone Node Details

### Node with Details
```tsx
<section className="zones-page__zone-node">
  <div className="zones-page__zone-node-title">Node1</div>
  <dl className="zones-page__details">
    <dt>Type</dt>
    <dd>Primary</dd>
    <dt>SOA Serial</dt>
    <dd>2025101501</dd>
    <dt>Last Modified</dt>
    <dd>Oct 15, 2025, 4:32 PM</dd>
  </dl>
</section>
```

### Node with Error
```tsx
<section className="zones-page__zone-node">
  <div className="zones-page__zone-node-title">Node2</div>
  <p className="zones-page__zone-node-error">
    Failed to connect to node
  </p>
</section>
```

### Node Missing
```tsx
<section className="zones-page__zone-node">
  <div className="zones-page__zone-node-title">Node2</div>
  <p className="zones-page__zone-node-missing">
    Zone not present.
  </p>
</section>
```

---

## Page Layouts

### Standard Page
```tsx
<div className="zones-page">
  <div className="zones-page__header">
    <div>
      <h1 className="zones-page__title">Page Title</h1>
      <p className="zones-page__subtitle">Description here</p>
    </div>
    <button className="button primary">Action</button>
  </div>

  {/* Page content */}
</div>
```

### With Error State
```tsx
<div className="zones-page__header">
  <div>
    <h1 className="zones-page__title">Page Title</h1>
    <p className="zones-page__subtitle">Description</p>
    {error && (
      <p className="zones-page__error">{error}</p>
    )}
  </div>
</div>
```

### Overview Grid
```tsx
<div className="zones-page__overview">
  <section className="zones-page__summary">
    {/* Summary cards */}
  </section>

  <section className="zones-page__nodes">
    {/* Node cards */}
  </section>
</div>
```

---

## Responsive Grid Layouts

### Auto-fit Grid
```tsx
<div style={{
  display: 'grid',
  gap: '1rem',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))'
}}>
  {items.map(item => <Card key={item.id} {...item} />)}
</div>
```

### Two-column with Responsive
```tsx
<div className="zones-page__overview">
  {/* Automatically adjusts to single column on mobile */}
</div>
```

---

## Navigation

### Nav Link with Icon
```tsx
<NavLink
  to="/zones"
  className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
>
  <span className="nav-link__icon"><FontAwesomeIcon icon={faZone} /></span>
  <span className="nav-link__label">Zones</span>
</NavLink>
```

---

## Empty States

### Simple Empty State
```tsx
<div className="zones-page__empty">
  No zones match the current filter.
</div>
```

### Empty State with Action
```tsx
<div className="zones-page__empty">
  <p>No zones configured yet.</p>
  <button className="button primary" onClick={handleCreate}>
    Create First Zone
  </button>
</div>
```

---

## Common Patterns

### Loading Pattern
```tsx
{loading ? (
  <>
    <div className="skeleton skeleton--title" />
    <div className="skeleton skeleton--text" />
    <div className="skeleton skeleton--card" />
  </>
) : (
  <ActualContent />
)}
```

### Error Pattern
```tsx
{error ? (
  <p className="zones-page__error">{error}</p>
) : (
  <Content />
)}
```

### Success Pattern
```tsx
{success && (
  <div style={{
    padding: '1rem',
    background: 'linear-gradient(135deg, #e8f5ee 0%, #d4eedd 100%)',
    border: '1px solid #b8ddc4',
    borderRadius: '0.75rem',
    color: '#2f6f2f'
  }}>
    ✅ {successMessage}
  </div>
)}
```

### Conditional Rendering
```tsx
<div className={`button primary ${isLoading ? 'button--loading' : ''}`}>
  {isLoading ? 'Processing...' : 'Submit'}
</div>
```

---

## Utility Classes

### Display
- No built-in utility classes, use inline styles or custom classes

### Spacing
- Use component-specific spacing (e.g., `zones-page__` prefixed classes)

### Colors
- Use semantic badge classes for colored elements
- Use gradient backgrounds in component styles

---

## Animation Classes

### Hover States
Most components have built-in hover states:
- Cards lift up (-2px to -4px)
- Buttons lift up (-2px)
- Shadows intensify
- Border colors change

### Custom Animations
```tsx
// Add custom animations in your component CSS
.my-component {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.my-component:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(26, 31, 45, 0.1);
}
```

---

## Best Practices

### Do's ✅
- Use semantic button classes (`.button.primary`, `.button.secondary`)
- Use loading states for async operations
- Use skeleton loaders for initial page loads
- Use badges for status indicators
- Use consistent spacing with component classes
- Use hover effects for interactive elements

### Don'ts ❌
- Don't mix button styles (stick to defined classes)
- Don't create custom badge colors (use semantic colors)
- Don't override transitions without good reason
- Don't use inline styles when component classes exist
- Don't forget loading/disabled states
- Don't skip hover states on interactive elements

---

## Accessibility

### Always Include
- Proper button types (`type="button"`)
- Disabled states when appropriate
- ARIA labels for icon-only buttons
- Semantic HTML (`<button>`, `<nav>`, `<section>`)
- Keyboard navigation support

### Example
```tsx
<button
  type="button"
  className="button primary"
  aria-label="Refresh zones"
  disabled={loading}
  onClick={handleRefresh}
>
  <FontAwesomeIcon icon={faRefresh} /> Refresh
</button>
```

---

## Dark Mode (Future)

Currently not implemented, but designed with dark mode in mind:
- All colors use CSS custom properties (easy to theme)
- Gradients can be adjusted via CSS variables
- Shadow colors are semi-transparent (adapt to backgrounds)

---

## Performance Tips

1. **Use Skeleton Loaders**: Better perceived performance
2. **Lazy Load**: Use React.lazy for route-based splitting
3. **Optimize Images**: Use appropriate formats and sizes
4. **Minimize Animations**: On low-end devices
5. **Use CSS Transitions**: Better than JavaScript animations

---

## Troubleshooting

### Button not showing gradient
- Check that you're using `.button.primary` not just `.primary`
- Ensure no conflicting styles override the gradient

### Hover effects not working
- Check for `pointer-events: none` on parent
- Ensure element has proper cursor style
- Check z-index stacking

### Loading spinner not showing
- Verify `.button--loading` class is applied
- Check that button has `disabled` attribute
- Ensure content is not overriding ::after pseudo-element

### Mobile menu not sliding
- Check that `.app-header__nav--open` class is toggling
- Verify transform transitions are not disabled
- Check z-index conflicts

---

## Support

For issues or questions:
- Check `UI_IMPROVEMENTS.md` for detailed documentation
- Check `UI_VISUAL_GUIDE.md` for visual examples
- Review `/apps/frontend/src/App.css` for implementation details
