'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest, isAbort } from '@/lib/api-client';
import type { Page } from '@/lib/api-types';

export function toApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError(0, 'network', null);
}

interface LoadState<T> {
  key: string;
  data?: T;
  error?: ApiError;
  loading: boolean;
  /** Number of completed (success or failure, never aborted) loads for this key. */
  settled: number;
}

/**
 * Loads data for `key`. A new key aborts the previous request and discards its
 * data, so a response for a previous selection can never be shown.
 * `reload` refetches the same key and keeps the current data visible.
 */
export function useLoad<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<LoadState<T>>({ key: key ?? '', loading: key !== null, settled: 0 });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const onError = useRef<(e: ApiError) => void>(() => {});

  useEffect(() => {
    if (key === null) {
      setState({ key: '', loading: false, settled: 0 });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ key, loading: true, settled: s.key === key ? s.settled : 0, data: s.key === key ? s.data : undefined }));
    loadRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState((s) => ({ key, data, loading: false, settled: s.key === key ? s.settled + 1 : 1 }));
      },
      (error) => {
        if (controller.signal.aborted || isAbort(error)) return;
        const apiError = toApiError(error);
        setState((s) => ({
          key,
          loading: false,
          error: apiError,
          data: s.key === key ? s.data : undefined,
          settled: s.key === key ? s.settled + 1 : 1,
        }));
        onError.current(apiError);
      },
    );
    return () => controller.abort();
  }, [key, tick]);

  const current = key !== null && state.key === key ? state : null;
  return {
    data: current?.data,
    error: current?.error,
    settled: current?.settled ?? 0,
    loading: key !== null && (current === null || current.loading),
    reload: useCallback(() => setTick((t) => t + 1), []),
    onError,
  };
}

interface PagedState<T> {
  key: string;
  items: T[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error?: ApiError;
  moreError?: ApiError;
}

export const PAGE_SIZE = 50;

/** Offset pagination that never pretends a partial list is complete. */
export function usePaged<T extends { id: string }>(path: string | null, refresh: number) {
  const [state, setState] = useState<PagedState<T>>({ key: '', items: [], total: 0, loading: path !== null, loadingMore: false });
  const controller = useRef<AbortController | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    if (path === null) {
      setState({ key: '', items: [], total: 0, loading: false, loadingMore: false });
      return;
    }
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setState((s) => (s.key === path ? { ...s, loading: true, error: undefined } : { key: path, items: [], total: 0, loading: true, loadingMore: false }));
    apiRequest<Page<T>>(`${path}?limit=${PAGE_SIZE}&offset=0`, { signal: c.signal }).then(
      (page) => {
        if (!c.signal.aborted) setState({ key: path, items: page.items, total: page.total, loading: false, loadingMore: false });
      },
      (error) => {
        if (c.signal.aborted || isAbort(error)) return;
        setState((s) => ({ ...s, key: path, loading: false, error: toApiError(error) }));
      },
    );
    return () => c.abort();
  }, [path, refresh]);

  const countRef = useRef(0);
  const loadMore = useCallback(() => {
    const p = pathRef.current;
    if (p === null) return;
    const c = new AbortController();
    controller.current?.abort();
    controller.current = c;
    setState((s) => (s.key === p ? { ...s, loadingMore: true, moreError: undefined } : s));
    apiRequest<Page<T>>(`${p}?limit=${PAGE_SIZE}&offset=${countRef.current}`, { signal: c.signal }).then(
      (page) => {
        if (c.signal.aborted) return;
        setState((cur) => {
          if (cur.key !== p) return cur;
          const seen = new Set(cur.items.map((i) => i.id));
          return { ...cur, items: [...cur.items, ...page.items.filter((i) => !seen.has(i.id))], total: page.total, loadingMore: false };
        });
      },
      (error) => {
        if (c.signal.aborted || isAbort(error)) return;
        setState((cur) => (cur.key === p ? { ...cur, loadingMore: false, moreError: toApiError(error) } : cur));
      },
    );
  }, []);

  const current = path !== null && state.key === path ? state : null;
  countRef.current = current?.items.length ?? 0;
  return {
    items: current?.items ?? [],
    total: current?.total ?? 0,
    loading: path !== null && (current === null || current.loading) && (current?.items.length ?? 0) === 0,
    refreshing: current?.loading ?? false,
    loadingMore: current?.loadingMore ?? false,
    error: current?.error,
    moreError: current?.moreError,
    loadMore,
  };
}
