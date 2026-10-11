// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePaged } from '@/components/hooks';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const item = (n: number) => ({ id: `i${n}` });
const page = (items: { id: string }[], total: number, offset: number) =>
  new Response(JSON.stringify({ items, total, limit: 50, offset }), { status: 200, headers: { 'content-type': 'application/json' } });

describe('usePaged (SYNTHETIC data)', () => {
  it('ignores loadMore while a canonical first-page refresh is held, then ends with canonical items and no stuck loading', async () => {
    const all = Array.from({ length: 60 }, (_, n) => item(n));
    let hold: Promise<void> | null = null;
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const offset = Number(new URL(url, 'http://x.invalid').searchParams.get('offset'));
      if (offset === 0 && hold) await hold;
      return page(all.slice(offset, offset + 50), all.length, offset);
    });
    const { result, rerender } = renderHook(({ refresh }) => usePaged<{ id: string }>('/p', refresh), { initialProps: { refresh: 0 } });
    await waitFor(() => expect(result.current.items).toHaveLength(50));

    let release!: () => void;
    hold = new Promise<void>((r) => (release = r));
    all.push(item(60)); // canonical data changed (an entry was added)
    rerender({ refresh: 1 });
    await waitFor(() => expect(result.current.refreshing).toBe(true));
    const before = calls.length;
    act(() => result.current.loadMore());
    expect(calls.length).toBe(before + 0); // append was refused; only the held first-page GET is outstanding
    hold = null;
    release();
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.items).toHaveLength(50);
    expect(result.current.total).toBe(61);
    expect(result.current.loadingMore).toBe(false);
    expect(calls.filter((c) => c.includes('offset=50'))).toHaveLength(0);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(61));
    expect(result.current.loadingMore).toBe(false);
  });

  it('a refresh that starts during an in-flight loadMore does not leave loadingMore stuck or append stale data', async () => {
    let all = Array.from({ length: 60 }, (_, n) => item(n));
    let holdMore: Promise<void> | null = null;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const offset = Number(new URL(String(input), 'http://x.invalid').searchParams.get('offset'));
      const snapshot = all;
      if (offset === 50 && holdMore) await holdMore;
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return page(snapshot.slice(offset, offset + 50), snapshot.length, offset);
    });
    const { result, rerender } = renderHook(({ refresh }) => usePaged<{ id: string }>('/p', refresh), { initialProps: { refresh: 0 } });
    await waitFor(() => expect(result.current.items).toHaveLength(50));
    let release!: () => void;
    holdMore = new Promise<void>((r) => (release = r));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadingMore).toBe(true));
    all = all.slice(0, 55); // canonical change
    rerender({ refresh: 1 });
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    release();
    expect(result.current.loadingMore).toBe(false);
    expect(result.current.items).toHaveLength(50);
    expect(result.current.total).toBe(55);
  });

  it('reload repeats only the first-page GET and clears a first-page error', async () => {
    let fail = true;
    const calls: { url: string; method?: string }[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method });
      if (fail) return new Response(JSON.stringify({ error: { code: 'service_unavailable', message: 'x', request_id: null } }), { status: 503, headers: { 'content-type': 'application/json' } });
      return page([item(1)], 1, 0);
    });
    const { result } = renderHook(() => usePaged<{ id: string }>('/p', 0));
    await waitFor(() => expect(result.current.error?.code).toBe('service_unavailable'));
    fail = false;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.error).toBeUndefined();
    expect(calls.every((c) => (c.method ?? 'GET') === 'GET')).toBe(true);
  });
});
