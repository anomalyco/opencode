import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { CodeModeDiffs } from "@opencode/core/codemode/diffs"
import { CodeModeApi } from "@opencode/core/codemode/api"
import { CodeModeTool } from "@opencode/core/codemode/tool"
import { ai, LanguageModel } from "@opencode/ai/effect"
import { OpenAI } from "@opencode/ai/providers"
import { compileRequest } from "@opencode/ai/testing"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { Permission } from "@opencode/core/permission"
import { Tool } from "@opencode/core/tool"
import { definition, execute } from "@opencode/core/tool/runtime"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import type { Info } from "@opencode/schema/tool"
import { Context, Deferred, Effect, Fiber, Schema } from "effect"
import { TestClock } from "effect/testing"
import { codeModeServices } from "./fixture/codemode"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { permissionService } from "./lib/permission"
import { noToolCalls } from "./lib/tool"

const context = {
  sessionID: Session.ID.make("ses_execute"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_execute"),
  id: Tool.CallID.make("call_execute"),
  progress: () => Effect.void,
  tool: noToolCalls,
}

const allowAll = permissionService({ assert: () => Effect.void })

const createCodeMode = (
  tools: ReadonlyMap<string, Info>,
  permission = allowAll,
  services?: Context.Context<CodeModeTool.Services>,
  api?: Context.Context<CodeModeTool.Api>,
) =>
  CodeModeTool.create({ tools }, (_, tool, input, context) => execute(tool, input, context), permission, services, api)

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
  expect(codeMode.freeform).toEqual({ type: "text", field: "code" })
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

test("execute rows cap long input strings, and cut them to a preview once a script's rows hold 1M chars", async () => {
  const input = Schema.Struct({ text: Schema.String })
  const received: Array<number> = []
  const echo = {
    name: "echo",
    description: "Echo text",
    input,
    output: Schema.String,
    execute: ({ text }) => Effect.sync(() => received.push(text.length)).pipe(Effect.as({ output: "ok" })),
  } satisfies Info<typeof input, typeof Schema.String>
  const result = await Effect.runPromise(
    createCodeMode(new Map([["echo", echo]])).execute(
      {
        code: 'for (let i = 0; i < 64; i++) await tools.echo({ text: "x".repeat(20000) })\nawait tools.echo({ text: "short" })',
      },
      context,
    ),
  )
  const texts = result.output.toolCalls.map((call) => call.input?.text)
  expect(received).toEqual([...Array(64).fill(20000), 5])
  expect(texts[0]).toBe(`${"x".repeat(16000)}… [4000 more chars]`)
  expect(texts[62]).toBe(texts[0])
  expect(texts[63]).toBe(`${"x".repeat(200)}… [19800 more chars]`)
  expect(texts[64]).toBe("short")
  expect(result.metadata).toEqual({ toolCalls: result.output.toolCalls })
})

test("with full_codemode, raw-text models set execute's timeout and background on a first line", async () => {
  const base = OpenAI.model("gpt-5.4", { apiKey: "test" })
  const model = LanguageModel.update(base, {
    capabilities: { ...base.capabilities, tools: { ...base.capabilities?.tools, freeform: ["text", "lark", "regex"] } },
  })
  const codeMode = createCodeMode(new Map(), allowAll, codeModeServices(process.cwd()))
  const prepared = await Effect.runPromise(
    compileRequest(
      ai.request({
        model,
        prompt: "Run it.",
        tools: [definition(codeMode)],
      }),
    ),
  )
  const [tool] = prepared.body.tools
  expect(tool).toMatchObject({ type: "custom", name: "execute", format: { type: "grammar", syntax: "lark" } })
  expect(tool.description).toContain(
    "To set the parameters below, start with a `// @options:` line holding a JSON object of them",
  )
  expect(tool.format.definition).toContain('ff_pair: "\\"timeout\\"" " "* ":" " "* /[1-9][0-9]*/')
  expect(tool.format.definition).toContain('| "\\"background\\"" " "* ":" " "* ("true" | "false")')
  // Without `full_codemode` the code is the only parameter, and goes out as plain text.
  const plain = await Effect.runPromise(
    compileRequest(
      ai.request({
        model,
        prompt: "Run it.",
        tools: [definition(createCodeMode(new Map()))],
      }),
    ),
  )
  expect(plain.body.tools[0]).toMatchObject({ type: "custom", name: "execute", format: { type: "text" } })
})

test("with full_codemode, execute names Bun's file APIs instead of ruling out filesystem access", () => {
  const description = createCodeMode(new Map(), allowAll, codeModeServices(process.cwd())).description
  expect(description).toContain(
    "`fetch` is available for HTTP requests, and Bun's file APIs (`Bun.file`, `Bun.write`, `Bun.Glob`) for files, in place of Node's `fs`. Imports and timers are unavailable: there is no `setTimeout` or sleep. All other external access goes through `tools`.",
  )
  expect(description).not.toContain("direct filesystem access")
  expect(description.split("\n")[0]).toBe(
    "Run JavaScript in a confined Code Mode runtime to work with files and data, script tool calls and HTTP requests, and compose their results.",
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

test("a plugin result that is not an object settles as Tool.Error instead of throwing", async () => {
  // JavaScript plugins resolve to whatever their function returns, so `undefined` and bare values reach
  // this boundary. The `in` checks that read the result must not see them.
  const nothing: Info = {
    name: "nothing",
    description: "Returns nothing",
    input: Schema.Struct({}),
    execute: () => Effect.succeed(undefined as never),
  }
  const bare: Info = {
    name: "bare",
    description: "Returns a bare string",
    input: Schema.Struct({}),
    output: Schema.String,
    execute: () => Effect.succeed("bare" as never),
  }

  const errors = await Effect.runPromise(
    Effect.forEach([nothing, bare], (tool) => execute(tool, {}, context).pipe(Effect.flip)),
  )
  for (const error of errors) {
    expect(error).toBeInstanceOf(Tool.Error)
    expect(error.message).toContain("Tool did not return a result object")
  }
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

  test("Bun and the bun module exist only with the experimental flag", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "notes.txt"), "hello")
    const code = `import { file } from "bun"
      return [await file("notes.txt").text(), require("bun") === Bun]`
    expect(await run(tmp.path, code)).toEqual(["hello", true])
    const without = await Effect.runPromise(createCodeMode(new Map()).execute({ code }, context))
    expect(without.output.output).toContain('Cannot import "bun"')
  })

  test("Bun.file reads a file, a slice of it, and fails on a missing one with a Node-shaped error", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "notes.txt"), "hello world")
    await Bun.write(path.join(tmp.path, "data.json"), '{"a":1}')
    expect(
      await run(
        tmp.path,
        `const notes = Bun.file("notes.txt")
        const missing = Bun.file("missing.txt")
        let error
        try { await missing.text() } catch (e) { error = [e.code, e.syscall, e.path] }
        return [await notes.text(), await Bun.file("data.json").json(), [...await notes.slice(0, 5).bytes()],
          await notes.slice(-5).text(), [notes.size, notes.type], await missing.exists(), error]`,
      ),
    ).toEqual([
      "hello world",
      { a: 1 },
      [104, 101, 108, 108, 111],
      "world",
      [11, "text/plain;charset=utf-8"],
      false,
      ["ENOENT", "open", "missing.txt"],
    ])
  })

  test("Bun.write writes text, bytes and copies, and a writer replaces then appends", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "notes.txt"), "hello")
    expect(
      await run(
        tmp.path,
        `const failure = async (run) => { try { await run() } catch (e) { return e.code ?? e.message } }
        const log = Bun.file("log.txt").writer()
        log.write("one\\n")
        log.flush()
        log.write("two\\n")
        log.end()
        return [
          await Bun.write("deep/text.txt", "text"),
          await Bun.write("bytes.bin", new Uint8Array([0xff, 0x00])),
          await Bun.write("copy.txt", Bun.file("notes.txt")),
          await failure(() => Bun.write("missing/x.txt", "x", { createPath: false })),
          await failure(() => Bun.write("mode.txt", "x", { mode: 0o755 })),
          await Bun.file("log.txt").text(),
        ]`,
      ),
    ).toEqual([
      4,
      2,
      5,
      "ENOENT",
      'Bun.write does not support the "mode" option in Code Mode. Supported options: createPath.',
      "one\ntwo\n",
    ])
    expect((await fs.readdir(tmp.path)).toSorted()).toEqual(
      ["bytes.bin", "copy.txt", "deep", "log.txt", "notes.txt"].toSorted(),
    )
  })

  test("Bun.file, Bun.write and Bun.Glob show as read, write and glob calls", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "notes.txt"), "hello")
    const result = await Effect.runPromise(
      createCodeMode(new Map(), allowAll, codeModeServices(tmp.path)).execute(
        {
          code: `await Bun.file("notes.txt").text()
          await Bun.write("copy.txt", Bun.file("notes.txt"))
          await Bun.write("new.txt", "text")
          new Bun.Glob("*.txt")`,
        },
        context,
      ),
    )
    expect(result.output.toolCalls).toEqual([
      { tool: "read", status: "completed", input: { path: "notes.txt" } },
      { tool: "read", status: "completed", input: { path: "notes.txt" } },
      { tool: "write", status: "completed", input: { path: "copy.txt", from: "notes.txt" } },
      { tool: "write", status: "completed", input: { path: "new.txt" } },
      { tool: "glob", status: "completed", input: { pattern: "*.txt" } },
    ])
  })

  test("Bun.Glob scans for files, with dot files, folders and absolute paths on request", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "src", "a.ts"), "a")
    await Bun.write(path.join(tmp.path, "src", "nested", "b.ts"), "b")
    await Bun.write(path.join(tmp.path, "src", ".hidden", "c.ts"), "c")
    const nested = path.join("nested", "b.ts")
    expect(
      await run(
        tmp.path,
        `const scan = (pattern, options) => new Bun.Glob(pattern).scanSync(options).sort()
        let unsupported
        try { new Bun.Glob("*").scan({ followSymlinks: true }) } catch (e) { unsupported = e.name }
        return [scan("**/*.ts", "src"), scan("**/*.ts", { cwd: "src", dot: true }), scan("*", { cwd: "src", onlyFiles: false }),
          scan("src/*.ts", { absolute: true }), new Bun.Glob("*.ts").match("a.ts"), unsupported]`,
      ),
    ).toEqual([
      ["a.ts", nested],
      [path.join(".hidden", "c.ts"), "a.ts", nested],
      ["a.ts", "nested"],
      [path.join(tmp.path, "src", "a.ts")],
      true,
      "TypeError",
    ])
  })

  test("Bun asks the permissions the file tools ask", async () => {
    await using tmp = await tmpdir()
    await using outside = await tmpdir()
    await Bun.write(path.join(tmp.path, "notes.txt"), "old\n")
    const file = path.join(outside.path, "far.txt")
    await Bun.write(file, "far")
    const asked: Array<Permission.AssertInput> = []
    const record = { assert: (input: Permission.AssertInput) => Effect.sync(() => void asked.push(input)) }
    await run(
      tmp.path,
      `const notes = Bun.file("notes.txt")
      await notes.text()
      await notes.text()
      await Bun.write("notes.txt", "old\\nnew\\n")
      await Bun.file(${JSON.stringify(file)}).text()
      new Bun.Glob("*.txt").scanSync()
      return []`,
      permissionService(record),
      codeModeServices(tmp.path, record),
    )
    const resource = file.replaceAll("\\", "/")
    expect(asked.map((input) => [input.action, input.resources])).toEqual([
      ["read", ["notes.txt"]],
      ["edit", ["notes.txt"]],
      ["external_directory", [path.posix.join(path.posix.dirname(resource), "*")]],
      ["read", [resource]],
      ["read", ["."]],
    ])
    expect(asked[1]?.metadata?.files).toMatchObject([{ file: "notes.txt", status: "modified", additions: 1 }])
  })

  test("a script's changes are recorded one per change, from diffs the write paths already build", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "notes.txt"), "old\n")
    await Bun.write(path.join(tmp.path, "gone.txt"), "bye\n")
    const reads: string[] = []
    const services = codeModeServices(tmp.path, undefined, undefined, (files) => ({
      read: (file, range) => {
        reads.push(path.relative(tmp.path, file))
        return files.read(file, range)
      },
    }))
    const result = await Effect.runPromise(
      createCodeMode(new Map(), allowAll, services).execute(
        {
          code: `await Bun.write("notes.txt", "old\\nnew\\n")
          await Bun.write("notes.txt", "newer\\n")
          await Bun.write("created.txt", "a\\nb\\n")
          const log = Bun.file("log.txt").writer()
          log.write("one\\n")
          await log.flush()
          log.write("two\\nthree\\n")
          await log.end()
          await Bun.file("gone.txt").delete()
          return []`,
        },
        context,
      ),
    )
    expect(
      (result.metadata?.files as Array<{ file: string; status: string; additions?: number; patch?: string }>).map(
        ({ file, status, additions, patch }) => [file, status, additions, patch !== undefined],
      ),
    ).toEqual([
      ["notes.txt", "modified", 1, true],
      ["notes.txt", "modified", 1, true],
      ["created.txt", "added", 2, true],
      ["log.txt", "added", 1, true],
      ["log.txt", "modified", 2, false],
      ["gone.txt", "deleted", undefined, false],
    ])
    // Only the permission request's own diff reads a file it overwrites; nothing reads to record a change.
    expect(reads).toEqual(["notes.txt", "notes.txt"])
  })

  test("a namespaced tool named like a file tool records no changes", async () => {
    const tool = (name: string, namespace?: string): Info => ({
      name,
      description: "Looks like a file tool",
      input: Schema.Struct({ path: Schema.String, content: Schema.String }),
      output: Schema.String,
      ...(namespace ? { options: { namespace } } : {}),
      execute: ({ path }) =>
        Effect.succeed({
          output: `Created file successfully: ${path}`,
          metadata: { files: [{ file: path, status: "added", additions: 1, deletions: 0, patch: "+x" }] },
        }),
    })
    const result = await Effect.runPromise(
      createCodeMode(new Map([["notes_write", tool("write", "notes")]])).execute(
        { code: 'await tools.notes.write({ path: "n.md", content: "x" })\nreturn []' },
        context,
      ),
    )
    expect(result.metadata?.files).toBeUndefined()
  })

  test("progress carries the changes made so far, capped, and a failed script keeps them", async () => {
    await using tmp = await tmpdir()
    const pause: Info = {
      name: "pause",
      description: "Pause",
      input: Schema.Struct({}),
      output: Schema.String,
      execute: () => Effect.sleep("150 millis").pipe(Effect.as({ output: "ok" })),
    }
    const progress: Array<Tool.Metadata> = []
    const result = await Effect.runPromise(
      createCodeMode(new Map([["pause", pause]]), allowAll, codeModeServices(tmp.path)).execute(
        {
          code: `await Bun.write("a.txt", "x\\n")
          await tools.pause({})
          for (let i = 0; i < ${CodeModeDiffs.MAX_FILES + 5}; i++) await Bun.write(\`f\${i}.txt\`, "x\\n")
          await tools.pause({})
          throw new Error("boom")`,
        },
        { ...context, progress: (update) => Effect.sync(() => progress.push(update)) },
      ),
    )
    const counts = progress.map((update) => (Array.isArray(update.files) ? update.files.length : 0))
    expect(counts).toContain(1)
    expect(counts.toSorted((left, right) => left - right)).toEqual(counts)
    expect(counts.at(-1)).toBe(CodeModeDiffs.MAX_FILES)
    expect(progress.find((update) => update.files)?.files).toMatchObject([
      { file: "a.txt", status: "added", additions: 1 },
    ])
    expect(result.metadata?.error).toBe(true)
    expect(result.metadata?.files).toHaveLength(CodeModeDiffs.MAX_FILES)
  })

  test("a denied permission reaches the program and changes nothing", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "keep.txt"), "keep")
    const denied = (action: string, code: string) =>
      run(tmp.path, code, permissionService(deny(action)), codeModeServices(tmp.path, deny(action)))
    const failure = `const failure = async (run) => { try { await run() } catch (e) { return e.message } }`
    expect(await denied("read", `${failure}\nreturn [await failure(() => Bun.file("keep.txt"))]`)).toEqual([
      "Permission denied: read",
    ])
    expect(await denied("glob", 'return new Bun.Glob("*").scanSync()')).toEqual(["keep.txt"])
    expect(await denied("read", `${failure}\nreturn [await failure(() => new Bun.Glob("*").scanSync())]`)).toEqual([
      "Permission denied: read",
    ])
    expect(
      await denied(
        "edit",
        `${failure}\nreturn [await failure(() => Bun.write("new.txt", "x")), await failure(() => Bun.file("keep.txt").delete())]`,
      ),
    ).toEqual(["Permission denied: edit", "Permission denied: edit"])
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
        save: [server.url.origin, `${server.url.origin}/*`],
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

