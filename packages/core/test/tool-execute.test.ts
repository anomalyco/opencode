import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { CodeModeTool } from "@opencode/core/codemode/tool"
import { Environment } from "@opencode/core/environment/index"
import { Permission } from "@opencode/core/permission"
import { Tool } from "@opencode/core/tool"
import { execute } from "@opencode/core/tool/runtime"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import type { Info } from "@opencode/schema/tool"
import { Context, Deferred, Effect, Fiber, Schema } from "effect"
import { TestClock } from "effect/testing"
import { codeModeServices } from "./fixture/codemode"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { permissionService } from "./lib/permission"

const context = {
  sessionID: Session.ID.make("ses_execute"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_execute"),
  id: Tool.CallID.make("call_execute"),
  progress: () => Effect.void,
}

const allowAll = permissionService({ assert: () => Effect.void })

const createCodeMode = (
  tools: ReadonlyMap<string, Info>,
  permission = allowAll,
  services?: Context.Context<CodeModeTool.Services>,
) => CodeModeTool.create({ tools }, (_, tool, input, context) => execute(tool, input, context), permission, services)

test("execute takes raw code as freeform text, and Code Mode calls freeform tools with a string", async () => {
  const input = Schema.Struct({ text: Schema.NonEmptyString })
  const send = {
    name: "send",
    description: "Send text",
    input,
    output: Schema.String,
    execute: ({ text }) => Effect.succeed({ output: text }),
  } satisfies Info<typeof input, typeof Schema.String>
  const tools = new Map<string, Info>([
    ["echo", { ...send, name: "echo" }],
    ["send", { ...send, freeform: { type: "text" } }],
  ])
  const codeMode = createCodeMode(tools)
  expect(codeMode.freeform).toEqual({ type: "text" })
  expect(CodeModeTool.catalog({ tools }).tools.map((tool) => "signature" in tool && tool.signature)).toEqual([
    "tools.echo({\n  /** @minLength 1 */\n  text: string,\n}): Promise<string>",
    "tools.send(/** @minLength 1 */ text: string): Promise<string>",
  ])
  const calls = await Effect.runPromise(
    codeMode.execute({ code: 'return [await tools.send("first"), await tools.send({text: "second"})]' }, context),
  )
  expect(JSON.parse(calls.output.output)).toEqual(["first", "second"])
  expect(calls.output.toolCalls.map((call) => call.input)).toEqual([{ text: "first" }, { text: "second" }])
})

test("execute describes invariant Code Mode behavior", () => {
  expect(createCodeMode(new Map()).description).toBe(
    [
      "Run JavaScript in a confined Code Mode runtime to script tool calls and HTTP requests and compose their results.",
      "Write plain JavaScript and send it exactly as written: no code fence, and no JSON or other wrapper around it.",
      "`fetch` is available for HTTP requests. Imports, direct filesystem access, and timers are unavailable: there is no `setTimeout` or sleep. All other external access goes through `tools`.",
      "Inside `execute`, the only callable tools are those explicitly listed in the Code Mode catalog instructions or returned by the `search` function. Ignore tools shown outside the Code Mode catalog. They are not available in the Code Mode runtime.",
      'Call tools through `tools` using only exact paths and signatures from the catalog. Do not infer or normalize tool names; preserve bracket notation such as `tools.<namespace>["tool-name"](input)`.',
      "Prefer an explicit `return`; if omitted, the final top-level expression becomes the result.",
      "Await every call whose completion matters; pending calls are interrupted when execution ends. Run independent calls concurrently with `Promise.allSettled`.",
    ].join("\n"),
  )
})

test("canonical execution distinguishes declared, model-only, and raw schema outputs", async () => {
  const declared: Info = {
    name: "declared",
    description: "Declared",
    input: Schema.Struct({ value: Schema.String }),
    output: Schema.Struct({ value: Schema.String }),
    execute: ({ value }) => Effect.succeed({ output: { value } }),
  }
  const modelOnlyInput = Schema.Struct({})
  const modelOnly = {
    name: "model_only",
    description: "Model only",
    input: modelOnlyInput,
    execute: () => Effect.succeed({ content: "visible only", metadata: { kind: "model" } }),
  } satisfies Info<typeof modelOnlyInput, undefined>
  const raw: Info = {
    name: "raw",
    description: "Raw",
    input: {},
    output: {},
    execute: (input) => Effect.succeed({ output: input, content: "raw" }),
  }

  expect(await Effect.runPromise(execute(declared, { value: "encoded" }, context))).toEqual({
    output: { value: "encoded" },
    content: [{ type: "text", text: '{"value":"encoded"}' }],
  })
  expect(await Effect.runPromise(execute(modelOnly, {}, context))).toEqual({
    output: undefined,
    content: [{ type: "text", text: "visible only" }],
    metadata: { kind: "model" },
  })
  expect(await Effect.runPromise(execute(raw, { unchecked: true }, context))).toEqual({
    output: { unchecked: true },
    content: [{ type: "text", text: "raw" }],
  })
})

test("declared outputs cannot bypass validation and raw outputs stay JSON-compatible", async () => {
  const missing: Info = {
    name: "missing",
    description: "Missing output",
    input: Schema.Struct({}),
    output: Schema.String,
    execute: () => Effect.succeed({ content: "not an output" }),
  }
  const invalid: Info = {
    name: "invalid",
    description: "Invalid raw output",
    input: {},
    output: {},
    execute: () => Effect.succeed({ output: 1n, content: "not JSON" }),
  }

  expect((await Effect.runPromiseExit(execute(missing, {}, context))).toString()).toContain(
    "Tool did not return its declared output",
  )
  expect((await Effect.runPromiseExit(execute(invalid, {}, context))).toString()).toContain(
    "Tool returned a non-JSON value",
  )
})

test("foreign typed failures settle as Tool.Error at the untrusted boundary", async () => {
  class ForeignFailure extends Schema.TaggedError<ForeignFailure>()("Plugin.ForeignFailure", {
    message: Schema.String,
  }) {}
  const lying: Info = {
    name: "lying",
    description: "Fails with a non-Tool.Error typed failure",
    input: Schema.Struct({}),
    execute: () => new ForeignFailure({ message: "transport died" }) as never,
  }

  const error = await Effect.runPromise(execute(lying, {}, context).pipe(Effect.flip))
  expect(error).toBeInstanceOf(Tool.Error)
  expect(error.message).toBe("transport died")
})

test("execute rejects filesystem fetches", async () => {
  const result = await Effect.runPromise(
    createCodeMode(new Map()).execute({ code: 'return await fetch("file:///blocked.txt")' }, context),
  )

  expect(result.output.error).toBe(true)
  expect(result.output.output).toContain("fetch cannot be used for filesystem access.")
})

describe("path", () => {
  const directory = path.resolve("/session/dir")
  const withPath = () => createCodeMode(new Map(), allowAll, codeModeServices(directory))
  const run = async (code: string, codeMode = withPath()) =>
    JSON.parse((await Effect.runPromise(codeMode.execute({ code }, context))).output.output)

  test("without the experimental flag there is no path", async () => {
    expect(await run("return [typeof path]", createCodeMode(new Map()))).toEqual(["undefined"])
  })

  test("path is the host's path module, resolving against the session's directory", async () => {
    expect(
      await run(
        `return [path.resolve("a", "b"), path.relative("a", "c"), path.join("out", "..", "x.txt"), path.basename("/a/b.ts", ".ts"), path.posix.join("a", "b"), path.win32.join("a", "b"), path.sep]`,
      ),
    ).toEqual([path.resolve(directory, "a", "b"), path.join("..", "c"), "x.txt", "b", "a/b", "a\\b", path.sep])
  })

  test("the other platform's flavour resolves from its own root, not the server's working directory", async () => {
    const other = path.sep === "/" ? "win32" : "posix"
    const [resolved] = await run(`return [path.${other}.resolve("a")]`)
    expect(resolved).toBe(path[other].resolve(path[other].sep, "a"))
    expect(resolved).not.toContain(process.cwd())
  })

  test("path is importable by its Node module names", async () => {
    expect(
      await run(`import { join } from "node:path"
        const posix = require("path").posix
        return [join("a", "b"), posix.dirname("a/b")]`),
    ).toEqual([path.join("a", "b"), "a"])
  })
})

describe("Bun", () => {
  const source = { type: "tool" as const, messageID: context.messageID, id: context.id }
  const run = async (directory: string, code: string, permission = allowAll, services = codeModeServices(directory)) =>
    JSON.parse(
      (await Effect.runPromise(createCodeMode(new Map(), permission, services).execute({ code }, context))).output
        .output,
    )
  const deny = (action: string) => ({
    assert: (input: Permission.AssertInput) =>
      input.action === action
        ? Effect.fail(new Permission.BlockedError({ rules: [], permission: input.action, resources: input.resources }))
        : Effect.void,
  })
  // Every permission request, from the execute call's own service and from the session's file services alike.
  const recorded = () => {
    const asked: Array<Permission.AssertInput> = []
    return { asked, assert: (input: Permission.AssertInput) => Effect.sync(() => void asked.push(input)) }
  }

  // The session's services, recording each call the program's file operations make to the environment's files.
  const spied = (directory: string) => {
    const services = codeModeServices(directory)
    const environment = Context.get(services, Environment.Service)
    const calls: Array<ReadonlyArray<unknown>> = []
    const spy = <Args extends ReadonlyArray<unknown>, A>(name: string, run: (...args: Args) => A) => {
      return (...args: Args) => {
        calls.push([name, ...args.map((arg) => (typeof arg === "string" ? path.relative(directory, arg) : arg))])
        return run(...args)
      }
    }
    return {
      calls,
      services: Context.add(
        services,
        Environment.Service,
        Environment.Service.of({
          ...environment,
          files: {
            ...environment.files,
            read: spy("read", environment.files.read),
            list: spy("list", environment.files.list),
            write: spy("write", (file: string, _: Uint8Array) => environment.files.write(file, _)),
            append: spy("append", (file: string, _: Uint8Array) => environment.files.append(file, _)),
          },
        }),
      ),
    }
  }

  test("without the experimental flag there is no Bun", async () => {
    const result = await Effect.runPromise(createCodeMode(new Map()).execute({ code: "return [typeof Bun]" }, context))
    expect(JSON.parse(result.output.output)).toEqual(["undefined"])
  })

  test("Bun.file reads text, JSON and bytes, and knows a file's size, type and whether it exists", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "notes.txt"), "hello world")
    await Bun.write(path.join(tmp.path, "data.json"), '\uFEFF{"a":1}')
    await Bun.write(path.join(tmp.path, "sub", "image.PNG"), new Uint8Array([0xff, 0x00]))
    expect(
      await run(
        tmp.path,
        `const notes = Bun.file("notes.txt")
        const image = Bun.file("sub/image.PNG")
        const bytes = await image.bytes()
        const stat = await notes.stat()
        return [await notes.text(), await Bun.file("data.json").json(), [...bytes], [...await image.arrayBuffer()],
          bytes instanceof Uint8Array, Buffer.isBuffer(bytes), [notes.name, notes.size, notes.type], image.type,
          Bun.file("data.json").type, Bun.file("Makefile").type, Bun.file("Makefile", { type: "text/x-make" }).type,
          notes.lastModified === Math.trunc(stat.mtimeMs), [stat.size, stat.isFile(), stat.isDirectory()],
          await notes.exists(), await Bun.file("sub").exists(), Bun.file("sub").type,
          await Bun.file(${JSON.stringify(pathToFileURL(path.join(tmp.path, "notes.txt")).href)}).text()]`,
      ),
    ).toEqual([
      "hello world",
      { a: 1 },
      [255, 0],
      [255, 0],
      true,
      false,
      ["notes.txt", 11, "text/plain;charset=utf-8"],
      "image/png",
      "application/json;charset=utf-8",
      "application/octet-stream",
      "text/x-make",
      true,
      [11, true, false],
      true,
      false,
      "application/octet-stream",
      "hello world",
    ])
  })

  test("a slice reads only its own bytes, counting negative indexes from the end", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "notes.txt"), "hello world")
    const files = spied(tmp.path)
    expect(
      await run(
        tmp.path,
        `const notes = Bun.file("notes.txt")
        const tail = notes.slice(-5)
        return [await notes.slice(0, 5).text(), await tail.text(), await notes.slice(6).text(),
          await notes.slice(2).slice(1, 3).text(), [...await notes.slice(4, 6).bytes()], await notes.slice(20).text(),
          [tail.size, notes.slice(5, 2).size, notes.slice(-50, 50).size], [tail.name, tail.type],
          notes.slice(0, 5, "text/x-part").type, notes.slice("text/x-all").size]`,
        allowAll,
        files.services,
      ),
    ).toEqual([
      "hello",
      "world",
      "world",
      "lo",
      [111, 32],
      "",
      [5, 0, 11],
      ["notes.txt", "text/plain;charset=utf-8"],
      "text/x-part",
      11,
    ])
    expect(files.calls.filter(([name]) => name === "read")).toEqual([
      ["read", "notes.txt", { offset: 0, length: 5 }],
      ["read", "notes.txt", { offset: 6, length: 5 }],
      ["read", "notes.txt", { offset: 6, length: 5 }],
      ["read", "notes.txt", { offset: 3, length: 2 }],
      ["read", "notes.txt", { offset: 4, length: 2 }],
      ["read", "notes.txt", { offset: 11, length: 0 }],
    ])
  })

  test("a missing file has no size, doesn't exist, and fails to read with a Node-shaped ENOENT", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "bad.json"), "{")
    await fs.mkdir(path.join(tmp.path, "folder"))
    expect(
      await run(
        tmp.path,
        `const missing = Bun.file("missing.txt")
        const failure = async (run) => { try { await run() } catch (e) { return [e.name, e.code, e.syscall, e.path] } }
        let text
        try { await missing.text() } catch (e) { text = [e instanceof Error, e.message, typeof e.errno] }
        return [missing.size, missing.lastModified, await missing.exists(), text,
          await failure(() => missing.json()), await failure(() => missing.slice(0, 2).bytes()),
          await failure(() => missing.stat()), await failure(() => missing.delete()),
          await failure(() => Bun.write("copy.txt", missing)), (await failure(() => Bun.file("bad.json").json()))[0],
          await failure(() => Bun.file("folder").text()), await failure(() => Bun.file("folder").delete()),
          await missing.text().catch((e) => e.code), await Bun.file("bad.json").text().then((text) => text.length)]`,
      ),
    ).toEqual([
      0,
      2 ** 52 - 1,
      false,
      [true, "ENOENT: no such file or directory, open 'missing.txt'", "number"],
      ["Error", "ENOENT", "open", "missing.txt"],
      ["Error", "ENOENT", "open", "missing.txt"],
      ["Error", "ENOENT", "stat", "missing.txt"],
      ["Error", "ENOENT", "unlink", "missing.txt"],
      ["Error", "ENOENT", "open", "missing.txt"],
      "SyntaxError",
      ["Error", "EISDIR", "open", "folder"],
      ["Error", "EISDIR", "unlink", "folder"],
      "ENOENT",
      1,
    ])
    expect((await fs.readdir(tmp.path)).toSorted()).toEqual(["bad.json", "folder"])
  })

  test("Bun.write writes text, bytes, a copy of a file and a response, creating parent directories", async () => {
    await using tmp = await tmpdir()
    await using server = Bun.serve({ port: 0, fetch: () => new Response("downloaded") })
    await Bun.write(path.join(tmp.path, "notes.txt"), "héllo world")
    await Bun.write(path.join(tmp.path, "bom.txt"), "\uFEFFold")
    // A formatter that rewrites every file it's given, so a write that ran it would read back "formatted".
    const formatter = (file: string) => Effect.promise(() => fs.writeFile(file, "formatted")).pipe(Effect.as(true))
    const result = await Effect.runPromise(
      createCodeMode(new Map(), allowAll, codeModeServices(tmp.path, undefined, formatter)).execute(
        {
          code: `const failure = async (run) => { try { await run() } catch (e) { return [e.name, e.code ?? e.message] } }
            const notes = Bun.file("notes.txt")
            return [
              await Bun.write("deep/er/text.ts", "const   x   =1"),
              await Bun.write("bom.txt", "new"),
              await Bun.write("bytes.bin", new Uint8Array([0xff, 0xfe, 0x00])),
              await Bun.write("deep/copy.txt", notes),
              await Bun.write(Bun.file("into.txt"), notes.slice(0, 6)),
              await Bun.file("own.txt").write("own"),
              await Bun.write("page.txt", await fetch(${JSON.stringify(server.url.href)})),
              await Bun.write("number.txt", 5),
              await failure(() => Bun.write("object.txt", { text: "x" })),
              await failure(() => Bun.write({ name: "object.txt" }, "x")),
              await failure(() => Bun.write("deep", "x")),
              await Bun.file("own.txt").delete() ?? null,
              await Bun.file("own.txt").exists(),
            ]`,
        },
        context,
      ),
    )

    expect(JSON.parse(result.output.output)).toEqual([
      14,
      3,
      3,
      12,
      6,
      3,
      10,
      1,
      ["TypeError", "Bun.write expects a string, a Uint8Array, a BunFile, or a Response as the data to write."],
      ["TypeError", "Bun.write expects a path or a BunFile to write to."],
      ["Error", "EISDIR"],
      null,
      false,
    ])
    const written = (name: string) => fs.readFile(path.join(tmp.path, name))
    expect((await written("deep/er/text.ts")).toString()).toBe("const   x   =1")
    expect([...(await written("bom.txt"))]).toEqual([...Buffer.from("new")])
    expect([...(await written("bytes.bin"))]).toEqual([0xff, 0xfe, 0x00])
    expect((await written("deep/copy.txt")).toString()).toBe("héllo world")
    expect((await written("into.txt")).toString()).toBe("héllo")
    expect((await written("page.txt")).toString()).toBe("downloaded")
    expect((await written("number.txt")).toString()).toBe("5")
    expect((await fs.readdir(tmp.path)).toSorted()).toEqual(
      ["bom.txt", "bytes.bin", "deep", "into.txt", "notes.txt", "number.txt", "page.txt"].toSorted(),
    )
    expect(result.output.toolCalls.slice(0, 5)).toEqual([
      { tool: "Bun", status: "completed", input: { method: "file", path: "notes.txt" } },
      { tool: "Bun", status: "completed", input: { method: "write", path: "deep/er/text.ts" } },
      { tool: "Bun", status: "completed", input: { method: "write", path: "bom.txt" } },
      { tool: "Bun", status: "completed", input: { method: "write", path: "bytes.bin" } },
      { tool: "Bun", status: "completed", input: { method: "write", path: "deep/copy.txt", from: "notes.txt" } },
    ])
  })

  test("a writer collects chunks, replaces the file on its first flush and appends on later ones", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "log.txt"), "an older and longer log")
    const files = spied(tmp.path)
    expect(
      await run(
        tmp.path,
        `const log = Bun.file("log.txt")
        const writer = log.writer()
        const counts = [writer.write("one\\n"), writer.write(new Uint8Array([116, 119, 111, 10]))]
        const untouched = await log.text()
        counts.push(writer.flush(), writer.flush(), writer.write("three\\n"), writer.write("four\\n"), await writer.end())
        const eager = Bun.file("eager.txt").writer({ highWaterMark: 4 })
        eager.write("ab")
        const buffered = await Bun.file("eager.txt").exists()
        eager.write("cd")
        const flushed = await Bun.file("eager.txt").text()
        let unsupported, missingParent
        try { Bun.file("x.txt").writer({ closeAfter: true }) } catch (e) { unsupported = [e.name, e.message] }
        try { const lost = Bun.file("none/x.txt").writer(); lost.write("x"); lost.end() } catch (e) { missingParent = e.code }
        return [counts, untouched, [buffered, flushed, eager.end()], unsupported, missingParent]`,
        allowAll,
        files.services,
      ),
    ).toEqual([
      [4, 4, 8, 0, 6, 5, 11],
      "an older and longer log",
      [false, "abcd", 0],
      [
        "TypeError",
        'A file writer does not support the "closeAfter" option in Code Mode. Supported options: highWaterMark.',
      ],
      "ENOENT",
    ])
    expect(await fs.readFile(path.join(tmp.path, "log.txt"), "utf8")).toBe("one\ntwo\nthree\nfour\n")
    expect((await fs.readdir(tmp.path)).toSorted()).toEqual(["eager.txt", "log.txt"])
    expect(files.calls.filter(([name, file]) => (name === "write" || name === "append") && file === "log.txt")).toEqual(
      [
        ["write", "log.txt", Buffer.from("one\ntwo\n")],
        ["append", "log.txt", Buffer.from("three\nfour\n")],
      ],
    )
  })

  test("Bun.Glob scans from a directory for files, with dot files, folders and absolute paths on request", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "src", "a.ts"), "a")
    await Bun.write(path.join(tmp.path, "src", "nested", "b.ts"), "b")
    await Bun.write(path.join(tmp.path, "src", "nested", "c.md"), "c")
    await Bun.write(path.join(tmp.path, "src", ".hidden", "d.ts"), "d")
    const result = await run(
      tmp.path,
      `const scan = (pattern, options) => new Bun.Glob(pattern).scanSync(options).sort()
      const awaited = []
      for await (const file of new Bun.Glob("**/*.ts").scan({ cwd: "src" })) awaited.push(file)
      let unsupported, missing
      try { new Bun.Glob("*").scan({ cwd: "src", followSymlinks: true }) } catch (e) { unsupported = [e.name, e.message] }
      try { new Bun.Glob("*.ts").scan("missing") } catch (e) { missing = [e.code, e.syscall, e.path] }
      const glob = new Bun.Glob("*.ts")
      return [
        awaited.sort(), scan("**/*.ts", "src"), scan("**/*.ts", { cwd: "src", dot: true }), scan("src/*.ts"),
        scan("./src/*.ts"), scan("*", { cwd: "src" }), scan("*", { cwd: "src", onlyFiles: false }),
        scan("*/*.ts", { cwd: "src", absolute: true }), scan("src/**/*.md", { absolute: true }),
        scan("src/a.ts"), scan("src/missing.ts"), scan("missing/*.ts"), scan("src/a.ts/*"), missing,
        [...new Bun.Glob("src/*.ts").scan()],
        scan("**/.hidden/*.ts", "src"), scan("{.hidden,nested}/*.ts", "src"),
        [glob.match("a.ts"), glob.match("nested/a.ts"), glob.match("a.md")], unsupported,
      ]`,
    )
    const nested = path.join("nested", "b.ts")
    const hidden = path.join(".hidden", "d.ts")
    expect(result).toEqual([
      ["a.ts", nested],
      ["a.ts", nested],
      [hidden, "a.ts", nested],
      [path.join("src", "a.ts")],
      [path.join("src", "a.ts")],
      ["a.ts"],
      ["a.ts", "nested"],
      [path.join(tmp.path, "src", "nested", "b.ts")],
      [path.join(tmp.path, "src", "nested", "c.md")],
      ["src/a.ts"],
      [],
      [],
      [],
      ["ENOENT", "scandir", "missing"],
      [path.join("src", "a.ts")],
      [hidden],
      [hidden, nested],
      [true, false, false],
      [
        "TypeError",
        'A Bun.Glob scan does not support the "followSymlinks" option in Code Mode. Supported options: cwd, dot, absolute, onlyFiles.',
      ],
    ])
  })

  test("a scan lists only under the pattern's fixed part, as deep as the pattern reaches, skipping hidden folders", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "src", "a.ts"), "a")
    await Bun.write(path.join(tmp.path, "src", "nested", "deep", "b.ts"), "b")
    await Bun.write(path.join(tmp.path, "src", ".cache", "c.ts"), "c")
    await Bun.write(path.join(tmp.path, "other", "d.ts"), "d")
    const listed = async (pattern: string, options = {}) => {
      const files = spied(tmp.path)
      await run(
        tmp.path,
        `return new Bun.Glob(${JSON.stringify(pattern)}).scanSync(${JSON.stringify(options)})`,
        allowAll,
        files.services,
      )
      return files.calls
        .filter(([name]) => name === "list")
        .map(([, directory]) => String(directory))
        .toSorted()
    }
    const nested = [path.join("src", "nested"), path.join("src", "nested", "deep")]
    expect(await listed("src/*.ts")).toEqual(["src"])
    expect(await listed("src/*/*.ts")).toEqual(["src", path.join("src", "nested")])
    expect(await listed("src/**/*.ts")).toEqual(["src", ...nested])
    expect(await listed("src/**/.cache/*.ts")).toEqual([path.join("src", ".cache"), ...nested, "src"].toSorted())
    expect(await listed("src/**/*.ts", { dot: true })).toEqual(
      [path.join("src", ".cache"), ...nested, "src"].toSorted(),
    )
  })

  test("a denied read surfaces core's permission error from Bun.file and from a scan", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "secret.txt"), "x")
    expect(
      await run(
        tmp.path,
        `const failure = (run) => { try { run() } catch (e) { return [e.name, e.message, e.code ?? null] } }
        return [failure(() => Bun.file("secret.txt")), failure(() => new Bun.Glob("*.txt").scan())]`,
        permissionService(deny("read")),
        codeModeServices(tmp.path, deny("read")),
      ),
    ).toEqual([
      ["Error", "Permission denied: read", null],
      ["Error", "Permission denied: read", null],
    ])
  })

  test("a file asks to be read once, a write asks edit with its diff, and a copy asks edit without one", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "notes.txt"), "old\n")
    const record = recorded()
    await run(
      tmp.path,
      `await Bun.write("notes.txt", "old\\nnew\\n")
      await Bun.write("out/new.txt", "one\\ntwo\\n")
      const notes = Bun.file("notes.txt")
      await notes.text()
      await notes.slice(0, 3).bytes()
      await notes.exists()
      await Bun.write("out/copy.txt", notes)
      await notes.write("changed\\n")
      const writer = notes.writer()
      writer.write("first\\n")
      writer.flush()
      writer.write("second\\n")
      writer.end()
      await notes.delete()
      new Bun.Glob("out/*.txt").scanSync()
      return []`,
      permissionService(record),
      codeModeServices(tmp.path, record),
    )
    expect(record.asked.map((input) => [input.action, input.resources, input.sessionID, input.source])).toEqual([
      ["edit", ["notes.txt"], context.sessionID, source],
      ["edit", ["out/new.txt"], context.sessionID, source],
      ["read", ["notes.txt"], context.sessionID, source],
      ["edit", ["out/copy.txt"], context.sessionID, source],
      ["edit", ["notes.txt"], context.sessionID, source],
      ["edit", ["notes.txt"], context.sessionID, source],
      ["edit", ["notes.txt"], context.sessionID, source],
      ["edit", ["notes.txt"], context.sessionID, source],
      ["read", ["out"], context.sessionID, source],
    ])
    const diffs = record.asked.map((input) => input.metadata?.files)
    expect(diffs[0]).toMatchObject([{ file: "notes.txt", status: "modified", additions: 1, deletions: 0 }])
    expect(diffs[1]).toMatchObject([{ file: "out/new.txt", status: "added", additions: 2 }])
    expect(diffs[3]).toBeUndefined()
    expect(diffs[5]).toMatchObject([{ file: "notes.txt", status: "modified", additions: 1, deletions: 1 }])
    // An append shows only the lines it adds.
    expect(diffs[6]).toMatchObject([{ file: "notes.txt", status: "modified", additions: 1, deletions: 0 }])
    expect(diffs[7]).toBeUndefined()
  })

  test("a file outside the project asks for its directory once, when Bun.file names it", async () => {
    await using tmp = await tmpdir()
    await using outside = await tmpdir()
    const file = path.join(outside.path, "notes.txt")
    await Bun.write(file, "outside")
    const record = recorded()
    expect(
      await run(
        tmp.path,
        `const notes = Bun.file(${JSON.stringify(file)})
        const text = await notes.text()
        await notes.write(text + " again")
        return [text, await notes.text()]`,
        permissionService(record),
        codeModeServices(tmp.path, record),
      ),
    ).toEqual(["outside", "outside again"])
    const resource = file.replaceAll("\\", "/")
    expect(record.asked.map((input) => [input.action, input.resources])).toEqual([
      ["external_directory", [path.posix.join(path.posix.dirname(resource), "*")]],
      ["read", [resource]],
      ["edit", [resource]],
    ])
  })

  test("a denied edit writes nothing: Bun.write and delete reject, and a writer's flush throws", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "keep.txt"), "keep")
    expect(
      await run(
        tmp.path,
        `const keep = Bun.file("keep.txt")
        const settled = await Promise.allSettled([Bun.write("new/a.txt", "x"), Bun.write("copy.txt", keep),
          keep.write("changed"), keep.delete()])
        const writer = Bun.file("b.txt").writer()
        writer.write("x")
        let thrown
        try { writer.end() } catch (e) { thrown = e.message }
        return [settled.map((item) => item.reason?.message), thrown, await keep.text()]`,
        permissionService(deny("edit")),
        codeModeServices(tmp.path, deny("edit")),
      ),
    ).toEqual([Array(4).fill("Permission denied: edit"), "Permission denied: edit", "keep"])
    expect(await fs.readdir(tmp.path)).toEqual(["keep.txt"])
  })
})

