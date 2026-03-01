// Jules proxy configuration

export const JULES_BASE = "https://jules.googleapis.com/v1alpha"

export const JULES_HEADER = "x-goog-api-key"

export const JULES_TIMEOUT = 30_000

export function url(path: string): string {
  return JULES_BASE + path
}

export function headers(key: string): Record<string, string> {
  return {
    [JULES_HEADER]: key,
    "Content-Type": "application/json",
  }
}

export function key(request: Request): string | undefined {
  return request.headers.get(JULES_HEADER) ?? undefined
}
