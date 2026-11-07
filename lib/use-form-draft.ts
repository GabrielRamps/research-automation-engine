'use client';

import { useEffect, useRef, useState } from 'react';

const LOCAL_KEY = 'rae:research-form-draft';
const DEBOUNCE_MS = 1500;

interface UseFormDraftOptions<T> {
  /** Current form state; the hook persists this whenever it changes. */
  state: T;
  /** Setter to hydrate the form when a draft loads. */
  setState: (next: T) => void;
  /** Set true once the form is ready to be hydrated (e.g., after auth check). */
  ready: boolean;
}

interface UseFormDraftResult {
  /** True until the initial draft load (local + server) settles. */
  hydrating: boolean;
  /** Whether a draft was found and applied on mount. */
  hadDraft: boolean;
  /** Wipe both localStorage and the server-side draft. Call after submit. */
  clear: () => Promise<void>;
}

/**
 * Persists a form's state to localStorage immediately and to the server
 * (debounced 1.5s). On mount, hydrates from localStorage first (instant),
 * then upgrades from server if newer.
 *
 * Why both: localStorage = instant continuity if the user gets a "provider down"
 * block screen and refreshes. Server = continuity across devices and after
 * clearing browser data.
 */
export function useFormDraft<T extends object>({
  state,
  setState,
  ready,
}: UseFormDraftOptions<T>): UseFormDraftResult {
  const [hydrating, setHydrating] = useState(true);
  const [hadDraft, setHadDraft] = useState(false);
  const lastSavedJson = useRef<string>('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Hydrate on mount ----
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    (async () => {
      // 1) localStorage first (instant)
      let local: T | null = null;
      try {
        const raw = localStorage.getItem(LOCAL_KEY);
        if (raw) local = JSON.parse(raw) as T;
      } catch {
        /* ignore parse errors */
      }
      if (local && !cancelled) {
        setState(local);
        setHadDraft(true);
        lastSavedJson.current = JSON.stringify(local);
      }

      // 2) Server (may overwrite local if it has a newer draft)
      try {
        const res = await fetch('/api/drafts');
        if (!res.ok) return;
        const data = (await res.json()) as { ok?: boolean; draft?: T | null };
        if (!cancelled && data.ok && data.draft) {
          setState(data.draft);
          setHadDraft(true);
          lastSavedJson.current = JSON.stringify(data.draft);
          try {
            localStorage.setItem(LOCAL_KEY, lastSavedJson.current);
          } catch {
            /* localStorage may be unavailable (Safari private) */
          }
        }
      } catch {
        /* server unreachable; localStorage hydration is enough */
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // ---- Persist on every change ----
  useEffect(() => {
    if (hydrating || !ready) return;

    const json = JSON.stringify(state);
    if (json === lastSavedJson.current) return;

    // localStorage immediately
    try {
      localStorage.setItem(LOCAL_KEY, json);
    } catch {
      /* ignore */
    }

    // Server debounced
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      lastSavedJson.current = json;
      fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft: state }),
      }).catch(() => {
        /* server save is best-effort; localStorage is our floor */
      });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [state, hydrating, ready]);

  async function clear() {
    try {
      localStorage.removeItem(LOCAL_KEY);
    } catch {
      /* ignore */
    }
    lastSavedJson.current = '';
    try {
      await fetch('/api/drafts', { method: 'DELETE' });
    } catch {
      /* best-effort */
    }
  }

  return { hydrating, hadDraft, clear };
}
