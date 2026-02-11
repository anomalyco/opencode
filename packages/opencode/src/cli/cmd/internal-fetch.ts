type LocalServerAuth = {
  username: string
  password: string
}

export function createInternalFetch(baseFetch: typeof globalThis.fetch, auth?: LocalServerAuth): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    if (auth && !request.headers.has("authorization")) {
      const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString("base64")
      request.headers.set("authorization", `Basic ${encoded}`)
    }
    return baseFetch(request)
  }) as typeof globalThis.fetch
}
