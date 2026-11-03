import { useEffect, useState } from "react";

// Returns a copy of `value` that only updates after it has stopped changing for
// `delayMs`. Used to keep fast-typing search inputs from firing a request per
// keystroke.
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
