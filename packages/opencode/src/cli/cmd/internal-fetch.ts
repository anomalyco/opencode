export function createInternalFetch(
  base: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response,
  auth?: {
    username: string
    password: string
  },
) {
  const fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    if (auth && !request.headers.has("authorization")) {
      request.headers.set(
        "authorization",
        `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`,
      )
    }
    return base(request)
  }) as typeof globalThis.fetch
  fetch.preconnect = globalThis.fetch.preconnect.bind(globalThis.fetch)
  return fetch
}
