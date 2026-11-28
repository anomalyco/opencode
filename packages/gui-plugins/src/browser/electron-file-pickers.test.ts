import { expect, test } from "bun:test"
import path from "node:path"
import { runElectronFixture } from "./electron-run"

// file-pickers.ts must take the File System Access pickers away from pane pages, whose file access the pane refuses
// after the dialog, while a file input, their fallback, still opens a chooser. Runs in the pinned Electron.
test(
  "the pinned Electron shows pane pages no File System Access pickers and keeps their file input",
  async () => {
    const result = JSON.parse(await runElectronFixture({ fixture: path.join(import.meta.dir, "electron-file-pickers.fixture.ts") }))

    // The pinned Electron has the pickers, so their absence below is the removal.
    expect(result.before).toEqual(["showOpenFilePicker", "showSaveFilePicker", "showDirectoryPicker"])
    expect(result.page).toEqual([])
    expect(result.frame).toEqual([])
    expect(result.fileInput).toBe("selectSingle")
  },
  // Starting Electron takes seconds on a loaded runner.
  60_000,
)
