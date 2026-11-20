import { expect, test } from "bun:test"
import path from "node:path"
import { runElectronFixture } from "./electron-run"

type Reported = {
  /** The page's icons as Chromium listed them. */
  readonly listed: readonly string[]
  /** The icon the tab reported, as the strip draws it. */
  readonly icon: { readonly type: string; readonly width: number; readonly height: number; readonly length: number; readonly color: string } | null
  /** Whether the tab reported what loading the same list again gives. */
  readonly same: boolean
}

const png = (color: string, size = 32) => ({ type: "image/png", width: size, height: size, length: expect.any(Number), color })

// A tab's icon rests on three things Electron decides: which icons Chromium lists for a page, what a request for one
// returns, and which files `nativeImage` decodes, which is PNG and JPEG only. Most sites serve an `.ico` file, and
// those tabs drew the globe. This opens one tab for each kind of site in the pinned Electron, so an upgrade that
// changes any of the three fails here.
test(
  "a tab reports its page's icon as a small PNG whatever the site serves, and none for what is not a picture",
  async () => {
    const result: Record<string, Reported> = JSON.parse(await runElectronFixture({ fixture: path.join(import.meta.dir, "electron-icon.fixture.ts") }))
    const icons = Object.fromEntries(Object.entries(result).map(([site, reported]) => [site, reported.icon]))

    expect(icons).toEqual({
      // .ico files: the 32px image of each, or the one nearest above it reduced, whatever its colors.
      small: png("#e65000", 16),
      ico: png("#0ac83c"),
      colors16: png("#c8780a"),
      colors256: png("#1478c8"),
      icoPng: png("#9628dc"),
      pngAsIco: png("#1e1e1e"),
      // Larger files are reduced: a 180px PNG, and the 32px one no encoder can shrink.
      touch: png("#f05a1e"),
      noise: png(expect.any(String)),
      jpeg: png(expect.any(String)),
      // A site's SVG is never drawn: the page's next icon is, or none.
      svg: null,
      svgThenPng: png("#4646c8"),
      inline: png("#783c00", 16),
      inlineSvg: null,
      // No <link>, a redirect and another origin.
      unlisted: png("#009696"),
      redirect: png("#f05a1e"),
      elsewhere: png("#5a1ea0"),
      // Bytes that are no picture, a page in the icon's place, a missing file and one past the size limit.
      junk: null,
      html: null,
      missing: null,
      huge: null,
    })
    // Chromium asks for /favicon.ico when the page lists no icon, and lists a page's own icons by address.
    expect(result.unlisted?.listed).toEqual(["/favicon.ico"])
    expect(result.svgThenPng?.listed).toEqual(["/svgThenPng/a.svg", "/svgThenPng/b.png"])
    expect(result.elsewhere?.listed).toEqual(["//elsewhere/site.ico"])
    // Every icon fits the history's and the saved tabs' limit of 6,000 characters, the incompressible one included.
    expect(Math.max(...Object.values(result).map((reported) => reported.icon?.length ?? 0))).toBeLessThanOrEqual(6_000)
    expect(result.noise?.icon?.length).toBeGreaterThan(4_000)
    // Agent-opened or not, the tab reported what its list gives, and nothing else.
    expect(Object.values(result).map((reported) => reported.same)).toEqual(Object.keys(result).map(() => true))
  },
  // Starting Electron takes seconds on a loaded runner.
  60_000,
)
