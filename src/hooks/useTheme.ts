import { useEffect, useState } from "react";
import { loadTheme, saveTheme } from "../lib/storage";

/** Licht/donker-thema met persistentie en `data-theme` op <html>. */
export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const t = loadTheme();
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);
  }, []);

  function toggleTheme() {
    setTheme((cur) => {
      const next = cur === "dark" ? "light" : "dark";
      saveTheme(next);
      document.documentElement.setAttribute("data-theme", next);
      return next;
    });
  }

  return { theme, toggleTheme };
}
