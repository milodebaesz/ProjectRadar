/** Normaliseer een projectnaam tot een stabiele sleutel (voor aggregatie). */
export function projectKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Korte, Nederlandse "x geleden"-weergave van een ISO-datum. */
export function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);
  const wk = Math.round(day / 7);
  const mo = Math.round(day / 30);
  const yr = Math.round(day / 365);

  if (sec < 45) return "zojuist";
  if (min < 45) return `${min} min geleden`;
  if (hr < 24) return `${hr}u geleden`;
  if (day === 1) return "gisteren";
  if (day < 7) return `${day} dgn geleden`;
  if (wk < 5) return `${wk} ${wk === 1 ? "week" : "wkn"} geleden`;
  if (mo < 12) return `${mo} ${mo === 1 ? "maand" : "mnd"} geleden`;
  return `${yr} ${yr === 1 ? "jaar" : "jaar"} geleden`;
}

/** Genereer een korte unieke id (voor fasen/mijlpalen). */
export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}
