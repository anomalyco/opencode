type LocalServerAuth = {
  username: string
  password: string
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response

export function createInternalFetch(baseFetch: FetchLike, auth?: LocalServerAuth): FetchLike {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    if (auth && !request.headers.has("authorization")) {
      const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString("base64")
      request.headers.set("authorization", `Basic ${encoded}`)
    }
    return baseFetch(request)
  }) as typeof globalThis.fetch
}
