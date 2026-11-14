import { BOOTSTRAP_ELEMENT_ID, type Bootstrap } from "../../../sdks/vscode/src/webview-protocol"

/** Written into the page by the extension host before any script runs. */
export const bootstrap: Bootstrap = JSON.parse(document.getElementById(BOOTSTRAP_ELEMENT_ID)?.textContent ?? "null")
