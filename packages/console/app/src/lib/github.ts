import { query } from "@solidjs/router"

export const github = query(async () => {
  "use server"
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  }
  try {
    const [meta, releases, contributors] = await Promise.all([
      fetch("https://api.github.com/repos/sst/opencode", { headers }).then((res) => res.json()),
      fetch("https://api.github.com/repos/sst/opencode/releases", { headers }).then((res) => res.json()),
      fetch("https://api.github.com/repos/sst/opencode/contributors?per_page=1", { headers }),
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
  } catch (e) {
    console.error(e)
  }
  return undefined
}, "github")