describe("execute output", () => {
  const run = async (code: string) =>
    (await Effect.runPromise(createCodeMode(new Map()).execute({ code }, context))).output.output

  test("a program that only logs shows just its logs", async () => {
    expect(await run('console.log("found", 12, "files")')).toBe("Logs:\nfound 12 files")
  })

  test("a program that only warns shows just its warnings", async () => {
    expect(await run('const rejected = Promise.reject(new Error("boom"))')).toBe(
      "Warnings:\n- [ExecutionFailure] Unhandled rejection from an un-awaited promise: Error: boom",
    )
  })

  test("a null result with nothing else still shows null", async () => {
    expect(await run("return null")).toBe("null")
  })

  test("a returned value keeps its line before the logs", async () => {
    expect(await run('console.log("hi"); return { n: 1 }')).toBe('{"n":1}\n\nLogs:\nhi')
  })
})

describe("streaming fetch", () => {
  const run = (url: URL, code: string, permission = allowAll) =>
    createCodeMode(new Map(), permission).execute(
      { code: `const res = await fetch(${JSON.stringify(url.href)}); ${code}` },
      context,
    )

  // Stays open after the first chunk so buffering would block until the test times out.
  const openBody = (cancel: () => void) =>
    new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.of(42))
      },
      cancel,
    })

  test.each([
    ["return with a live reader", "const reader = res.body.getReader(); return (await reader.read()).value[0]"],
    [
      "reader cancellation",
      "const reader = res.body.getReader(); const chunk = await reader.read(); await reader.cancel(); return chunk.value[0]",
    ],
    [
      "break from async iteration",
      "let first; for await (const chunk of res.body) { first = chunk[0]; break } return res.body.locked ? 'locked' : first",
    ],
  ])("reads the first chunk before EOF: %s", async (_, code) => {
    const closed = Promise.withResolvers<void>()
    await using server = Bun.serve({
      port: 0,
      fetch: () => new Response(openBody(closed.resolve)),
    })
    const result = await Effect.runPromise(run(server.url, code))
    expect(result.output.output).toBe("42")
    await closed.promise
  })

  test("interrupting execute aborts a pending request", async () => {
    const started = Promise.withResolvers<void>()
    const closed = Promise.withResolvers<void>()
    await using server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        req.signal.addEventListener("abort", () => closed.resolve(), { once: true })
        started.resolve()
        await closed.promise
        return new Response(null)
      },
    })
    const fiber = Effect.runFork(run(server.url, "return res.status"))
    await started.promise
    await Effect.runPromise(Fiber.interrupt(fiber))
    await closed.promise
  })

  test("whole-body methods share consumption and expose Bun's empty body", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: (req) => (req.method === "HEAD" ? new Response(null) : Response.json(42)),
    })
    const result = await Effect.runPromise(
      run(
        server.url,
        `
      const before = res.bodyUsed
      const number = await res.json()
      const second = await res.text().catch(e => e.name)
      const bytes = await (await fetch(res.url)).bytes()
      const buffer = await (await fetch(res.url)).arrayBuffer()
      const empty = await fetch(res.url, { method: "HEAD" })
      return [res.headers.get("Content-Type"), before, number, res.bodyUsed, second, [...bytes], [...buffer], empty.body === null]
    `,
      ),
    )
    expect(JSON.parse(result.output.output)).toEqual([
      "application/json;charset=utf-8",
      false,
      42,
      true,
      "TypeError",
      [52, 50],
      [52, 50],
      true,
    ])
  })

  test("discards a redirect body before reading the destination", async () => {
    const discarded = Promise.withResolvers<void>()
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        if (new URL(req.url).pathname === "/")
          return new Response(openBody(discarded.resolve), { status: 302, headers: { location: "/next" } })
        await discarded.promise
        return new Response("ok")
      },
    })
    const result = await Effect.runPromise(
      run(
        server.url,
        `
      const reader = res.body.getReader()
      const first = await reader.read()
      const end = await reader.read()
      reader.releaseLock()
      return [res.redirected, [...first.value], end.done, res.body.locked, await res.text().catch(e => e.name)]
    `,
        permissionService({ assert: () => Effect.void, assertNotDenied: () => Effect.void }),
      ),
    )
    expect(JSON.parse(result.output.output)).toEqual([true, [111, 107], true, false, "TypeError"])
  })
})

