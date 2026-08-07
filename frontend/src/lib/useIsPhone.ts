import { useEffect, useState } from "react";

/** Layout “celular”: pantallas estrechas donde el ticket lateral no cabe bien. Tablets (~768+) usan el layout normal. */
export function useIsPhone(breakpointPx = 767): boolean {
  const [phone, setPhone] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${breakpointPx}px)`).matches;
  });

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpointPx}px)`);
    const onChange = () => setPhone(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpointPx]);

  return phone;
}