describe("Code Mode opencode:// fetch", () => {
  // Only the API and a Location, without the full_codemode file services: opencode:// doesn't need them.
  const api = (handle: CodeModeApi.Interface["fetch"]) =>
    Context.make(CodeModeApi.Service, { fetch: handle }).pipe(
      Context.add(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("/workspace/demo") }))),
    )

  test("sends the request to CodeModeApi in the session's directory, with current naming the calling session", async () => {
    const received: Array<{ method: string; url: string; directory: string | null; body: string }> = []
    const result = await Effect.runPromise(
      createCodeMode(
        new Map(),
        allowAll,
        undefined,
        api((request) =>
          Effect.promise(async () => {
            received.push({
              method: request.method,
              url: request.url,
              directory: request.headers.get("x-opencode-directory"),
              body: await request.text(),
            })
            return Response.json({ ok: true })
          }),
        ),
      ).execute(
        {
          code: `const a = await (await fetch("opencode:///api/session/current/message?limit=1")).json()
            const b = await (await fetch("opencode:///api/session", {
              method: "POST",
              headers: { "x-opencode-directory": encodeURIComponent("/custom/dir") },
              body: JSON.stringify({ title: "demo" }),
            })).json()
            const c = await (await fetch("opencode:///api/vcs/status?location[directory]=/query/dir")).json()
            return [a.ok, b.ok, c.ok]`,
        },
        context,
      ),
    )

    expect(JSON.parse(result.output.output)).toEqual([true, true, true])
    expect(received).toEqual([
      {
        method: "GET",
        url: `http://opencode.local/api/session/${context.sessionID}/message?limit=1`,
        directory: encodeURIComponent("/workspace/demo"),
        body: "",
      },
      {
        method: "POST",
        url: "http://opencode.local/api/session",
        directory: encodeURIComponent("/custom/dir"),
        body: JSON.stringify({ title: "demo" }),
      },
      {
        method: "GET",
        url: "http://opencode.local/api/vcs/status?location[directory]=/query/dir",
        directory: null,
        body: "",
      },
    ])
  })

  test("asks as the opencode api command that would make the same call", async () => {
    const asked: Array<{ action: string; resources: ReadonlyArray<string>; save?: ReadonlyArray<string> }> = []
    const sent: Array<string> = []
    const handle = api((request) => Effect.sync(() => (sent.push(request.url), Response.json({ ok: true }))))
    const run = (permission: Permission.Interface) =>
      Effect.runPromise(
        createCodeMode(new Map(), permission, undefined, handle).execute(
          {
            code: `try { await fetch("opencode:///api/session/current/prompt", { method: "POST", body: "{}" }); return "sent" } catch (e) { return e.message }`,
          },
          context,
        ),
      ).then((result) => result.output.output)

    expect(await run(permissionService({ assert: (input) => Effect.sync(() => void asked.push(input)) }))).toBe("sent")
    expect(asked).toEqual([
      expect.objectContaining({
        action: "shell",
        resources: [`opencode api post /api/session/${context.sessionID}/prompt`],
        save: ["opencode *"],
      }),
    ])
    const denied = permissionService({
      assert: (input) =>
        Effect.fail(new Permission.BlockedError({ rules: [], permission: input.action, resources: input.resources })),
    })
    expect(await run(denied)).toContain("Permission denied: shell")
    expect(sent).toHaveLength(1)
  })

  test("accepts only opencode:///api/... URLs, reports a disabled API, and fails without one", async () => {
    const run = (code: string, api?: Context.Context<CodeModeTool.Api>) =>
      Effect.runPromise(createCodeMode(new Map(), allowAll, undefined, api).execute({ code }, context)).then(
        (result) => result.output.output,
      )
    const never = api(() => Effect.die("never sent"))
    for (const url of ["opencode://api/session", "opencode:x@evil.com/api/info", "opencode:///openapi.json"])
      expect(await run(`try { await fetch(${JSON.stringify(url)}) } catch (e) { return e.message }`, never)).toContain(
        "use opencode:///api/...",
      )
    const disabled = Context.add(never, CodeModeApi.Service, CodeModeApi.disabled)
    expect(await run(`try { await fetch("opencode:///api/info") } catch (e) { return e.message }`, disabled)).toContain(
      "OPENCODE_FLAGS=opencode_api",
    )
    expect(await run(`try { await fetch("opencode:///api/info") } catch (e) { return e.message }`)).toContain(
      "opencode:// URLs are unavailable",
    )
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
  expect(conversions).toBe(1)
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

it.effect("execute interrupted right after a change sends the change it has not reported yet", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.promise(() => tmpdir())
    const started = yield* Deferred.make<void>()
    const progress: Array<Tool.Metadata> = []
    const wait: Info = {
      name: "wait",
      description: "Wait",
      input: Schema.Struct({}),
      output: Schema.String,
      execute: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
    }
    const fiber = yield* createCodeMode(new Map([["wait", wait]]), allowAll, codeModeServices(tmp.path))
      .execute(
        { code: 'await Bun.write("a.txt", "x\\n"); await Bun.write("b.txt", "y\\n"); return await tools.wait({})' },
        { ...context, progress: (update) => Effect.sync(() => progress.push(update)) },
      )
      .pipe(Effect.forkChild({ startImmediately: true }))
    yield* Deferred.await(started)
    const before = progress.at(-1)?.files
    yield* Fiber.interrupt(fiber)
    yield* Effect.promise(() => tmp[Symbol.asyncDispose]())

    expect(Array.isArray(before) ? before.length : 0).toBeLessThan(2)
    expect(progress.at(-1)?.files).toMatchObject([{ file: "a.txt" }, { file: "b.txt" }])
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