describe("fetch permissions", () => {
  const hits: Array<string> = []
  let server: ReturnType<typeof Bun.serve>
  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch: (request) => {
        const url = new URL(request.url)
        hits.push(`${request.method} ${url.pathname}`)
        if (url.pathname === "/redirect") return Response.redirect(`${url.origin}/blocked`, 302)
        return new Response("ok")
      },
    })
  })
  afterAll(() => server.stop(true))

  test("fetch asks the webfetch permission for its URL as the execute call", async () => {
    hits.length = 0
    const asked: Array<Permission.AssertInput> = []
    const url = `${server.url.origin}/allowed`
    const result = await Effect.runPromise(
      createCodeMode(
        new Map(),
        permissionService({ assert: (input) => Effect.sync(() => void asked.push(input)) }),
      ).execute({ code: `return await (await fetch("${url}", { method: "POST" })).text()` }, context),
    )

    expect(result.output.output).toBe("ok")
    expect(hits).toEqual(["POST /allowed"])
    expect(asked).toEqual([
      {
        action: "webfetch",
        resources: [url],
        save: ["*"],
        metadata: { method: "POST", url },
        sessionID: context.sessionID,
        agent: context.agent,
        source: { type: "tool", messageID: context.messageID, id: context.id },
      },
    ])
  })

  test("a redirect to a URL denied for webfetch is never requested", async () => {
    hits.length = 0
    const denied = permissionService({
      assert: () => Effect.void,
      assertNotDenied: (input) =>
        Effect.fail(new Permission.BlockedError({ rules: [], permission: input.action, resources: input.resources })),
    })
    const result = await Effect.runPromise(
      createCodeMode(new Map(), denied).execute(
        { code: `try { await fetch("${server.url.origin}/redirect") } catch (e) { return e.message }` },
        context,
      ),
    )

    expect(result.output.output).toContain("Permission denied")
    expect(hits).toEqual(["GET /redirect"])
  })

  test("fetch matches rules without the fragment and rejects credentials in the URL", async () => {
    hits.length = 0
    const asked: Array<ReadonlyArray<string>> = []
    const result = await Effect.runPromise(
      createCodeMode(
        new Map(),
        permissionService({ assert: (input) => Effect.sync(() => void asked.push(input.resources)) }),
      ).execute(
        {
          code: `await fetch("${server.url.origin}/allowed#top"); try { await fetch("${server.url.protocol}//user@${server.url.host}/") } catch (e) { return e.message }`,
        },
        context,
      ),
    )

    expect(result.output.output).toBe("fetch cannot be used with credentials in the URL.")
    expect(asked).toEqual([[`${server.url.origin}/allowed`]])
    expect(hits).toEqual(["GET /allowed"])
  })

  test("a rejection with feedback reaches the program as the error message", async () => {
    hits.length = 0
    const url = `${server.url.origin}/corrected`
    const corrected = permissionService({
      assert: () => Effect.fail(new Permission.CorrectedError({ feedback: "use the docs site instead" })),
    })
    const result = await Effect.runPromise(
      createCodeMode(new Map(), corrected).execute(
        { code: `try { await fetch("${url}") } catch (e) { return e.message }` },
        context,
      ),
    )

    expect(result.output.output).toBe(`The user rejected fetching ${url}: use the docs site instead`)
    expect(hits).toEqual([])
  })

  test("a URL denied for webfetch is never requested and rejects like a failed fetch", async () => {
    hits.length = 0
    const url = `${server.url.origin}/denied`
    const denied = permissionService({
      assert: (input) =>
        Effect.fail(new Permission.BlockedError({ rules: [], permission: input.action, resources: input.resources })),
    })
    const result = await Effect.runPromise(
      createCodeMode(new Map(), denied).execute(
        { code: `const [denied] = await Promise.allSettled([fetch("${url}")]); return denied.status` },
        context,
      ),
    )

    expect(result.output.output).toBe("rejected")
    expect(hits).toEqual([])
  })
})

