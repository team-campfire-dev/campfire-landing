import { useCallback, useSyncExternalStore } from 'react';
import { fireThemes, isFireThemeId, type FireThemeId } from './campfire/themes';

const STORAGE_KEY = 'campfire:fire-theme';
const THEME_IDS = Object.keys(fireThemes) as FireThemeId[];
const listeners = new Set<() => void>();
/** Last pick in this tab, so switching still works when storage is unavailable. */
let picked: FireThemeId | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function readStored(): FireThemeId | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isFireThemeId(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The visitor's chosen fire theme, remembered in localStorage. Renders `fallback` on the server.
 * `stepTheme(±1)` moves to the next/previous theme in registry order, wrapping around.
 */
export function useFireTheme(fallback: FireThemeId) {
  const current = useCallback(() => picked ?? readStored() ?? fallback, [fallback]);
  const themeId = useSyncExternalStore(subscribe, current, () => fallback);

  const setThemeId = useCallback((id: FireThemeId) => {
    picked = id;
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Private mode or blocked storage: the choice just won't survive a reload.
    }
    listeners.forEach((listener) => listener());
  }, []);

  const stepTheme = useCallback(
    (direction: number) => {
      const index = THEME_IDS.indexOf(current());
      setThemeId(THEME_IDS[(index + direction + THEME_IDS.length) % THEME_IDS.length]);
    },
    [current, setThemeId],
  );

  return { themeId, themeIds: THEME_IDS, setThemeId, stepTheme };
}
