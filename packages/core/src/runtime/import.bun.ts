export function importModule(specifier: string) {
  return import(specifier) as Promise<unknown>
}

export function resolveModule(specifier: string, directory: string) {
  return import.meta.resolve(specifier, directory)
}
