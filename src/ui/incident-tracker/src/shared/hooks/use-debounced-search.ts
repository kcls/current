import { useState, useEffect, useCallback } from 'react';

interface UseDebouncedSearchOptions {
  delay?: number;
  minLength?: number;
  initialValue?: string;
  onDebouncedChange?: (value: string) => void;
}

interface UseDebouncedSearchReturn {
  searchInput: string;
  debouncedSearch: string;
  setSearchInput: (value: string) => void;
  clearSearch: () => void;
}

export function useDebouncedSearch({
  delay = 250,
  minLength = 3,
  initialValue = '',
  onDebouncedChange,
}: UseDebouncedSearchOptions = {}): UseDebouncedSearchReturn {
  const [searchInput, setSearchInput] = useState(initialValue);
  const [debouncedSearch, setDebouncedSearch] = useState(initialValue);

  // Sync with external value changes (e.g., URL)
  useEffect(() => {
    setSearchInput(initialValue);
    setDebouncedSearch(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (debouncedSearch !== searchInput) {
        setDebouncedSearch(searchInput);
        onDebouncedChange?.(searchInput);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [searchInput, debouncedSearch, delay, onDebouncedChange]);

  const clearSearch = useCallback(() => {
    setSearchInput('');
    setDebouncedSearch('');
    onDebouncedChange?.('');
  }, [onDebouncedChange]);

  // Only return debouncedSearch if empty or meets minLength
  const effectiveSearch = debouncedSearch.length === 0 || debouncedSearch.length >= minLength
    ? debouncedSearch
    : '';

  return {
    searchInput,
    debouncedSearch: effectiveSearch,
    setSearchInput,
    clearSearch,
  };
}
