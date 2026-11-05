// The www Worker's entry: /v2* (the route the docs have always had) goes to the Astro docs server,
// everything else to the site's SolidStart server. script/build.ts copies both servers next to this
// file in the Build Output, so they are named here rather than imported statically. Each loads on its
// first request, so an isolate only starts the one it serves.
type Handler = { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> | Response }

const servers = { docs: "./docs/entry.mjs", site: "./site/index.mjs" }

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const app: { default: Handler } = await import(
      new URL(request.url).pathname.startsWith("/v2") ? servers.docs : servers.site
    )
    return app.default.fetch(request, env, ctx)
  },
}
