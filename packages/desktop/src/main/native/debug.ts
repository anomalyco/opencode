import type { WebContents } from "electron"

const focusDebuggerOwners = new WeakSet<WebContents>()
const forcedFocusNodes = new WeakMap<WebContents, number[]>()
const focusableSelector = `
  a[href],
  button:not([disabled]),
  input:not([disabled]),
  select:not([disabled]),
  textarea:not([disabled]),
  summary,
  [contenteditable="true"],
  [tabindex]:not([tabindex="-1"])
`

export async function setForceFocus(contents: WebContents, enabled: boolean) {
  const debuggerApi = contents.debugger
  if (!debuggerApi.isAttached()) {
    if (!enabled) {
      focusDebuggerOwners.delete(contents)
      forcedFocusNodes.delete(contents)
      return
    }
    debuggerApi.attach("1.3")
    focusDebuggerOwners.add(contents)
    debuggerApi.once("detach", () => {
      focusDebuggerOwners.delete(contents)
      forcedFocusNodes.delete(contents)
    })
  }

  if (!enabled) {
    await Promise.allSettled(
      (forcedFocusNodes.get(contents) ?? []).map((nodeId) =>
        debuggerApi.sendCommand("CSS.forcePseudoState", {
          nodeId,
          forcedPseudoClasses: [],
        }),
      ),
    )
    forcedFocusNodes.delete(contents)
    if (!focusDebuggerOwners.delete(contents)) return
    debuggerApi.detach()
    return
  }

  await debuggerApi.sendCommand("DOM.enable")
  await debuggerApi.sendCommand("CSS.enable")
  const document: unknown = await debuggerApi.sendCommand("DOM.getDocument", {
    depth: -1,
    pierce: true,
  })
  const nodes: unknown = await debuggerApi.sendCommand("DOM.querySelectorAll", {
    nodeId: readDocumentNodeId(document),
    selector: focusableSelector,
  })
  const nodeIds = readNodeIds(nodes)
  forcedFocusNodes.set(contents, [...new Set([...(forcedFocusNodes.get(contents) ?? []), ...nodeIds])])
  await Promise.allSettled(
    nodeIds.map((nodeId) =>
      debuggerApi.sendCommand("CSS.forcePseudoState", {
        nodeId,
        forcedPseudoClasses: ["focus", "focus-visible"],
      }),
    ),
  )
}

function readDocumentNodeId(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    !("root" in value) ||
    !value.root ||
    typeof value.root !== "object" ||
    !("nodeId" in value.root) ||
    typeof value.root.nodeId !== "number"
  ) {
    throw new Error("Invalid DOM.getDocument response")
  }
  return value.root.nodeId
}

function readNodeIds(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    !("nodeIds" in value) ||
    !Array.isArray(value.nodeIds) ||
    !value.nodeIds.every((nodeId) => typeof nodeId === "number")
  ) {
    throw new Error("Invalid DOM.querySelectorAll response")
  }
  return value.nodeIds
}
