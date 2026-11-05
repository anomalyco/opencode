// Heavy media (video, audio, download zips and 3D models) is not in git and not in the Worker's
// static assets: it is served from the opencode.ai files bucket (the one the downloads use), under
// /files/site/<version>/, at the same path it has under public/. See MEDIA.md.
//
// Pages keep linking the site path (for example /product-videos/heroes/sdk-landscape-dark.mp4).
// In development the file is in public/ and the dev server serves it. In production the request
// misses the static assets, reaches the Worker, and middleware.ts redirects it here.

/** The one base URL of the site's media files. VITE_MEDIA_URL overrides it (for example for staging). */
export const mediaBase = import.meta.env.VITE_MEDIA_URL || "https://opencode.ai/files/site/2026-11"

/** File types that live in the files bucket. script/upload-media.ts uploads the same set. */
export const mediaFile = /\.(mp4|webm|mov|mp3|wav|ogg|m4a|zip|glb|gltf)$/i

/** The files URL for a site path, for example `mediaUrl("/font/film/opencode-font-film-v3-4x5.mp4")`. */
export function mediaUrl(path: string) {
  return `${mediaBase}${path}`
}

/** A redirect to the files bucket for a media path that the static assets did not serve, or undefined. */
export function mediaRedirect(pathname: string, search: string) {
  // /files/* is the files bucket's own route; never redirect it to itself.
  if (!mediaFile.test(pathname) || pathname.startsWith("/_build/") || pathname.startsWith("/files/")) return
  return new Response(null, {
    status: 302,
    headers: { Location: `${mediaUrl(pathname)}${search}`, "Cache-Control": "public, max-age=3600" },
  })
}
