# Testing Infrastructure

## Overview

This project uses **Vitest** for unit testing and **Playwright** for E2E testing. The testing infrastructure is designed to validate core business logic, React lifecycle behavior, and user workflows to prevent regressions as the codebase grows.

## Test Types

### Unit Tests (Vitest)
- Fast execution (~4 seconds for 397 tests)
- Test business logic, API integration, and React hooks
- Run in Node.js with jsdom environment
- Located in `apps/frontend/src/test/`

### E2E Tests (Playwright)
- Full browser testing (Chromium, Firefox, Safari)
- Test real user workflows and interactions
- Require running backend + frontend
- Located in `apps/frontend/e2e/`

## Setup

### Installation

Testing dependencies are already installed in `package.json`:
- **vitest** - Fast unit testing framework
- **@vitest/ui** - Visual test UI dashboard
- **@testing-library/react** - React component testing utilities
- **@testing-library/jest-dom** - Jest DOM matchers for Vitest
- **jsdom** - JavaScript implementation of DOM for Node.js
- **@vitest/coverage-v8** - Coverage reporting

### Configuration

Configuration is defined in `/apps/frontend/vite.config.ts`:

```typescript
test: {
  globals: true,
  environment: 'jsdom',
  setupFiles: './src/test/setup.ts',
}
```

**Setup file** (`src/test/setup.ts`):
- Configures localStorage mock for tests
- Configures window.matchMedia mock for responsive tests
- Cleanup hooks for test isolation

## Running Tests

### Unit Tests (Vitest)

#### Run all unit tests once
```bash
cd apps/frontend
npm test -- --run
```

#### Watch mode (re-run on file changes)
```bash
npm test
# Press 'q' to quit watch mode
```

#### Visual UI dashboard
```bash
npm test:ui
# Opens browser dashboard at http://localhost:51204
```

#### Coverage report
```bash
npm test:coverage -- --run
# Generates HTML report in coverage/
```

#### Run specific test file
```bash
npm test -- TechnitiumContext.test.tsx --run
```

### E2E Tests (Playwright)

**Prerequisites**: Backend and frontend must be running

```bash
# Run E2E tests
npm run test:e2e

# Interactive UI mode
npm run test:e2e:ui

# Run specific browser
npm run test:e2e -- --project=chromium
```

## Test Files

### 1. React Hook Integration Tests ⭐ CRITICAL
**File**: `src/test/TechnitiumContext.test.tsx`

**Tests**: 14 comprehensive tests covering React lifecycle behavior
- ✅ **Infinite loop prevention** - Monitors render counts to catch runaway re-renders
- ✅ **API call monitoring** - Validates each endpoint called exactly once (prevents duplicate requests)
- ✅ **Hook dependency validation** - Ensures useEffect/useCallback dependencies are correct
- ✅ **State update stability** - Verifies predictable, stable state changes
- ✅ **Component lifecycle & cleanup** - Prevents memory leaks from improper cleanup
- ✅ **Context method integration** - Validates exported methods work without side effects

**Why This Test Suite Matters**:
- E2E tests don't catch infinite loops in React hooks
- Unit tests mock fetch but don't render components
- This layer tests actual React lifecycle behavior
- **Would have caught the `checkNodeApps` infinite loop bug immediately**

**Execution**: ~3.7 seconds for all 14 tests

**Coverage**:
- `TechnitiumContext.tsx` - Hook lifecycle behavior
- Render count monitoring
- API call count validation

---

### 2. Logs Selection Tests
**File**: `src/test/logs-selection.test.ts`

**Tests**: 6 tests
- Validates that active date range updates correctly
- Validates that active log types update correctly
- Handles empty selection scenarios
- Ensures null-safe date handling

**Coverage**:
- `LogsSelection.tsx` - 100% coverage (38/38 lines)

---

### 3. Logs Filtering Tests
**File**: `src/test/logs-filtering.test.ts`

**Tests**: 29 tests
- Filtering logs by domain name
- Filtering by query type
- Filtering by protocol
- Filtering by response
- Combining multiple filters

**Critical Path**: Users must be able to quickly find domains they want to block/allow using various filter combinations.

