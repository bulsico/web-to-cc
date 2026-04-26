import { useEffect, useRef } from "react";

export function useRefetchOnFocus(callback: () => void, enabled = true) {
  const cbRef = useRef(callback);
  useEffect(() => {
    cbRef.current = callback;
  });

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function fire() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cbRef.current(), 50);
    }

    function onVisibility() {
      if (document.visibilityState === "visible") fire();
    }

    window.addEventListener("focus", fire);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", fire);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
}
