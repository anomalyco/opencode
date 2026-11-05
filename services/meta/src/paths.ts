// Every path this Worker serves. Each one is also a `<path>*` route, see cloudflare.config.ts.
export const PATHS = {
  config: "/config.json",
  tui: "/tui.json",
  client: "/oauth/opencode/client.json",
  appleAppSiteAssociation: "/.well-known/apple-app-site-association",
} as const
