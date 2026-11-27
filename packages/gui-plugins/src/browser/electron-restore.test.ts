import { expect, test } from "bun:test"
import path from "node:path"
import { runElectronFixture } from "./electron-run"

type Restored = {
  readonly url: string
  readonly states: readonly { readonly title: string; readonly loading: boolean; readonly url: string }[]
  readonly last: { readonly title: string; readonly loading: boolean; readonly url: string }
}

// What a restored tab's strip label draws rests on the titles its page publishes while it loads, and those rest on
// Chromium: it names a document after its URL (`127.0.0.1:1234/saved`) from the commit until the <title> parses. This
// restores two tabs in the pinned Electron against a page whose title arrives late, so a restored page that publishes
// Chromium's name again, or an upgrade that changes when the title arrives, fails here.
test(
  "a restored tab publishes its saved title, or none, until its document names itself",
  async () => {
    const result: { saved: Restored; untitled: Restored } = JSON.parse(
      await runElectronFixture({ fixture: path.join(import.meta.dir, "electron-restore.fixture.ts") }),
    )

    // Each title once, in the order the page published them.
    const titles = (tab: Restored) => tab.states.map((state) => state.title).filter((title, index, all) => title !== all[index - 1])

    expect(titles(result.saved)).toEqual(["Saved title", "Real title"])
    expect(result.saved.states[0]).toEqual({ title: "Saved title", loading: true, url: result.saved.url })
    expect(result.saved.last).toEqual({ title: "Real title", loading: false, url: result.saved.url })
    // A tab saved before titles were kept has none to hold: it publishes none, never Chromium's name.
    expect(titles(result.untitled)).toEqual(["", "Real title"])
    expect(result.untitled.last).toEqual({ title: "Real title", loading: false, url: result.untitled.url })
  },
  // Starting Electron takes seconds on a loaded runner.
  60_000,
)
