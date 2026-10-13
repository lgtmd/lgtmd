import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
const path = new URL(window.__LGTMD__?.basePath ?? "./", window.location.href)
  .pathname;
const storageKey = `lgtmd:theme:${path}`;
function preference(): Theme {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === "light" || value === "dark") return value;
  } catch {
    /* Storage can be unavailable; the control still works for this visit. */
  }
  return "system";
}
function apply(theme: Theme): void {
  document.documentElement.dataset.theme =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
}
// Apply the saved/system appearance before the first React render.
apply(preference());

export function ThemeSelect() {
  const [theme, setTheme] = useState<Theme>(preference);
  useEffect(() => {
    apply(theme);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => apply(theme);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);
  return (
    <label className="theme-control flex items-center gap-2 text-muted-foreground">
      <svg
        aria-hidden="true"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </svg>
      <select
        className="theme-select"
        aria-label="Color theme"
        value={theme}
        onChange={(event) => {
          const next = event.target.value as Theme;
          setTheme(next);
          apply(next);
          try {
            localStorage.setItem(storageKey, next);
          } catch {
            /* Optional persistence. */
          }
        }}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
