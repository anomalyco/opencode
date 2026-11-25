import { expect, test } from "bun:test"
import path from "node:path"
import { runElectronFixture } from "./electron-run"
import { svgSample } from "./icon-samples"

type Reported = {
  /** The page's icons as Chromium listed them. */
  readonly listed: readonly string[]
  /** The icon the pane makes of that list, as the strip draws it. */
  readonly icon: { readonly type: string; readonly length?: number; readonly text?: string } | null
}

const png = (color: string) => ({ type: "image/png", width: 32, height: 32, length: expect.any(Number), color })

// A tab's icon rests on three things Electron decides: which icons Chromium lists for a page, what a request for one
// returns, and which files `nativeImage` decodes, which is PNG and JPEG only. Most sites serve an `.ico` file, and
// those tabs drew the globe. This loads a few kinds of site in the pinned Electron, so an upgrade that changes any of
// the three fails here. `icon-image.test.ts` covers what an `.ico` file can hold, and `page-machine.test.ts` how a
// tab takes the list and reports the icon.
test(
  "a page's icon is a small PNG, or the site's SVG as it is, and none for what is not a picture",
  async () => {
    const result: Record<string, Reported> = JSON.parse(await runElectronFixture({ fixture: path.join(import.meta.dir, "electron-icon.fixture.ts") }))

    expect(Object.fromEntries(Object.entries(result).map(([site, reported]) => [site, reported.icon]))).toEqual({
      // The file's 32px bitmap, and a 180px PNG reduced.
      ico: png("#0ac83c"),
      png: png("#f05a1e"),
      // The window draws a site's SVG as an image; one too long to report gives way to the next.
      svg: { type: "image/svg+xml", text: svgSample },
      unlisted: png(expect.any(String)),
      // A JPEG on another origin, behind a redirect.
      moved: png(expect.any(String)),
      refused: null,
    })
    // Chromium lists a page's icons by address, and asks for /favicon.ico when the page lists none.
    expect(result.svg?.listed).toEqual(["/svg/a.svg", "/svg/b.svg"])
    expect(result.unlisted?.listed).toEqual(["/favicon.ico"])
    // That one is 32px no encoder can shrink: the longest PNG fits the 6,000 characters the history and saved tabs keep.
    expect(result.unlisted?.icon?.length).toBeGreaterThan(4_000)
    expect(result.unlisted?.icon?.length).toBeLessThanOrEqual(6_000)
  },
  // Starting Electron takes seconds on a loaded runner.
  60_000,
)
