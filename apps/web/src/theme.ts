export type Theme = "light" | "dark";

export const themeStorageKey = "seedboard:theme";

export function resolveTheme(saved: string | null, prefersDark: boolean): Theme {
  if (saved === "dark" || saved === "light") return saved;
  return prefersDark ? "dark" : "light";
}

export function getSavedThemePreference(): Theme | null {
  try {
    const saved = window.localStorage.getItem(themeStorageKey);
    return saved === "dark" || saved === "light" ? saved : null;
  } catch {
    // Theme preferences are optional when browser storage is unavailable.
    return null;
  }
}

export function getSystemTheme(): Theme {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    // Older browsers may not expose matchMedia.
    return "light";
  }
}

export function getInitialTheme(): Theme {
  return getSavedThemePreference() ?? getSystemTheme();
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function saveTheme(theme: Theme, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? window.localStorage).setItem(themeStorageKey, theme);
  } catch {
    // Keep the current session usable when browser storage is unavailable.
  }
}
