import { afterEach, describe, expect, test } from "bun:test"
import { For } from "solid-js"
import { testRender } from "@opentui/solid"
import { InlineToolRow } from "../../../src/cli/cmd/tui/routes/session/index"

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  testSetup?.renderer.destroy()
  testSetup = undefined
})

type ToolFixture = { icon: string; label: string; error?: string }

const tools: readonly ToolFixture[] = [
  {
    icon: "✱",
    label:
      'Grep "OPENCODE.*DB|database|sqlite|drizzle|dev.*db|data.*dir|xdg|APPDATA" in packages/opencode/src (151 matches)',
  },
  {
    icon: "✱",
    label: 'Glob "**/*db*" in packages/opencode (6 matches)',
  },
  {
    icon: "→",
    label: "Read packages/opencode/src/storage/db.ts [offset=1, limit=130]",
  },
  {
    icon: "→",
    label: "Read packages/opencode/src/index.ts [offset=1, limit=100]",
    error: "No LSP server available for this file type.",
  },
  {
    icon: "✱",
    label:
      'Grep "export const OPENCODE_DB|OPENCODE_DB|OPENCODE_DEV|Global\\.Path\\.data|data =" in packages/opencode/src (115 matches)',
  },
] as const

function ShellOutput() {
  return (
    <box id="tool-block-shell" marginTop={1} paddingTop={1} paddingBottom={1} paddingLeft={2} gap={1}>
      <text paddingLeft={3}># List files</text>
      <box gap={1}>
        <text>$ ls</text>
        <text>file.ts</text>
      </box>
    </box>
  )
}

function Fixture(props: { errorExpanded?: boolean; shellOutput?: boolean }) {
  return (
    <box flexDirection="column" width={72}>
      <box flexDirection="column">
        {props.shellOutput && <ShellOutput />}
        <For each={tools}>
          {(item) => (
            <InlineToolRow
              icon={item.icon}
              complete={true}
              pending=""
              failed={Boolean(item.error)}
              error={item.error}
              errorExpanded={props.errorExpanded}
            >
              {item.label}
            </InlineToolRow>
          )}
        </For>
      </box>
    </box>
  )
}

describe("TUI inline tool wrapping", () => {
  test("snapshots consecutive grep, glob, and read rows at a narrow width", async () => {
    testSetup = await testRender(() => <Fixture />, { width: 72, height: 12 })
    await testSetup.renderOnce()
    await testSetup.renderOnce()

    expect(
      testSetup
        .captureCharFrame()
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .trimEnd(),
    ).toMatchSnapshot()
  })

  test("snapshots expanded tool errors under the tool text", async () => {
    testSetup = await testRender(() => <Fixture errorExpanded />, { width: 72, height: 12 })
    await testSetup.renderOnce()
    await testSetup.renderOnce()

    expect(
      testSetup
        .captureCharFrame()
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .trimEnd(),
    ).toMatchSnapshot()
  })

  test("keeps separation after a shell output block", async () => {
    testSetup = await testRender(() => <Fixture shellOutput />, { width: 72, height: 16 })
    await testSetup.renderOnce()
    await testSetup.renderOnce()

    expect(
      testSetup
        .captureCharFrame()
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .trimEnd(),
    ).toMatchSnapshot()
  })
})
