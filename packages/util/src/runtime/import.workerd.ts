const unavailable = () => new Error("Dynamic module loading is unavailable on workerd")

export function importModule(_specifier: string): Promise<unknown> {
  return Promise.reject(unavailable())
}

export function resolveModule(_specifier: string, _directory: string): string {
  throw unavailable()
}
