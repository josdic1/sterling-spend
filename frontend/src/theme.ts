export type SterlingTheme = "light" | "dark";

const STORAGE_KEY = "sterling-spend-theme";

export function getInitialTheme(): SterlingTheme {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme(theme: SterlingTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function saveTheme(theme: SterlingTheme) {
  window.localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}
