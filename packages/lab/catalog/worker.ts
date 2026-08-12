interface Env {
  readonly ASSETS: { fetch(request: Request): Promise<Response> }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    url.pathname = assetPath(url.pathname)
    return env.ASSETS.fetch(new Request(url, request))
  },
}

export function assetPath(pathname: string) {
  const path = pathname.slice("/lab/catalog".length)
  return path === "" || path === "/" || !path.includes(".") ? "/index.html" : path
}
