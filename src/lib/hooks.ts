import { useState } from "react";

/** A JSON-serializable UI preference (e.g. a table's column order) that remembers its last value
 * across reloads, best-effort — falls back to `initial` if localStorage is unavailable or holds
 * something that no longer parses (e.g. after a column was renamed/removed). */
export function usePersistedState<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const update = (next: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const resolved = typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
      try {
        localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        // best-effort persistence only
      }
      return resolved;
    });
  };
  return [value, update];
}

/** A boolean UI toggle (e.g. "show summary panel") that remembers its last value across reloads,
 * best-effort — falls back to `false` if localStorage is unavailable rather than failing. */
export function usePersistedToggle(key: string): [boolean, () => void] {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setValue((v) => {
      const next = !v;
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // best-effort persistence only
      }
      return next;
    });
  };
  return [value, toggle];
}
