/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { ConfigProvider } from "../../../src/config"
import { Keymap, type KeymapCommand } from "../../../src/context/keymap"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { argumentSlash } from "../../../src/component/prompt"

test("dispatch passes slash input through the registered command", async () => {
  const received: Array<string | undefined> = []
  let dispatch: ReturnType<typeof Keymap.use>["dispatch"]

  function Commands() {
    const keymap = Keymap.use()
    dispatch = keymap.dispatch
    Keymap.createLayer(() => ({
      mode: "global",
      commands: [
        {
          id: "project.cd",
          slash: { name: "cd", arguments: true },
          run: (input) => {
            received.push(input)
          },
        },
      ],
    }))
    return <box />
  }

  const app = await testRender(() => (
    <ConfigProvider config={createTuiResolvedConfig()}>
      <Keymap.Provider>
        <Commands />
      </Keymap.Provider>
    </ConfigProvider>
  ))
  try {
    dispatch!("project.cd")
    dispatch!("project.cd", "")
    dispatch!("project.cd", "src/components with spaces")
    expect(received).toEqual([undefined, "", "src/components with spaces"])
  } finally {
    app.renderer.destroy()
  }
})

test("argumentSlash matches zero-argument command only without trailing text", () => {
  const commands: KeymapCommand[] = [
    {
      id: "test.console",
      slash: { name: "console", aliases: ["con"] },
      run: () => {},
    },
    {
      id: "test.cd",
      slash: { name: "cd", arguments: true },
      run: () => {},
    },
  ]

  // Zero-argument command matches when typed alone
  const exact = argumentSlash("/console", commands)
  expect(exact?.command.id).toBe("test.console")
  expect(exact?.input).toBeUndefined()

  // Zero-argument command alias matches when typed alone
  const alias = argumentSlash("/con", commands)
  expect(alias?.command.id).toBe("test.console")
  expect(alias?.input).toBeUndefined()

  // Zero-argument command does not match with trailing text
  expect(argumentSlash("/console some arguments", commands)).toBeUndefined()
  expect(argumentSlash("/con some arguments", commands)).toBeUndefined()

  // Command with arguments: true matches with trailing text
  const withArgs = argumentSlash("/cd src/test", commands)
  expect(withArgs?.command.id).toBe("test.cd")
  expect(withArgs?.input).toBe("src/test")

  // Command with arguments: true matches without trailing text
  const emptyArgs = argumentSlash("/cd", commands)
  expect(emptyArgs?.command.id).toBe("test.cd")
  expect(emptyArgs?.input).toBe("")
})