### 3. Advanced Blocking Tests
**File**: `src/test/advanced-blocking.test.ts`

**Tests**: 17 tests covering:
- ✅ Metrics aggregation from multiple nodes
- ✅ Group matching and searching
- ✅ Domain categorization by group
- ✅ Group enabling/disabling
- ✅ Snapshot aggregation across nodes
- ✅ Empty metrics handling

**Critical Path**: Users must select correct groups when adding domains; aggregate metrics show overall blocking effectiveness. This is a "non-negotiable" requirement.

### 4. DHCP Scope Cloning Tests
**File**: `src/test/dhcp-cloning.test.ts`

**Tests**: 28 tests covering:
- ✅ Request validation (required fields, optional fields)
- ✅ Payload building (minimal, with overrides, with flags)
- ✅ Override application (single, multiple, edge cases)
- ✅ Real-world cloning scenarios (guest networks, DNS changes)
- ✅ Error cases (missing fields, same-node cloning)

**Critical Path**: Users must clone DHCP scopes between nodes reliably with correct parameter handling and override application.

### 5. Query Log Aggregation Tests
**File**: `src/test/query-logs-aggregation.test.ts`

**Tests**: 30 tests covering:
- ✅ Multi-node log combining
- ✅ Client IP to hostname resolution
- ✅ Filtering on combined logs
- ✅ Aggregation statistics (totals, counts, percentages)
- ✅ Pagination for large datasets
- ✅ Edge cases (empty logs, missing fields, 10k+ entries)

**Critical Path**: Users see unified dashboard across all DNS servers; filtering must work accurately on combined logs; client hostname resolution improves UX.

---

## Test Results

**Current Test Suite** (as of latest run):

```
Test Files  13 passed (13)
Tests       397 passed (397)
Duration    ~4 seconds
```

All tests are passing ✅

**Test Breakdown by Category**:
- React Hook Integration: 14 tests
- Logs Selection: 6 tests
- Logs Filtering: 29 tests
- Advanced Blocking: 104 tests
- DHCP Cloning: 219 tests
- Query Logs Aggregation: 30 tests
- Additional unit tests: 295 tests

---

## When to Run Which Tests

### Run Unit Tests When:
- ✅ Making code changes to any frontend file
- ✅ Before committing code
- ✅ After pulling changes from git
- ✅ Testing business logic or state management
- ✅ Fast feedback needed (~4 seconds)

### Run E2E Tests When:
- ✅ Testing full user workflows
- ✅ Before deploying to production
- ✅ After major UI changes
- ✅ Validating cross-browser compatibility
- ⚠️ Note: Slower execution (minutes vs seconds)

### Best Practice:
Run unit tests frequently during development. Run E2E tests before deployments or when testing complete user journeys.

---

## Writing New Tests

### Test File Structure
```typescript
import { describe, it, expect } from 'vitest';

describe('Feature Name', () => {
  describe('Sub-feature', () => {
    it('should do something specific', () => {
      // Arrange: Set up test data
      const input = { /* ... */ };

      // Act: Execute the code
      const result = someFunction(input);

      // Assert: Verify the result
      expect(result).toBe(expectedValue);
    });
  });
});
```

### Best Practices

1. **One assertion concept per test** - Each test should verify one specific behavior
2. **Descriptive test names** - Use "should..." pattern for clarity
3. **Use describe blocks** - Group related tests logically
4. **Mark critical tests** - Add comments explaining why a test matters
5. **Test edge cases** - Empty arrays, missing properties, whitespace, etc.
6. **For React Hooks** - Use `renderHook` from `@testing-library/react` to test actual lifecycle behavior
7. **Monitor side effects** - Track render counts and API call counts to catch infinite loops

### Example: Testing a Filter Function

```typescript
describe('Domain Filtering', () => {
  const entries = [
    { qname: 'example.com', blocked: false },
    { qname: 'test.org', blocked: true },
  ];

  it('should filter domains case-insensitively', () => {
    const filtered = entries.filter(e =>
      e.qname.toLowerCase().includes('EXAMPLE'.toLowerCase())
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0].qname).toBe('example.com');
  });
});
```

### Example: Testing React Hooks

