# Technitium DNS Companion - Documentation

Welcome to the documentation for Technitium DNS Companion. This guide will help you understand, deploy, and contribute to the project.

## 📚 Documentation Structure

### 🚀 Getting Started

- **[../README.md](../README.md)** - Project overview and quick start
- **[../DOCKER.md](../DOCKER.md)** - Docker deployment guide (production & development)
- **[../DEVELOPMENT.md](../DEVELOPMENT.md)** - Development setup and contributing guide

### 🏗️ Architecture & Design

- **[architecture.md](./architecture.md)** - System design, component overview, and architecture decisions
- **[TESTING.md](./TESTING.md)** - Testing strategy, running tests, and coverage

### 🔧 Development

- **[REMOTE_DEVELOPMENT.md](./REMOTE_DEVELOPMENT.md)** - Remote development setup (develop on a server, edit locally)
- **[RELEASING.md](./RELEASING.md)** - Release process and sanity checklist (tag-driven)

### ⚡ Performance

- **[performance/](./performance/)** - Performance benchmarking and optimization guides

### 🎨 User Interface

- **[ui/](./ui/)** - UI component guidelines, design patterns, and visual guides
  - Multi-group editor layouts and interactions
  - Query logs improvements and features
  - CSS fixes and responsive design notes

### 🚀 Features

Detailed documentation for specific features:

#### Advanced Blocking

- **[features/advanced-blocking/](./features/advanced-blocking/)** - Advanced Blocking app integration
  - Settings synchronization
  - Domain list management

#### Clustering

- **[features/clustering/](./features/clustering/)** - Technitium DNS v14+ clustering support
  - Primary/Secondary role detection
  - Write restriction enforcement

#### Query Logs

- **[features/query-logs/](./features/query-logs/)** - Query log features
  - Server-side filtering
  - Combined log viewing

#### Other Features

- **[features/SESSION_AUTH_AND_TOKEN_MIGRATION.md](./features/SESSION_AUTH_AND_TOKEN_MIGRATION.md)** - Session auth (v1.2+) overview and cluster-token → background-token migration
- **[features/AUTHENTICATION_DECISION.md](./features/AUTHENTICATION_DECISION.md)** - Authentication approach and token strategy rationale
- **[features/CONFIG_CHANGE_DETECTION.md](./features/CONFIG_CHANGE_DETECTION.md)** - Unsaved changes detection
- **[features/DHCP_AGGREGATION.md](./features/DHCP_AGGREGATION.md)** - DHCP scope aggregation
- **[features/DHCP_BULK_SYNC.md](./features/DHCP_BULK_SYNC.md)** - Bulk DHCP scope operations
- **[features/DHCP_HOSTNAME_RESOLUTION.md](./features/DHCP_HOSTNAME_RESOLUTION.md)** - Hostname resolution
- **[features/DOMAIN_LIST_PERSISTENCE.md](./features/DOMAIN_LIST_PERSISTENCE.md)** - Domain list caching
- **[features/DOMAIN_LISTS_ENHANCEMENTS.md](./features/DOMAIN_LISTS_ENHANCEMENTS.md)** - Domain list improvements
- **[features/PAGINATION_IMPLEMENTATION.md](./features/PAGINATION_IMPLEMENTATION.md)** - Pagination patterns
- **[features/UNIFIED_SEARCH_UI.md](./features/UNIFIED_SEARCH_UI.md)** - Global search interface

### 🔍 Zone Comparison

- **[zone-comparison/](./zone-comparison/)** - DNS zone comparison logic and algorithms
  - Zone type matching rules
  - Primary/Secondary relationship validation
  - Configuration comparison strategies

### 📖 Implementation Details

- **[implementation/](./implementation/)** - Technical implementation documentation
  - Query log deduplication and filtering

## 🤝 Contributing

To contribute to this project:

1. Read [../DEVELOPMENT.md](../DEVELOPMENT.md) for development setup
2. Check [architecture.md](./architecture.md) to understand the system design
3. Review relevant feature documentation before making changes
4. Add tests for new features (see [TESTING.md](./TESTING.md))
5. Update documentation when adding features

## 📝 Documentation Guidelines

When adding or updating documentation:

- Keep examples generic (use `node1`, `node2`, `example.com` instead of specific hostnames)
- Include code examples where helpful
- Update this README if you add new documentation sections
- Use clear section headers and consistent formatting
- Link between related documents

## 🔗 External Resources

- **[Technitium DNS Server](https://github.com/TechnitiumSoftware/DnsServer)** - Official Technitium DNS repository
- **[Technitium API Documentation](https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md)** - Technitium DNS HTTP API reference
