export function catalogBasePath() {
  return window.location.pathname.startsWith("/lab/catalog") ? "/lab/catalog/" : "/"
}
