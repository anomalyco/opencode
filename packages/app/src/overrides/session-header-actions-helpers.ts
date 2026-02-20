export function extractDirectory(result: string | string[] | null): string | null {
  if (Array.isArray(result)) return result[0] ?? null
  return result
}
