import { useState } from "react";

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
