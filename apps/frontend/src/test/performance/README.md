# Performance Testing Framework

This directory contains performance benchmarks to validate that refactorings improve (or at least don't degrade) performance.

## Overview

Performance tests measure execution time and operations per second for critical functions before and after refactoring. This ensures our code optimizations actually work.

## Running Benchmarks

```bash
# Run all performance benchmarks
npm run test:bench

# Run specific benchmark file
npm run test:bench array-comparison.bench.ts

# Run with verbose output
npm run test:bench -- --reporter=verbose
```

## Benchmark Files

### `array-comparison.bench.ts`
Tests performance of `compareStringArrays()` and `compareUrlArrays()` functions.

**Test Scenarios:**
- Identical arrays (10, 100, 1K, 10K items)
- Different order (reversed arrays)
- Different content (early vs late differences)
- Real-world sync checks (50 groups × 20 domains)
- Badge calculation simulation

**Key Metrics:**
- Operations per second
- Average execution time
- Performance with varying array sizes

### `levenshtein.bench.ts`
Tests performance of Levenshtein distance algorithm and `areSimilar()` function.

**Test Scenarios:**
- Identical strings (10, 50, 100, 200 chars)
- Small differences (1 char, typos)
- Large differences (completely different)
- Domain name modifications (CDN numbers, regex changes)
- Real-world sync scenarios (100 domains)

**Key Metrics:**
- Operations per second
- Average execution time
- Performance with varying string lengths

### `sync-calculation.bench.ts`
Tests performance of sync badge calculation logic.

**Test Scenarios:**
- Identical configurations (5, 25, 50, 100 groups)
- Configurations with differences (partial, all different)
- Real-world production scenarios
- Heavy usage (50 groups × 1000 domains)
- Edge cases (empty configs)

**Key Metrics:**
- Total calculation time
- Performance with varying group counts
- Real production workload simulation

## Interpreting Results

### Good Performance
```
✓ array-comparison.bench.ts (3) 1234ms
  ✓ Array Comparison Performance (3) 1234ms
    ✓ compareStringArrays - Identical Arrays (4) 234ms
      name                 hz     min     max    mean     p75     p99    p995    p999
    · 10 items        245,678  0.0032  0.0156  0.0041  0.0042  0.0089  0.0123  0.0145
    · 100 items        24,567  0.0321  0.0876  0.0407  0.0421  0.0678  0.0789  0.0856
```

**What to look for:**
- `hz` (operations/second): Higher is better
- `mean` (average time): Lower is better
- Consistent performance across runs (low variance between min/max)

### Performance Regression
```
⚠️  Performance degradation detected:
    Before: 24,567 ops/sec (0.041ms avg)
    After:  12,345 ops/sec (0.081ms avg)
    Change: -49.7% slower ❌
```

If you see significant slowdowns (>10%), investigate the cause before proceeding.

## Creating Baseline

Before refactoring, capture baseline performance:

```bash
# Run benchmarks and save results
npm run test:bench > performance-baseline.txt

# Or use JSON output for programmatic comparison
npm run test:bench -- --reporter=json > performance-baseline.json
```

## After Refactoring

Compare new results with baseline:

```bash
# Run benchmarks again
npm run test:bench > performance-after.txt

# Compare visually
diff performance-baseline.txt performance-after.txt
```

## Performance Thresholds

**Acceptable Changes:**
- ±5%: Normal variance, no concern
- +5% to +20%: Improvement! 🎉
- -5% to -10%: Minor regression, acceptable if code quality improved significantly
- <-10%: Significant regression, needs investigation ⚠️

## Best Practices

1. **Run Multiple Times**: Performance can vary, run benchmarks 3-5 times and average
2. **Close Other Apps**: Reduce system noise during benchmarking
3. **Use Same Hardware**: Compare on same machine for consistent results
4. **Warm Up**: First run may be slower, results stabilize after a few iterations
5. **Test Real Scenarios**: Include production-like data sizes (30 groups, 75 domains each)

## Common Optimizations

If benchmarks show performance issues:

1. **Reduce Array Copies**: Use references where possible
2. **Memoize Results**: Cache expensive calculations
3. **Early Returns**: Exit comparison loops as soon as difference found
4. **Batch Operations**: Process multiple items together
5. **Optimize Sorting**: Consider if sorting is always necessary

## Integration with CI/CD

You can add performance tests to your CI pipeline:

```yaml
# .github/workflows/performance.yml
- name: Run Performance Benchmarks
  run: npm run test:bench -- --reporter=json > bench-results.json

- name: Compare with Baseline
  run: node scripts/compare-performance.js bench-results.json baseline.json
```

## Troubleshooting

**Benchmarks taking too long:**
- Reduce iteration counts in bench() calls
- Focus on specific test cases
- Use `bench.skip()` to skip slow tests temporarily

**Inconsistent results:**
- Close unnecessary applications
- Run benchmarks multiple times
- Check for background processes (backups, indexing)
- Ensure battery is charging (laptops throttle on battery)

**Memory issues:**
- Reduce test data sizes
- Use garbage collection hints
- Monitor memory usage with Node.js profiler

## Resources

- [Vitest Benchmarking Guide](https://vitest.dev/guide/features.html#benchmarking)
- [JavaScript Performance Best Practices](https://developer.mozilla.org/en-US/docs/Web/Performance)
- [V8 Optimization Tips](https://v8.dev/docs/turbofan)
