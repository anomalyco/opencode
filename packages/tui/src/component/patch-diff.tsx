/** @jsxImportSource @opentui/solid */
import type { ColorInput } from "@opentui/core"
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
          <diff {...diffProps} diff={hunk.patch} minHeight={hunk.rows} lineNumberBg={local.lineNumberBg} />
        </>
      )}
    </For>
  )
}
