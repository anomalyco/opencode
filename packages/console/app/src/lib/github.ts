import { query } from "@solidjs/router"

export const github = query(async () => {
  "use server"
  try {
    const [meta, releases, contributors] = await Promise.all([
      fetch("https://api.github.com/repos/sst/opencode").then((res) => res.json()),
      fetch("https://api.github.com/repos/sst/opencode/releases").then((res) => res.json()),
      fetch("https://api.github.com/repos/sst/opencode/contributors?per_page=1"),
    ])
    const [release] = releases
    const contributorCount = Number.parseInt(
      contributors.headers
        .get("Link")!
        .match(/&page=(\d+)>; rel="last"/)!
        .at(1)!,
    )
    return {
      stars: meta.stargazers_count,
      release: {
        name: release.name,
        url: release.html_url,
      },
      contributors: contributorCount,
    }
  } catch {}
  return undefined
}, "github")
