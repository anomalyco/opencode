import { CodeRenderable, type Renderable } from "@opentui/core"
import type { TestRendererSetup, TestWaitForOptions } from "@opentui/core/testing"

// Markdown and code paint nothing until the shared tree-sitter worker answers. That round trip is
// not tied to frames, so a plain waitForFrame can spend its whole pass budget while text is still
// pending on a loaded runner. Awaiting in-flight highlights inside the predicate keeps the passes
// for render-driven work.
export function waitForHighlightedFrame(
  setup: Pick<TestRendererSetup, "renderer" | "waitForFrame">,
  predicate: (frame: string) => boolean,
  options?: TestWaitForOptions,
) {
  return setup.waitForFrame(async (frame) => {
    if (predicate(frame)) return true
    await Promise.all(highlighting(setup.renderer.root).map((node) => node.highlightingDone))
    return false
  }, options)
}

function highlighting(node: Renderable): CodeRenderable[] {
  return [
    ...(node instanceof CodeRenderable && node.isHighlighting ? [node] : []),
    ...node.getChildren().flatMap(highlighting),
  ]
}
