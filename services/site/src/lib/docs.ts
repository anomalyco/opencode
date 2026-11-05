// Where the current docs live. The docs Intro is a page of this app; the other docs pages come from
// the separate docs app at the same paths. The old /v2/docs URLs redirect here (see middleware.ts).
export const docsBase = "/v2/docs"

/** Where the separate V1 docs app (Starlight, built for /docs/) serves the V1 docs. */
export const v1DocsOrigin = "https://docs.opencode.ai/docs/"

/**
 * The V1 docs on our domain, for example `v1DocsUrl("/ide/")`. /v1/docs/* redirects to the same
 * path on the V1 docs app (middleware.ts) until that app is built for /v1/docs.
 */
export function v1DocsUrl(path = "") {
  return `/v1/docs${path}`
}

/** A site-relative link into the docs, for example `docsUrl("/models/")`. */
export function docsUrl(path = "") {
  return `${docsBase}${path}`
}
