# Next Steps & Future Enhancements

This file tracks planned features and improvements for Technitium DNS Companion. Not tracked in Git.

## High Priority

### Dark Mode Toggle
Implement dark mode theme support with user preference persistence.

**Implementation details**:
- Add theme toggle button in header (sun/moon icon)
- Persist preference in localStorage
- Support system preference detection (`prefers-color-scheme`)
- CSS variables approach for easy theme switching
- Ensure all components support dark mode:
  - Tables, cards, modals
  - Status badges (maintain readability)
  - Syntax highlighting (if any)
  - Charts/graphs (if added later)
- Test for accessibility (contrast ratios)
- Mobile-friendly toggle placement

**Technical approach**:
- TailwindCSS dark mode (`class` strategy)
- Context/hook for theme state management
- Apply `dark` class to root element
- Update all existing Tailwind classes to support dark variants

### About Page / Info Section
- Add "About" page or modal with:
  - Version number display (from package.json)
  - Link to this GitHub repository: https://github.com/Fail-Safe/Technitium-DNS-Companion
  - Link to Technitium DNS project: https://github.com/TechnitiumSoftware/DnsServer
  - Credits/acknowledgments
  - License information
  - Changelog/release notes link
- Consider placement:
  - Dedicated "About" page in navigation
  - Or info icon in header/footer with modal
  - Version number in footer always visible

### Built-in Allow/Blocklist Management
Add configuration page for Technitium's native allow/blocklist functionality (does not require Advanced Blocking App).

**Reference**: https://blog.technitium.com/2018/10/blocking-internet-ads-using-dns-sinkhole.html

**Features to implement**:
- Manage allowed/blocked domain lists
- Add/remove individual domains
- Import/export blocklist URLs (similar to pi-hole)
- View currently blocked domains
- Quick actions from query logs (allow/block domain)
- Sync allow/blocklist settings across nodes

**API Endpoints to use**:
- `/api/settings/get` - Get current allow/block lists
- `/api/settings/set` - Update allow/block lists
- Check APIDOCS.md for complete list settings API

**UI Considerations**:
- Separate page or tab under DNS Filtering?
- Show which method is active (Built-in vs Advanced Blocking)
- Warning if both are enabled (may conflict)
- Mobile-friendly interface for managing lists

## Medium Priority

### General Improvements
- [ ] Add bulk export/import for all configurations
- [ ] Dashboard statistics/metrics page
- [ ] Scheduled sync tasks (cron-like)
- [ ] Notification system for sync failures
- [ ] Audit log for all configuration changes

### Advanced Blocking Enhancements
- [ ] Better regex pattern testing/validation
- [ ] Domain list templates (pre-configured categories)
- [ ] Conflict detection between allow/block lists

### DHCP Features
- [ ] Backup/restore DHCP configurations
- [ ] DHCP reservation templates
- [ ] MAC address vendor lookup

### Zone Management
- [ ] Zone file export/import
- [ ] DNS record bulk editor
- [ ] Zone transfer monitoring/alerts

## Low Priority / Nice to Have

- [ ] Multi-language support
- [ ] API documentation (Swagger/OpenAPI)
- [ ] Docker health checks improvements
- [ ] Performance metrics dashboard
- [ ] Integration tests for all API endpoints
- [ ] E2E tests for all user workflows

## Research / Investigate

- [ ] Support for Technitium DNS v15+ features (when released)
- [ ] WebSocket support for real-time updates
- [ ] Plugin/extension system
- [ ] Integration with external DNS providers
- [ ] Automated testing against multiple Technitium versions

## Notes

- Keep features mobile-friendly (primary requirement)
- Maintain backward compatibility with Technitium DNS v14.0.0+
- Document all breaking changes
- Test with both clustered and standalone node configurations
