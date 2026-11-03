import { lazy, Suspense } from "solid-js"
import { Slot, Style, type Plugin } from "@opencode/plugin/gui"
import type definition from "./index"
import css from "./wordmark.css?inline"

const setup: Plugin.Setup<typeof definition> = (ctx) => {
  const WordmarkHero = lazy(() => import("./hero"))
  // The hero shows as soon as the app opens on a new session, so its chunk loads now rather than when idle.
  void WordmarkHero.preload()

  ctx.add(Style, css)

  // Below the default order, so a plugin's hero replaces this one.
  ctx.add(Slot, {
    at: "new-session.hero",
    order: -1,
    render: (input) => (
      <Suspense
        fallback={
          <div aria-hidden="true" class="mx-auto w-full max-w-[720px]">
            <div class="mx-auto aspect-[234/42] w-4/5" />
          </div>
        }
      >
        <WordmarkHero hero={input} />
      </Suspense>
    ),
  })
}

export default setup
