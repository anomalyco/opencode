/** @jsxImportSource @opentui/solid */
import { DiffRenderable, LineNumberRenderable, type ColorInput } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { createMemo, For, Show, splitProps } from "solid-js"
import { splitPatchHunks } from "../util/diff"

type Props = Omit<JSX.IntrinsicElements["diff"], "diff" | "lineNumberBg"> & {
  diff: string
  hunkFg: ColorInput
  lineNumberBg: ColorInput
}

export function PatchDiff(props: Props) {
  const [local, diffProps] = splitProps(props, ["diff", "hunkFg", "lineNumberBg"])
  const hunks = createMemo(() => splitPatchHunks(local.diff))
  const nodes = new Set<DiffRenderable>()
  const syncGutters = (attempt = 0) => {
    requestAnimationFrame(() => {
      const sides = [...nodes]
        .filter((item) => !item.isDestroyed)
        .flatMap((item) => item.getChildren().filter((side) => side instanceof LineNumberRenderable))
      const max = Math.max(...sides.flatMap((side) => [...side.getLineNumbers().values()]))
      if (!max && attempt < 2) return syncGutters(attempt + 1)
      if (!max) return
      sides.forEach((side) => {
        side.setLineNumbers(new Map([...side.getLineNumbers(), [-1, max]]))
        side.setLineSigns(new Map([...side.getLineSigns(), [-1, { after: "  " }]]))
      })
    })
  }
  const register = (node: DiffRenderable) => {
    nodes.add(node)
    syncGutters()
  }

  return (
    <For each={hunks()}>
      {(hunk, index) => (
        <>
          <Show when={index() > 0}>
            <box width="100%" height={1} backgroundColor={local.lineNumberBg}>
              <text fg={local.hunkFg} bg={local.lineNumberBg}>
                {hunk.header ?? ""}
              </text>
            </box>
          </Show>
          <diff
            {...diffProps}
            ref={register}
            diff={hunk.patch}
            minHeight={hunk.rows}
            lineNumberBg={local.lineNumberBg}
          />
        </>
      )}
    </For>
  )
}