test("execute supports callable namespace tools", async () => {
  const callable: Info = {
    name: "admin",
    description: "Administer Slack",
    input: Schema.Struct({}),
    output: Schema.String,
    options: { namespace: "slack" },
    execute: () => Effect.succeed({ output: "admin" }),
  }
  const child: Info = {
    name: "create",
    description: "Create a Slack resource",
    input: Schema.Struct({}),
    output: Schema.String,
    options: { namespace: "slack.admin" },
    execute: () => Effect.succeed({ output: "created" }),
  }
  const codeMode = createCodeMode(
    new Map([
      ["slack_admin", callable],
      ["slack_admin_create", child],
    ]),
  )
  const result = await Effect.runPromise(
    codeMode.execute({ code: "return [await tools.slack.admin({}), await tools.slack.admin.create({})]" }, context),
  )

  expect(result.metadata).toEqual({
    toolCalls: [
      { tool: "slack.admin", status: "completed" },
      { tool: "slack.admin.create", status: "completed" },
    ],
  })
  expect(result.content).toEqual([{ type: "text", text: '["admin","created"]' }])
})

test("each call in a program gets its own ID and is marked as nested in execute", async () => {
  const ids: string[] = []
  const nested: Array<[string, string]> = []
  const input = Schema.Struct({})
  const record = {
    name: "record",
    description: "Record the call",
    input,
    execute: (_, context) => Effect.sync(() => ids.push(context.id)).pipe(Effect.as({ content: "ok" })),
  } satisfies Info<typeof input>
  await Effect.runPromise(
    createCodeMode(
      new Map<string, Info>([["record", record]]),
      permissionService({
        nested: (call, parent) => Effect.sync(() => void nested.push([call, parent])),
      }),
    ).execute({ code: "await Promise.all([tools.record({}), tools.record({})])" }, context),
  )
  expect(new Set(ids).size).toBe(2)
  expect(ids).not.toContain(context.id)
  expect(nested.toSorted()).toEqual(ids.toSorted().map((id) => [id, context.id]))
})

