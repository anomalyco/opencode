/** URL path prefix the opencode server serves this app under, such as `/opencode`, or `""` at the root. */
export function basePath() {
  return document.querySelector<HTMLMetaElement>('meta[name="opencode-base-path"]')?.content ?? ""
}
