import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { getInitialTheme, saveTheme, type SterlingTheme } from "../theme";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<SterlingTheme>(() => getInitialTheme());

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    saveTheme(next);
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={theme === "light" ? "Use dark mode" : "Use light mode"}
      title={theme === "light" ? "Dark mode" : "Light mode"}
    >
      {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}
