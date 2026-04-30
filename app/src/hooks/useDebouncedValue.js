import { useState, useEffect, useRef } from "react";

export function useDebouncedValue(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  const timerRef = useRef(null);
  useEffect(() => {
    timerRef.current = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timerRef.current);
  }, [value, delay]);
  return debounced;
}
