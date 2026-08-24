import { useEffect } from "react";

/**
 * Roept `onEscape` aan bij een Escape-toets, zolang het component gemount is.
 *
 * Modals sluiten met een klik naast het venster, maar dat is muis-only: zonder
 * dit is een geopende dialoog met het toetsenbord alleen te verlaten via de
 * annuleerknop — en die moet je dan eerst zien te vinden. Escape is wat een
 * dialoog hoort te doen.
 */
export function useEscapeKey(onEscape: () => void): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onEscape();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape]);
}
