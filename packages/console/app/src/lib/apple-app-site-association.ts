// Lets https://opencode.ai/pair links open the OpenCode iOS app. Only /pair may open the app.
// Served from middleware because the file router skips dot directories like /.well-known.
const body = JSON.stringify({
  applinks: {
    details: [
      {
        appIDs: ["5NZ4Q7NXJ4.ai.opencode.mobilecode"],
        components: [{ "/": "/pair", comment: "pairing links, payload in the fragment" }, { "/": "/pair/*" }],
      },
    ],
  },
})

export function appleAppSiteAssociation(request: Request) {
  if (request.method !== "GET" && request.method !== "HEAD") return
  if (new URL(request.url).pathname !== "/.well-known/apple-app-site-association") return
  return new Response(request.method === "HEAD" ? null : body, {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
  })
}
