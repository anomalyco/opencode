// Heavy media (video, audio, download zips and 3D models) is not in git and not in the Worker's
// static assets. It lives in the files bucket behind the existing /files route (services/files),
// under one dated folder, at the same path it has under public/ (media-manifest.txt lists every
// file). Pages link the site path through mediaUrl(), so nothing redirects at request time.

/** The one base path of the site's media in the files bucket. */
export const mediaBase = "/files/site/2026-11"

/** File types that live in the files bucket rather than in the Worker's static assets. */
export const mediaFile = /\.(mp4|webm|mov|mp3|wav|ogg|m4a|zip|glb|gltf)$/i

/**
 * Whether a file under public/ (its path from there) goes to the files bucket. The link-card videos
 * script/og.ts writes to og/ (og:video, under 100 kB each) are the exception: they ship as static
 * assets with the cards that name them.
 */
export const inBucket = (file: string) => mediaFile.test(file) && !/^og[\\/]/.test(file)

/** The files-bucket URL for a media site path, for example `mediaUrl("/arcade3d/cabinet.glb")`. Other paths pass through. */
export function mediaUrl(path: string) {
  if (!path.startsWith("/") || path.startsWith(mediaBase) || !mediaFile.test(path.split(/[?#]/)[0])) return path
  return `${mediaBase}${path}`
}

/** Every logo and wordmark in one zip (the site's menus, the Brand and Press pages). */
export const brandAssets = mediaUrl("/opencode-brand-assets.zip")
