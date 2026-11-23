import type { Cdp } from "./cdp"

// The File System Access pickers open the system's Open or Save dialog, but the pane refuses the file access that
// follows (`fileSystem` has no permission kind), so a person picks a file for nothing, and Save has already created an
// empty one. Without them, pages that check for the pickers fall back to a file input and a download, which work here.
const REMOVE = `for (const name of ["showOpenFilePicker", "showSaveFilePicker", "showDirectoryPicker"]) delete globalThis[name]`

/** Removes the pickers from every document of the tab's frames in `sessionID`, including the one already shown. */
export function removeFilePickers(cdp: Cdp, sessionID?: string) {
  return cdp
    .send("Page.addScriptToEvaluateOnNewDocument", { source: REMOVE, runImmediately: true }, sessionID)
    .then(() => undefined)
}
