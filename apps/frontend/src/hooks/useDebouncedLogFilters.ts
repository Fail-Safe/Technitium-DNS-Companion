import { useCallback, useEffect, useMemo, useState } from "react";

export const LOG_FILTER_DEBOUNCE_MS = 400;

interface DebouncedLogFilters {
  queryDomainFilter: string;
  queryClientFilter: string;
  clientFilterPending: boolean;
  commitDomainFilter: (value?: string) => void;
  commitClientFilter: (value?: string) => void;
}

export function useDebouncedLogFilters(
  domainFilter: string,
  clientFilter: string,
  delayMs = LOG_FILTER_DEBOUNCE_MS,
): DebouncedLogFilters {
  const [queryDomainFilter, setQueryDomainFilter] = useState(
    domainFilter.trim(),
  );
  const [queryClientFilter, setQueryClientFilter] = useState(
    clientFilter.trim(),
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setQueryDomainFilter(domainFilter.trim());
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [delayMs, domainFilter]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const normalized = clientFilter.trim();
      if (normalized.length !== 1) {
        setQueryClientFilter(normalized);
      }
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [clientFilter, delayMs]);

  const commitDomainFilter = useCallback(
    (value = domainFilter) => setQueryDomainFilter(value.trim()),
    [domainFilter],
  );
  const commitClientFilter = useCallback(
    (value = clientFilter) => setQueryClientFilter(value.trim()),
    [clientFilter],
  );

  const clientFilterPending = useMemo(
    () => clientFilter.trim() !== queryClientFilter,
    [clientFilter, queryClientFilter],
  );

  return {
    queryDomainFilter,
    queryClientFilter,
    clientFilterPending,
    commitDomainFilter,
    commitClientFilter,
  };
}