test("executions share the prepared runtime of an inventory while keeping per-call state", async () => {
  let conversions = 0
  const echo: Info = {
    name: "echo",
    description: "Echo a value",
    input: {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (value: unknown) => ({ value }),
        jsonSchema: {
          input: () => {
            conversions++
            return { type: "object", properties: { value: { type: "string" } }, required: ["value"] }
          },
          output: () => ({}),
        },
      },
    },
    execute: (input) => Effect.succeed({ content: (input as { value: string }).value }),
  }
  const inventory = { tools: new Map([["echo", echo]]) }
  const codeMode = CodeModeTool.create(inventory, (_, tool, input, context) => execute(tool, input, context), allowAll)
  const run = (id: string) => {
    const progress: Array<Tool.Metadata> = []
    return CodeModeTool.create(inventory, (_, tool, input, context) => execute(tool, input, context), allowAll)
      .execute(
        { code: `return await tools.echo({ value: "${id}" })` },
        { ...context, id: Tool.CallID.make(id), progress: (update) => Effect.sync(() => progress.push(update)) },
      )
      .pipe(Effect.map((result) => ({ output: result.output.output, progress })))
  }

  const results = await Effect.runPromise(
    Effect.all([run("first"), run("second")], { concurrency: "unbounded" }).pipe(Effect.provide(TestClock.layer())),
  )
  expect(CodeModeTool.catalog(inventory).tools).toHaveLength(1)
  expect<unknown>(results).toEqual(
    ["first", "second"].map((id) => ({
      output: id,
      progress: [{ toolCalls: [{ tool: "echo", status: "running", input: { value: id } }] }],
    })),
  )
  expect(
    (await Effect.runPromise(codeMode.execute({ code: 'return await tools.echo({ value: "x" })' }, context))).output
      .output,
  ).toBe("x")
  expect(conversions).toBe(1)

  await Effect.runPromise(
    createCodeMode(new Map(inventory.tools)).execute({ code: 'return await tools.echo({ value: "next" })' }, context),
  )
  expect(conversions).toBe(2)
})

