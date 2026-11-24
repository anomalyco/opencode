import { NodeServices } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Console, Effect, Option, Stdio } from "effect"
import { Commands, Server } from "../src/commands/commands"
import { Runtime } from "../src/framework/runtime"

test("login is hidden from root help but has the same help as auth login", async () => {
  const [root, login, auth] = await Promise.all([
    run(["--help"]),
    run(["login", "--help"]),
    run(["auth", "login", "--help"]),
  ])

  expect(root.help).toMatch(/^\s+auth\s/m)
  expect(root.help).not.toMatch(/^\s+login\s/m)
  expect(login.help).toContain("opencode login [flags] [<target>]")
  expect(sections(login.help)).toEqual(sections(auth.help))
})

test("login parses into the same input as auth login", async () => {
  const url = "http://127.0.0.1:4096"
  const args = ["openai", "--method", "api", "--answer", "key=value", "--server", url]
  const [login, auth] = await Promise.all([run(["login", ...args]), run(["auth", "login", ...args])])
  const parsed = {
    input: { target: Option.some("openai"), method: Option.some("api"), answer: ["key=value"] },
    server: Option.some(url),
  }

  expect(login.calls).toEqual([{ command: "login", ...parsed }])
  expect(auth.calls).toEqual([{ command: "auth login", ...parsed }])
})

function sections(help: string) {
  return help.slice(help.indexOf("ARGUMENTS"))
}

async function run(args: ReadonlyArray<string>) {
  const pages: string[] = []
  const calls: Array<{ command: string; input: unknown; server: unknown }> = []
  const capture = (command: string) => async () => ({
    default: (input: unknown) =>
      Effect.gen(function* () {
        calls.push({ command, input, server: yield* Effect.serviceOption(Server).pipe(Effect.map(Option.flatten)) })
      }),
  })
  await Effect.runPromise(
    Runtime.run(
      Commands,
      [
        { spec: Commands.commands.login.spec, load: capture("login") },
        { spec: Commands.commands.auth.commands.login.spec, load: capture("auth login") },
      ],
      { version: "test" },
    ).pipe(
      Effect.provideService(
        Console.Console,
        Object.assign(Object.create(console), { log: (page: string) => pages.push(page) }),
      ),
      Effect.provide(Stdio.layerTest({ args: Effect.succeed(args) })),
      Effect.provide(NodeServices.layer),
    ),
  )
  return { help: pages.join("\n"), calls }
}
