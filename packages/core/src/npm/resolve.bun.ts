export function resolveModule(name: string, directory: string) {
  return import.meta.resolve(name, directory)
}
