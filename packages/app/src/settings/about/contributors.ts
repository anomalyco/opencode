const CREDITED_CONTRIBUTORS = 16
let request: Promise<number> | undefined

export const FALLBACK_OTHER_CONTRIBUTORS = 935

export function otherContributorCount(link: string | null) {
  const total = Number.parseInt(link?.match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/)?.[1] ?? "", 10)
  if (!Number.isFinite(total) || total <= CREDITED_CONTRIBUTORS) return FALLBACK_OTHER_CONTRIBUTORS
  return total - CREDITED_CONTRIBUTORS
}

export function loadOtherContributorCount(fetcher: typeof fetch) {
  request ??= fetcher("https://api.github.com/repos/anomalyco/opencode/contributors?anon=1&per_page=1", {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  }).then(
    (response) => (response.ok ? otherContributorCount(response.headers.get("Link")) : FALLBACK_OTHER_CONTRIBUTORS),
    () => FALLBACK_OTHER_CONTRIBUTORS,
  )
  return request
}
