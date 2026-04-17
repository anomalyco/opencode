import { readFile } from "fs/promises"

export type MockAsset = {
  id: number
  name: string
  /** Absolute path to the .tgz on disk that this asset serves */
  tgzPath: string
  /** If true, returns 404 when Authorization header is missing (simulates private asset) */
  requiresAuth?: boolean
}

export type MockRelease = {
  owner: string
  repo: string
  tag: string
  assets: MockAsset[]
}

export type MockPackument = {
  scope: string
  name: string
  tarballPath: string
  version: string
  /** If set, the /registry/{pkg} route returns 401 unless request sends `Authorization: Bearer {token}` */
  requireAuthToken?: string
  /** peerDependencies emitted in the packument's version manifest */
  peerDependencies?: Record<string, string>
}

export type MockServer = {
  port: number
  /** Base URL for api.github.com impersonation, e.g. "http://localhost:12345/api" */
  apiBase: string
  /** Base URL for objects.githubusercontent.com redirect target */
  objectsBase: string
  /** Base URL for npm registry impersonation */
  registryBase: string
  /** Call to stop the server. */
  stop: () => void
  /** Requests received, for assertions. */
  requests: Array<{
    method: string
    url: string
    headers: Record<string, string>
  }>
}

export function startMockGitHub(opts: { releases?: MockRelease[]; packuments?: MockPackument[] }): MockServer {
  const requests: MockServer["requests"] = []
  const releases = opts.releases ?? []
  const packuments = opts.packuments ?? []

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const headers: Record<string, string> = {}
      req.headers.forEach((v, k) => (headers[k] = v))
      requests.push({ method: req.method, url: url.pathname + url.search, headers })

      // Release metadata: /api/repos/{o}/{r}/releases/tags/{tag}
      const metaMatch = url.pathname.match(/^\/api\/repos\/([^/]+)\/([^/]+)\/releases\/tags\/([^/]+)$/)
      if (metaMatch) {
        const [, owner, repo, tag] = metaMatch
        const rel = releases.find((r) => r.owner === owner && r.repo === repo && r.tag === tag)
        if (!rel) return new Response("Not Found", { status: 404 })
        return Response.json({
          tag_name: rel.tag,
          assets: rel.assets.map((a) => ({
            id: a.id,
            name: a.name,
            url: `${url.origin}/api/repos/${owner}/${repo}/releases/assets/${a.id}`,
          })),
        })
      }

      // Asset download: /api/repos/{o}/{r}/releases/assets/{id}
      const assetMatch = url.pathname.match(/^\/api\/repos\/([^/]+)\/([^/]+)\/releases\/assets\/(\d+)$/)
      if (assetMatch) {
        const [, owner, repo, idStr] = assetMatch
        const id = Number(idStr)
        const rel = releases.find((r) => r.owner === owner && r.repo === repo)
        const asset = rel?.assets.find((a) => a.id === id)
        if (!asset) return new Response("Not Found", { status: 404 })
        if (asset.requiresAuth && !req.headers.get("authorization")) return new Response("Not Found", { status: 404 })
        const accept = req.headers.get("accept") ?? ""
        if (!accept.includes("application/octet-stream")) {
          // Return JSON metadata instead of the binary (GitHub's real behavior)
          return Response.json({ id, name: asset.name, content_type: "application/gzip" })
        }
        // Redirect to objects.github — simulates cross-host redirect that strips auth
        return Response.redirect(`${url.origin}/objects/${owner}/${repo}/${asset.id}.tgz`, 302)
      }

      // Cross-host redirect target — no auth expected here (auth was stripped)
      const objMatch = url.pathname.match(/^\/objects\/([^/]+)\/([^/]+)\/(\d+)\.tgz$/)
      if (objMatch) {
        const [, owner, repo, idStr] = objMatch
        const id = Number(idStr)
        const rel = releases.find((r) => r.owner === owner && r.repo === repo)
        const asset = rel?.assets.find((a) => a.id === id)
        if (!asset) return new Response("Not Found", { status: 404 })
        const bytes = await readFile(asset.tgzPath)
        return new Response(new Uint8Array(bytes), {
          status: 200,
          headers: { "content-type": "application/gzip" },
        })
      }

      // npm registry packument: /registry/{@scope}%2f{pkg} or /registry/{@scope}/{pkg}
      const registryMatch = url.pathname.match(/^\/registry\/(.+)$/)
      if (registryMatch) {
        const pkgPath = decodeURIComponent(registryMatch[1])
        const p = packuments.find((pk) => `${pk.scope}/${pk.name}` === pkgPath || pk.name === pkgPath)
        if (!p) return new Response("Not Found", { status: 404 })
        if (p.requireAuthToken) {
          const auth = req.headers.get("authorization") ?? ""
          if (!auth.includes(p.requireAuthToken)) return new Response("Unauthorized", { status: 401 })
        }
        const tarball = `${url.origin}/registry-tarball/${p.scope}/${p.name}/${p.version}.tgz`
        return Response.json({
          name: `${p.scope}/${p.name}`,
          "dist-tags": { latest: p.version },
          versions: {
            [p.version]: {
              name: `${p.scope}/${p.name}`,
              version: p.version,
              dist: { tarball },
              ...(p.peerDependencies ? { peerDependencies: p.peerDependencies } : {}),
            },
          },
        })
      }
      const tarMatch = url.pathname.match(/^\/registry-tarball\/([^/]+)\/([^/]+)\/([^/]+)\.tgz$/)
      if (tarMatch) {
        const [, scope, name, version] = tarMatch
        const p = packuments.find((pk) => pk.scope === scope && pk.name === name && pk.version === version)
        if (!p) return new Response("Not Found", { status: 404 })
        const bytes = await readFile(p.tarballPath)
        return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "application/gzip" } })
      }

      return new Response("Not Found", { status: 404 })
    },
  })

  const port = server.port ?? 0
  return {
    port,
    apiBase: `http://localhost:${port}/api`,
    objectsBase: `http://localhost:${port}/objects`,
    registryBase: `http://localhost:${port}/registry`,
    stop: () => server.stop(true),
    requests,
  }
}
