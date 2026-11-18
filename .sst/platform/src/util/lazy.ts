export function lazy<T>(callback: () => T) {
  let loaded = false;
  let result: T;

  return () => {
    if (!loaded) {
      loaded = true;
      result = callback();
    }
    return result;
  };
}
