import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDebouncedSearch } from '../use-debounced-search';

describe('useDebouncedSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('should initialize with empty strings by default', () => {
      const { result } = renderHook(() => useDebouncedSearch());
      expect(result.current.searchInput).toBe('');
      expect(result.current.debouncedSearch).toBe('');
    });

    it('should initialize with provided initialValue', () => {
      const { result } = renderHook(() =>
        useDebouncedSearch({ initialValue: 'test' })
      );
      expect(result.current.searchInput).toBe('test');
      expect(result.current.debouncedSearch).toBe('test');
    });
  });

  describe('setSearchInput', () => {
    it('should update searchInput immediately', () => {
      const { result } = renderHook(() => useDebouncedSearch());

      act(() => {
        result.current.setSearchInput('hello');
      });

      expect(result.current.searchInput).toBe('hello');
    });

    it('should debounce debouncedSearch update', async () => {
      const { result } = renderHook(() =>
        useDebouncedSearch({ delay: 300 })
      );

      act(() => {
        result.current.setSearchInput('hello');
      });

      // Immediately after, debouncedSearch should still be empty
      expect(result.current.debouncedSearch).toBe('');

      // Advance time by debounce delay
      act(() => {
        vi.advanceTimersByTime(300);
      });

      // Now debouncedSearch should be updated
      expect(result.current.debouncedSearch).toBe('hello');
    });

    it('should use default delay of 250ms', async () => {
      const { result } = renderHook(() => useDebouncedSearch());

      act(() => {
        result.current.setSearchInput('test');
      });

      // Before 250ms
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(result.current.debouncedSearch).toBe('');

      // After 250ms
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(result.current.debouncedSearch).toBe('test');
    });
  });

  describe('minLength', () => {
    it('should return empty string when input is shorter than minLength', async () => {
      const { result } = renderHook(() =>
        useDebouncedSearch({ minLength: 3, delay: 100 })
      );

      act(() => {
        result.current.setSearchInput('ab');
      });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      // Input is 'ab' (2 chars), less than minLength (3)
      expect(result.current.debouncedSearch).toBe('');
    });

    it('should return the value when input meets minLength', async () => {
      const { result } = renderHook(() =>
        useDebouncedSearch({ minLength: 3, delay: 100 })
      );

      act(() => {
        result.current.setSearchInput('abc');
      });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(result.current.debouncedSearch).toBe('abc');
    });

    it('should return empty string when cleared (empty is allowed)', async () => {
      const { result } = renderHook(() =>
        useDebouncedSearch({ minLength: 3, delay: 100, initialValue: 'test' })
      );

      act(() => {
        result.current.clearSearch();
      });

      // Empty string is always allowed
      expect(result.current.debouncedSearch).toBe('');
    });
  });

  describe('clearSearch', () => {
    it('should clear both searchInput and debouncedSearch immediately', () => {
      const { result } = renderHook(() =>
        useDebouncedSearch({ initialValue: 'hello' })
      );

      act(() => {
        result.current.clearSearch();
      });

      expect(result.current.searchInput).toBe('');
      expect(result.current.debouncedSearch).toBe('');
    });

    it('should call onDebouncedChange with empty string', () => {
      const onDebouncedChange = vi.fn();
      const { result } = renderHook(() =>
        useDebouncedSearch({
          initialValue: 'hello',
          onDebouncedChange,
        })
      );

      act(() => {
        result.current.clearSearch();
      });

      expect(onDebouncedChange).toHaveBeenCalledWith('');
    });
  });

  describe('onDebouncedChange callback', () => {
    it('should call onDebouncedChange when debouncedSearch updates', async () => {
      const onDebouncedChange = vi.fn();
      const { result } = renderHook(() =>
        useDebouncedSearch({
          delay: 100,
          onDebouncedChange,
        })
      );

      act(() => {
        result.current.setSearchInput('hello');
      });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(onDebouncedChange).toHaveBeenCalledWith('hello');
    });

    it('should not call onDebouncedChange if value has not changed', async () => {
      const onDebouncedChange = vi.fn();
      const { result } = renderHook(() =>
        useDebouncedSearch({
          delay: 100,
          initialValue: 'same',
          onDebouncedChange,
        })
      );

      act(() => {
        result.current.setSearchInput('same');
      });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      // Should not call because value is the same as initial
      expect(onDebouncedChange).not.toHaveBeenCalled();
    });
  });

  describe('external initialValue changes', () => {
    it('should sync with external initialValue changes', () => {
      const { result, rerender } = renderHook(
        ({ initialValue }) => useDebouncedSearch({ initialValue }),
        { initialProps: { initialValue: 'first' } }
      );

      expect(result.current.searchInput).toBe('first');

      rerender({ initialValue: 'second' });

      expect(result.current.searchInput).toBe('second');
      expect(result.current.debouncedSearch).toBe('second');
    });
  });

  describe('debounce cancellation', () => {
    it('should cancel previous debounce when new input is set', async () => {
      const { result } = renderHook(() =>
        useDebouncedSearch({ delay: 300 })
      );

      act(() => {
        result.current.setSearchInput('first');
      });

      // Advance partially
      act(() => {
        vi.advanceTimersByTime(200);
      });

      // Set new input before debounce completes
      act(() => {
        result.current.setSearchInput('second');
      });

      // Advance past original debounce time
      act(() => {
        vi.advanceTimersByTime(200);
      });

      // Should still be empty because we reset the timer
      expect(result.current.debouncedSearch).toBe('');

      // Complete the new debounce
      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(result.current.debouncedSearch).toBe('second');
    });
  });
});
