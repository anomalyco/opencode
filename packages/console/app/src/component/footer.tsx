import { createAsync } from "@solidjs/router"
import { createMemo } from "solid-js"
import { github } from "~/lib/github"
import { config } from "~/config"

export function Footer() {
  const githubData = createAsync(() => github())
  const starCount = createMemo(() =>
    githubData()?.stars
      ? new Intl.NumberFormat("en-US", {
          notation: "compact",
          compactDisplay: "short",
        }).format(githubData()!.stars!)
      : config.github.starsFormatted.compact,
  )

  return (
    <footer data-component="footer">
      <div data-slot="cell">
        <a href={config.github.repoUrl} target="_blank">
          GitHub <span>[{starCount()}]</span>
        </a>
      </div>
      <div data-slot="cell">
        <a href="/docs">Docs</a>
      </div>
      <div data-slot="cell">
        <a href="/changelog">Changelog</a>
      </div>
      <div data-slot="cell">
        <a href="/discord">Discord</a>
      </div>
      <div data-slot="cell">
        <a href={config.social.twitter}>X</a>
      </div>
    </footer>
  )
}
