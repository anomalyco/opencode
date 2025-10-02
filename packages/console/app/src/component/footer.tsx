import { A, createAsync } from "@solidjs/router"
import { createMemo } from "solid-js"
import { github } from "~/lib/github"

export function Footer() {
  const githubData = createAsync(() => github())
  const starCount = createMemo(() =>
    githubData()?.stars
      ? new Intl.NumberFormat("en-US", {
          notation: "compact",
          compactDisplay: "short",
        }).format(githubData()!.stars!)
      : "25K",
  )

  return (
    <footer data-component="footer">
      <div data-slot="cell">
        <A href="https://github.com/sst/opencode" target="_blank">
          GitHub <span>[{starCount()}]</span>
        </A>
      </div>
      <div data-slot="cell">
        <A href="/docs">Docs</A>
      </div>
      <div data-slot="cell">
        <A href="/discord">Discord</A>
      </div>
      <div data-slot="cell">
        <A href="https://x.com/opencode">X</A>
      </div>
    </footer>
  )
}