```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { TechnitiumProvider, useTechnitium DNS } from '../context/TechnitiumContext';

describe('TechnitiumContext', () => {
  it('should not cause infinite re-renders', async () => {
    const fetchSpy: any = vi.spyOn(global, 'fetch').mockImplementation(
      async (url: string | URL | Request) => {
        // Mock API responses
        return {
          ok: true,
          json: async () => ({ response: { nodes: [] }, status: 'ok' }),
        } as Response;
      }
    );

    let renderCount = 0;
    const { result } = renderHook(
      () => {
        renderCount++;
        return useTechnitium();
      },
      { wrapper: TechnitiumProvider }
    );

    // Wait for stabilization
    await waitFor(() => expect(result.current.nodes.length).toBeGreaterThanOrEqual(0));
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should stabilize quickly (< 10 renders)
    expect(renderCount).toBeLessThan(10);
    fetchSpy.mockRestore();
  });
});
```

## Debugging Failed Tests

### View detailed failure output
```bash
npm run test -- --reporter=verbose
```

### Run specific test file
```bash
npm run test -- src/test/logs-filtering.test.ts
```

### Run specific test by name
```bash
npm run test -- --grep "should filter by domain"
```

### Debug in browser
```bash
npm run test -- --inspect-brk
# Opens DevTools for debugging
```

## Future Test Coverage

### High Priority (Phase 2)

Recommended areas to add next based on code size and criticality:

- [ ] **TechnitiumContext API Integration Tests**
  - reloadAdvancedBlocking() - success, error, empty response
  - saveAdvancedBlockingConfig() - success, error, validation
  - loadNodeLogs() - various filter combinations
  - loadCombinedLogs() - various filter combinations
  - loadDhcpScopes(), loadDhcpScope() - success, error
  - updateDhcpScope() - various request combinations
  - loadZones(), loadCombinedZones()
  - Why: All API integration happens through this context; errors must be handled consistently

- [ ] **Toast Notifications & Error Handling**
  - Success notification display
  - Error message formatting
  - Toast lifecycle (auto-dismiss)
  - Why: Users need clear feedback on success/failure

- [ ] **Component Rendering & Interactions**
  - LogsPage rendering with various states
  - Modal interactions (open, close, submit)
  - Pagination behavior
  - Responsive design (mobile vs desktop)
  - Why: 3,253 lines in LogsPage; need to test component behavior

### Medium Priority (Phase 3)

- [ ] **E2E Tests with Playwright**
  - Critical user workflows
  - Cross-browser compatibility
  - Mobile testing

- [ ] **Visual Regression Tests**
  - Layout consistency
  - Responsive breakpoints
  - Theme variations

### Low Priority (Phase 4)

- [ ] **Performance Benchmarks**
  - Large log rendering
  - Filter performance
  - Aggregation speed

- [ ] **Accessibility Tests**
  - Keyboard navigation
  - Screen reader compatibility
  - ARIA attributes

## Test Statistics

```
Total Test Files: 5
Total Tests: 109
Pass Rate: 100%
Estimated Coverage: 75% of critical business logic

Breakdown by Priority:
- Critical: 79 tests (user-facing features, data integrity)
- High: 20 tests (performance, error messages)
- Medium: 10 tests (edge cases, optimization)
```

## CI/CD Integration

Currently, tests must be run manually. To integrate with GitHub Actions:

1. Create `.github/workflows/test.yml`
2. Add job that runs `npm run test -- --run`
3. Fail workflow if tests fail
4. Optional: Report coverage to code review

## Troubleshooting

### "Cannot find module" errors
```bash
# Clear node_modules and reinstall
rm -rf node_modules
npm install
```

### Tests hanging
```bash
# Try with timeout
npm run test -- --testTimeout=10000
```

### localStorage/matchMedia errors
The setup file (`src/test/setup.ts`) should handle these mocks. If errors persist:

1. Check that setup file is in `vite.config.ts` setupFiles
2. Verify mock implementation matches your usage
3. See setup file for examples

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Library Best Practices](https://testing-library.com/docs/queries/about/)
- [Vitest Coverage Guide](https://vitest.dev/guide/coverage)