const progressCodeMode = (started: Deferred.Deferred<void>, wait: Effect.Effect<void>) =>
  createCodeMode(
    new Map<string, Info>([
      [
        "step",
        {
          name: "step",
          description: "Step",
          input: Schema.Struct({}),
          output: Schema.String,
          execute: () => Effect.succeed({ output: "ok" }),
        },
      ],
      [
        "wait",
        {
          name: "wait",
          description: "Wait",
          input: Schema.Struct({}),
          output: Schema.String,
          execute: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(wait), Effect.as({ output: "ok" })),
        },
      ],
    ]),
  )

const row = (tool: string, status: string) => ({ tool, status })

it.effect("execute sends at most one progress update per 100 ms with the latest rows", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>()
    const progress: Array<Tool.Metadata> = []
    const fiber = yield* progressCodeMode(started, Effect.sleep("250 millis"))
      .execute(
        {
          code: "for (const i of [1, 2, 3]) await tools.step({}); await tools.wait({}); return await tools.step({})",
        },
        { ...context, progress: (update) => Effect.sync(() => progress.push(update)) },
      )
      .pipe(Effect.forkChild({ startImmediately: true }))
    yield* Deferred.await(started)
    yield* Effect.yieldNow
    expect(progress).toEqual([{ toolCalls: [row("step", "running")] }])

    yield* TestClock.adjust("100 millis")
    const steps = [row("step", "completed"), row("step", "completed"), row("step", "completed")]
    expect(progress.slice(1)).toEqual([{ toolCalls: [...steps, row("wait", "running")] }])

    // The wait ends 150 ms after the trailing update, so its row goes out at once; the last step's never does.
    yield* TestClock.adjust("150 millis")
    const result = yield* Fiber.join(fiber)
    yield* TestClock.adjust("1 second")
    expect(progress.slice(2)).toEqual([{ toolCalls: [...steps, row("wait", "completed")] }])
    expect(result.metadata).toEqual({ toolCalls: [...steps, row("wait", "completed"), row("step", "completed")] })
  }),
)

it.effect("interrupted execute sends its latest progress rows before it settles", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>()
    const progress: Array<Tool.Metadata> = []
    const fiber = yield* progressCodeMode(started, Effect.never)
      .execute(
        { code: "await tools.step({}); await tools.step({}); return await tools.wait({})" },
        { ...context, progress: (update) => Effect.sync(() => progress.push(update)) },
      )
      .pipe(Effect.forkChild({ startImmediately: true }))
    yield* Deferred.await(started)
    yield* Fiber.interrupt(fiber)
    yield* TestClock.adjust("1 second")
    expect(progress).toEqual([
      { toolCalls: [row("step", "running")] },
      { toolCalls: [row("step", "completed"), row("step", "completed"), row("wait", "error")] },
    ])
  }),
)
