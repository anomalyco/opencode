import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, FileSystem, Schema, SchemaAST, SchemaGetter } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema } from "effect/unstable/httpapi"
import { format } from "prettier"
import {
  compile as compileContract,
  emitEffect,
  emitEffectImported,
  emitPromise,
  generate,
  GenerationError,
} from "../src"
import { it } from "./effect"
import { Api as FixtureApi, Missing } from "./fixture"

function api(endpoint: HttpApiEndpoint.Any) {
  return HttpApi.make("test").add(HttpApiGroup.make("session").add(endpoint))
}

function compile<Id extends string, Groups extends HttpApiGroup.Any>(source: HttpApi.HttpApi<Id, Groups>) {
  return emitEffect(compileContract(source))
}

describe("HttpApiCodegen.generate", () => {
  test("compiles one contract for Promise and Effect emitters", () => {
    const contract = compileContract(
      api(
        HttpApiEndpoint.get("get", "/session/:sessionID", {
          params: { sessionID: Schema.String },
          success: Schema.Struct({ data: Schema.String }),
        }),
      ),
    )

    const promise = emitPromise(contract)
    const effect = emitEffect(contract)

    expect(promise.operations).toEqual(effect.operations)
    expect(promise.files.map((file) => file.path)).toEqual(["types.ts", "client-error.ts", "client.ts", "index.ts"])
    const promiseClient = promise.files.find((file) => file.path === "client.ts")?.content
    expect(promiseClient).toContain('"get": (input: SessionGetInput, requestOptions?: RequestOptions)')
    expect(promiseClient).toContain("`/session/${encodeURIComponent(input.sessionID)}`")
    expect(effect.files.find((file) => file.path === "session.ts")?.content).toContain(
      'params: { "sessionID": input["sessionID"] }',
    )
  })

  test("allows Promise outputs to use an authoritative imported wire type", () => {
    const contract = compileContract(
      api(HttpApiEndpoint.get("events", "/event", { success: HttpApiSchema.StreamSse({ data: Schema.Unknown }) })),
    )
    const output = emitPromise(contract, {
      outputTypes: {
        "session.events": {
          name: "EventWire",
          import: 'import type { EventWire } from "./event-wire"',
        },
      },
    })
    const types = output.files.find((file) => file.path === "types.ts")?.content

    expect(types).toContain('import type { EventWire } from "./event-wire"')
    expect(types).toContain("export type SessionEventsOutput = EventWire")
  })

  test("emits an Effect client against an imported authoritative API", () => {
    const output = emitEffectImported(
      compileContract(
        api(
          HttpApiEndpoint.get("get", "/session/:sessionID", {
            params: { sessionID: Schema.String },
            success: Schema.Struct({ data: Schema.String }),
          }),
        ),
      ),
      { module: "@example/api", api: "Api" },
    )

    expect(output.files.map((file) => file.path)).toEqual(["client-error.ts", "client.ts", "index.ts"])
    expect(output.files.find((file) => file.path === "client.ts")?.content).toContain(
      'import { Api } from "@example/api"',
    )
    expect(output.files.find((file) => file.path === "client.ts")?.content).toContain(
      "HttpApiClient.ForApi<typeof Api>",
    )
  })

  test("projects imported endpoint constants into a generated API", () => {
    const output = emitEffectImported(
      compileContract(
        api(
          HttpApiEndpoint.get("get", "/session/:sessionID", {
            params: { sessionID: Schema.String },
            success: Schema.Struct({ data: Schema.String }),
          }),
        ),
      ),
      { module: "@example/api", endpoints: { "session.get": "SessionGet" } },
    )
    const client = output.files.find((file) => file.path === "client.ts")?.content

    expect(client).toContain('import { SessionGet } from "@example/api"')
    expect(client).toContain('const Api = HttpApi.make("generated").add(HttpApiGroup.make("session").add(SessionGet))')
  })

  test("imports an authoritative group without reconstructing it", () => {
    const output = emitEffectImported(
      compileContract(
        api(
          HttpApiEndpoint.get("get", "/session/:sessionID", {
            params: { sessionID: Schema.String },
            success: Schema.String,
          }),
        ),
      ),
      { module: "@example/api", group: "SessionGroup" },
    )
    const client = output.files.find((file) => file.path === "client.ts")?.content

    expect(client).toContain('import { SessionGroup } from "@example/api"')
    expect(client).toContain('const Api = HttpApi.make("generated").add(SessionGroup)')
    expect(client).not.toContain("HttpApiGroup")
  })

  test("separates hosted and consumer group names", () => {
    const source = HttpApi.make("test").add(
      HttpApiGroup.make("server.session").add(
        HttpApiEndpoint.get("session.get", "/session", { success: Schema.String }),
      ),
    )
    const contract = compileContract(source, { groupNames: { "server.session": "sessions" } })

    expect(contract.groups[0]?.identifier).toBe("sessions")
    expect(contract.groups[0]?.sourceIdentifier).toBe("server.session")
    expect(contract.groups[0]?.endpoints[0]?.operation).toMatchObject({ group: "sessions", name: "get" })
  })

  test("supports explicit public endpoint names", () => {
    const source = HttpApi.make("test").add(
      HttpApiGroup.make("server.permission")
        .add(HttpApiEndpoint.get("permission.request.list", "/request", { success: Schema.String }))
        .add(HttpApiEndpoint.get("session.permission.list", "/session", { success: Schema.String })),
    )
    const contract = compileContract(source, {
      endpointNames: { "permission.request.list": "listRequests" },
    })

    expect(contract.groups[0]?.endpoints.map((endpoint) => endpoint.operation.name)).toEqual(["listRequests", "list"])
  })

  test("omits custom transport endpoints", () => {
    const source = HttpApi.make("test").add(
      HttpApiGroup.make("server.pty")
        .add(HttpApiEndpoint.get("pty.get", "/pty", { success: Schema.String }))
        .add(HttpApiEndpoint.get("pty.connect", "/pty/connect", { success: Schema.Boolean })),
    )
    const contract = compileContract(source, { omitEndpoints: new Set(["pty.connect"]) })

    expect(contract.groups[0]?.endpoints.map((endpoint) => endpoint.endpoint.name)).toEqual(["pty.get"])
  })

  test("uses bracket access for input field names", () => {
    const source = api(
      HttpApiEndpoint.post("token", "/token", {
        headers: { "x-example-token": Schema.Literal("1") },
        success: Schema.String,
      }),
    )
    const contract = compileContract(source)
    const promise = emitPromise(contract).files.find((file) => file.path === "client.ts")?.content
    const effect = emitEffectImported(contract, {
      module: "@example/api",
      endpoints: { "session.token": "Token" },
    }).files.find((file) => file.path === "client.ts")?.content

    expect(promise).toContain('"x-example-token": input["x-example-token"]')
    expect(effect).toContain('"x-example-token": input["x-example-token"]')
  })

  test("rejects consumer group name collisions", () => {
    const source = HttpApi.make("test")
      .add(HttpApiGroup.make("first").add(HttpApiEndpoint.get("one", "/one", { success: Schema.String })))
      .add(HttpApiGroup.make("second").add(HttpApiEndpoint.get("two", "/two", { success: Schema.String })))

    expect(() => compileContract(source, { groupNames: { first: "same", second: "same" } })).toThrow(
      "Client group name collision: same",
    )
  })

  test("uses the unqualified endpoint name for the public client", () => {
    const contract = compileContract(
      api(
        HttpApiEndpoint.get("session.get", "/session/:sessionID", {
          params: { sessionID: Schema.String },
          success: Schema.String,
        }),
      ),
    )
    const promise = emitPromise(contract).files.find((file) => file.path === "client.ts")?.content
    const effect = emitEffectImported(contract, {
      module: "@example/api",
      endpoints: { "session.session.get": "SessionGet" },
    }).files.find((file) => file.path === "client.ts")?.content

    expect(contract.groups[0]?.endpoints[0]?.operation.name).toBe("get")
    expect(promise).toContain('"get": (input: SessionGetInput, requestOptions?: RequestOptions)')
    expect(effect).toContain('const adaptGroup0 = (raw: RawClient["session"]) => ({ "get": Endpoint0_0(raw) })')
    expect(effect).toContain('raw["session.get"]')
  })

  test("preserves optional keys in Promise error types", () => {
    class OptionalError extends Schema.TaggedErrorClass<OptionalError>()(
      "OptionalError",
      { message: Schema.String, detail: Schema.String.pipe(Schema.optional) },
      { httpApiStatus: 400 },
    ) {}
    const output = emitPromise(
      compileContract(api(HttpApiEndpoint.get("get", "/session", { success: Schema.String, error: OptionalError }))),
    )

    expect(output.files.find((file) => file.path === "types.ts")?.content).toContain(
      'readonly "message": string; readonly "detail"?: string | undefined',
    )
  })

  test("supports name-discriminated Promise errors", () => {
    class NamedError extends Schema.ErrorClass<NamedError>("NamedError")(
      { name: Schema.Literal("NamedError"), message: Schema.String },
      { httpApiStatus: 400 },
    ) {}
    const output = emitPromise(
      compileContract(
        api(HttpApiEndpoint.get("get", "/session", { success: Schema.NumberFromString, error: NamedError })),
      ),
    )
    const types = output.files.find((file) => file.path === "types.ts")?.content

    expect(types).toContain('readonly "name": "NamedError"')
    expect(types).toContain('"name" in value && value["name"] === "NamedError"')
  })

  test("preserves reflected default error statuses", () => {
    class MissingStatus extends Schema.TaggedErrorClass<MissingStatus>()("MissingStatus", {
      message: Schema.String,
    }) {}
    const output = emitPromise(
      compileContract(api(HttpApiEndpoint.get("get", "/session", { success: Schema.String, error: MissingStatus }))),
    )

    expect(output.files.find((file) => file.path === "client.ts")?.content).toContain("declaredStatuses: [500]")
  })

  test("erases brands from Promise wire types", () => {
    const output = emitPromise(
      compileContract(
        api(
          HttpApiEndpoint.get("get", "/session/:sessionID", {
            params: { sessionID: Schema.String.pipe(Schema.brand("SessionID")) },
            success: Schema.Struct({ data: Schema.String.pipe(Schema.brand("SessionID")) }),
          }),
        ),
      ),
    )
    const types = output.files.find((file) => file.path === "types.ts")?.content

    expect(types).toContain('readonly "sessionID": string')
    expect(types).not.toContain("Brand")
  })

  test("inlines non-recursive references in Promise wire types", () => {
    const Referenced = Schema.Struct({ value: Schema.String }).annotate({ identifier: "Referenced" })
    const output = emitPromise(
      compileContract(
        api(
          HttpApiEndpoint.get("get", "/session", {
            success: Schema.Struct({ data: Referenced }),
          }),
        ),
      ),
    )

    expect(output.files.find((file) => file.path === "types.ts")?.content).toContain(
      'export type SessionGetOutput = ({ readonly "data": ({ readonly "value": string }) })["data"]',
    )
  })

  test("expands Promise references only at identifier boundaries", () => {
    const Session = Schema.Struct({ name: Schema.Literal("Session"), id: Schema.String }).annotate({
      identifier: "Session",
    })
    const SessionID = Schema.String.annotate({ identifier: "SessionID" })
    const output = emitPromise(
      compileContract(
        api(
          HttpApiEndpoint.get("get", "/session", {
            success: Schema.Struct({ session: Session, sessionID: SessionID }),
          }),
        ),
      ),
    )

    expect(output.files.find((file) => file.path === "types.ts")?.content).toContain(
      'readonly "session": ({ readonly "name": "Session", readonly "id": string })',
    )
  })

  test("emits Effect Json schemas as standalone Promise types", () => {
    const output = emitPromise(
      compileContract(
        api(
          HttpApiEndpoint.get("get", "/session", {
            success: Schema.Json,
          }),
        ),
      ),
    )
    const types = output.files.find((file) => file.path === "types.ts")?.content

    expect(types).toContain("export type JsonValue =")
    expect(types).toContain("{ readonly [key: string]: JsonValue }")
    expect(types).not.toContain("Schema.Json")
  })

  test("emits an optional Promise input when every field is optional", () => {
    const output = emitPromise(
      compileContract(
        api(
          HttpApiEndpoint.get("list", "/session", {
            query: { limit: Schema.optional(Schema.Number) },
            success: Schema.Array(Schema.String),
          }),
        ),
      ),
    )

    expect(output.files.find((file) => file.path === "client.ts")?.content).toContain(
      '"list": (input?: SessionListInput, requestOptions?: RequestOptions)',
    )
  })

  test("rejects Promise transports that are not implemented", () => {
    expect(() =>
      emitPromise(
        compileContract(
          api(
            HttpApiEndpoint.get("text", "/text", {
              success: Schema.String.pipe(HttpApiSchema.asText()),
            }),
          ),
        ),
      ),
    ).toThrow("Unsupported Promise success encoding: session.text")

    expect(() =>
      emitPromise(
        compileContract(
          api(
            HttpApiEndpoint.get("binary", "/binary", {
              success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
            }),
          ),
        ),
      ),
    ).toThrow("Unsupported Promise success encoding: session.binary")

    expect(() =>
      emitPromise(compileContract(api(HttpApiEndpoint.get("read", "/file/*", { success: Schema.String })))),
    ).toThrow("Unsupported Promise path wildcard: /file/*")

    expect(() =>
      emitPromise(
        compileContract(
          api(
            HttpApiEndpoint.get("events", "/events", {
              success: HttpApiSchema.StreamSse({ data: Schema.String, error: Missing }),
            }),
          ),
        ),
      ),
    ).toThrow("Unsupported Promise stream: session.events")
  })

  test("executes an emitted Promise GET through fetch", async () => {
    const output = emitPromise(
      compileContract(
        api(
          HttpApiEndpoint.get("get", "/session/:sessionID", {
            params: { sessionID: Schema.String },
            success: Schema.Struct({ data: Schema.String }),
          }),
        ),
      ),
    )
    const directory = await mkdtemp(join(tmpdir(), "opencode-httpapi-codegen-"))

    try {
      await Promise.all(output.files.map((file) => Bun.write(join(directory, file.path), file.content)))
      const generated = await import(`${join(directory, "index.ts")}?t=${crypto.randomUUID()}`)
      let request: Request | undefined
      const client = generated.OpenCode.make({
        baseUrl: "https://example.com",
        fetch: async (input: RequestInfo | URL) => {
          request = input instanceof Request ? input : new Request(input)
          return Response.json({ data: "hello" })
        },
      })

      expect(await client.session.get({ sessionID: "a/b" })).toBe("hello")
      expect(request?.method).toBe("GET")
      expect(request?.url).toBe("https://example.com/session/a%2Fb")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("maps an emitted no-content response to undefined", async () => {
    const output = emitPromise(
      compileContract(
        api(
          HttpApiEndpoint.post("interrupt", "/session/:sessionID/interrupt", {
            params: { sessionID: Schema.String },
            success: HttpApiSchema.NoContent,
          }),
        ),
      ),
    )
    const directory = await mkdtemp(join(tmpdir(), "opencode-httpapi-codegen-"))

    try {
      await Promise.all(output.files.map((file) => Bun.write(join(directory, file.path), file.content)))
      const generated = await import(`${join(directory, "index.ts")}?t=${crypto.randomUUID()}`)
      const client = generated.OpenCode.make({
        baseUrl: "https://example.com",
        fetch: async () => new Response(null, { status: 204 }),
      })

      expect(await client.session.interrupt({ sessionID: "session" })).toBeUndefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("serializes flattened query, header, and JSON payload inputs", async () => {
    const output = emitPromise(
      compileContract(
        api(
          HttpApiEndpoint.post("prompt", "/session/:sessionID", {
            params: { sessionID: Schema.String },
            query: { resume: Schema.optional(Schema.Boolean) },
            headers: { traceID: Schema.String },
            payload: Schema.Struct({ prompt: Schema.String }),
            success: Schema.Struct({ data: Schema.String }),
          }),
        ),
      ),
    )
    const directory = await mkdtemp(join(tmpdir(), "opencode-httpapi-codegen-"))

    try {
      await Promise.all(output.files.map((file) => Bun.write(join(directory, file.path), file.content)))
      const generated = await import(`${join(directory, "index.ts")}?t=${crypto.randomUUID()}`)
      let request: Request | undefined
      const client = generated.OpenCode.make({
        baseUrl: "https://example.com",
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          request = input instanceof Request ? input : new Request(input, init)
          return Response.json({ data: "admitted" })
        },
      })

      expect(
        await client.session.prompt({ sessionID: "session", resume: true, traceID: "trace", prompt: "hello" }),
      ).toBe("admitted")
      expect(request?.url).toBe("https://example.com/session/session?resume=true")
      expect(request?.headers.get("traceID")).toBe("trace")
      expect(await request?.json()).toEqual({ prompt: "hello" })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("rejects with declared tagged errors and exports a type guard", async () => {
    const output = emitPromise(
      compileContract(
        api(
          HttpApiEndpoint.get("get", "/session/:sessionID", {
            params: { sessionID: Schema.String },
            success: Schema.Struct({ data: Schema.String }),
            error: Missing.pipe(HttpApiSchema.status(404)),
          }),
        ),
      ),
    )
    const directory = await mkdtemp(join(tmpdir(), "opencode-httpapi-codegen-"))

    try {
      await Promise.all(output.files.map((file) => Bun.write(join(directory, file.path), file.content)))
      const generated = await import(`${join(directory, "index.ts")}?t=${crypto.randomUUID()}`)
      const client = generated.OpenCode.make({
        baseUrl: "https://example.com",
        fetch: async () => Response.json({ _tag: "Missing", message: "gone" }, { status: 404 }),
      })

      const error = await client.session.get({ sessionID: "missing" }).catch((cause: unknown) => cause)
      expect(error).toEqual({ _tag: "Missing", message: "gone" })
      expect(generated.isMissing(error)).toBeTrue()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("iterates an emitted SSE stream lazily without reconnecting", async () => {
    const output = emitPromise(
      compileContract(
        api(
          HttpApiEndpoint.get("subscribe", "/event", {
            query: { after: Schema.optional(Schema.Number) },
            success: HttpApiSchema.StreamSse({
              data: Schema.Struct({ type: Schema.String, count: Schema.NumberFromString }),
            }),
          }),
        ),
      ),
    )
    const directory = await mkdtemp(join(tmpdir(), "opencode-httpapi-codegen-"))

    try {
      await Promise.all(output.files.map((file) => Bun.write(join(directory, file.path), file.content)))
      const generated = await import(`${join(directory, "index.ts")}?t=${crypto.randomUUID()}`)
      let requests = 0
      let url: string | undefined
      const client = generated.OpenCode.make({
        baseUrl: "https://example.com",
        fetch: async (input: RequestInfo | URL) => {
          requests++
          url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
          const encoder = new TextEncoder()
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode('data: {"type":"ready","count":"1"}\r'))
                controller.enqueue(encoder.encode("\n\r\n"))
                controller.close()
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          )
        },
      })
      const events = client.session.subscribe({ after: 2 })

      expect(requests).toBe(0)
      const received = []
      for await (const event of events) received.push(event)
      expect(received).toEqual([{ type: "ready", count: "1" }])
      expect(requests).toBe(1)
      expect(url).toBe("https://example.com/event?after=2")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("preserves public group and endpoint identifiers exactly", () => {
    const output = compile(
      HttpApi.make("test").add(
        HttpApiGroup.make("session").add(HttpApiEndpoint.get("get", "/session/:sessionID", { success: Schema.String })),
      ),
    )

    expect(output.operations[0]).toMatchObject({ group: "session", name: "get" })
  })

  test("emits one client module per HttpApi group", () => {
    const source = HttpApi.make("test")
      .add(HttpApiGroup.make("session").add(HttpApiEndpoint.get("get", "/session", { success: Schema.String })))
      .add(HttpApiGroup.make("tool").add(HttpApiEndpoint.get("list", "/tool", { success: Schema.String })))

    const output = compile(source)

    expect(output.files.map((file) => file.path)).toEqual([
      "session.ts",
      "tool.ts",
      "client-error.ts",
      "client.ts",
      "index.ts",
    ])
  })

  test("emits syntactically valid TypeScript modules", () => {
    const output = compile(
      api(
        HttpApiEndpoint.get("get", "/session/:sessionID", {
          params: { sessionID: Schema.String },
          success: Schema.Struct({ data: Schema.String }),
        }),
      ),
    )
    const transpiler = new Bun.Transpiler({ loader: "ts" })

    for (const file of output.files) expect(() => transpiler.transformSync(file.content)).not.toThrow()
  })

  it.effect("keeps the strict generated-consumer fixture current", () =>
    Effect.gen(function* () {
      const output = compile(FixtureApi)
      const actual = yield* Effect.promise(() =>
        Array.fromAsync(new Bun.Glob("*.ts").scan(new URL("generated", import.meta.url).pathname)),
      )
      expect(actual.sort((a, b) => a.localeCompare(b))).toEqual(
        output.files.map((file) => file.path).sort((a, b) => a.localeCompare(b)),
      )
      yield* Effect.forEach(output.files, (file) =>
        Effect.tryPromise(() =>
          Promise.all([
            Bun.file(new URL(`generated/${file.path}`, import.meta.url)).text(),
            format(file.content, { parser: "typescript", semi: false, printWidth: 120 }),
          ]),
        ).pipe(Effect.map(([content, expected]) => expect(content).toBe(expected))),
      )
    }),
  )

  test("flattens transport input channels into one domain input", () => {
    const output = compile(
      api(
        HttpApiEndpoint.post("prompt", "/session/:sessionID", {
          params: { sessionID: Schema.String },
          query: { resume: Schema.String },
          headers: { traceID: Schema.String },
          payload: Schema.Struct({ prompt: Schema.String }),
          success: Schema.Struct({ data: Schema.String }),
        }),
      ),
    )

    expect(output.operations[0]?.input).toEqual([
      { name: "sessionID", source: "params" },
      { name: "resume", source: "query" },
      { name: "traceID", source: "headers" },
      { name: "prompt", source: "payload" },
    ])
    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain(
      'params: { "sessionID": input["sessionID"] }',
    )
  })

  test("uses no argument when an operation has no input fields", () => {
    const output = compile(api(HttpApiEndpoint.get("health", "/health", { success: Schema.String })))

    expect(output.operations[0]?.inputMode).toBe("none")
  })

  test("uses an optional object when every input field is optional", () => {
    const output = compile(
      api(
        HttpApiEndpoint.get("list", "/session", {
          query: { limit: Schema.optional(Schema.String) },
          success: Schema.Array(Schema.String),
        }),
      ),
    )

    expect(output.operations[0]?.inputMode).toBe("optional")
    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain('input?.["limit"]')
  })

  test("regenerates standard HttpApi transport codecs from decoded schemas", () => {
    const output = compile(
      api(
        HttpApiEndpoint.get("list", "/session", {
          query: { archived: Schema.optional(Schema.Boolean) },
          success: Schema.String,
        }),
      ),
    )

    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain("Schema.Boolean")
  })

  test("uses a required object when any input field is required", () => {
    const output = compile(
      api(
        HttpApiEndpoint.get("get", "/session/:sessionID", {
          params: { sessionID: Schema.String },
          query: { includeArchived: Schema.optional(Schema.String) },
          success: Schema.String,
        }),
      ),
    )

    expect(output.operations[0]?.inputMode).toBe("required")
  })

  test("rejects colliding input names across transport channels", () => {
    expect(() =>
      compile(
        api(
          HttpApiEndpoint.post("prompt", "/session/:id", {
            params: { id: Schema.String },
            payload: Schema.Struct({ id: Schema.String }),
            success: Schema.Void,
          }),
        ),
      ),
    ).toThrow("Input field collision: id")
  })

  test("rejects multiple payload alternatives until selection semantics are explicit", () => {
    expect(() =>
      compile(
        api(
          HttpApiEndpoint.post("prompt", "/session", {
            payload: [Schema.Struct({ text: Schema.String }), Schema.Struct({ count: Schema.Number })],
            success: Schema.String,
          }),
        ),
      ),
    ).toThrow("Multiple payload schemas: session.prompt")
  })

  test("unwraps an exact data success envelope", () => {
    const output = compile(
      api(
        HttpApiEndpoint.get("get", "/session/:sessionID", {
          params: { sessionID: Schema.String },
          success: Schema.Struct({ data: Schema.String }),
        }),
      ),
    )

    expect(output.operations[0]?.success).toBe("value")
    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain(
      "Effect.map((value) => value.data)",
    )
  })

  test("maps no-content success to void", () => {
    const output = compile(
      api(HttpApiEndpoint.post("interrupt", "/session/:sessionID/interrupt", { success: HttpApiSchema.NoContent })),
    )

    expect(output.operations[0]?.success).toBe("void")
    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain('"httpApiStatus": 204')
  })

  test("preserves non-default empty response statuses", () => {
    const output = compile(api(HttpApiEndpoint.post("create", "/session", { success: HttpApiSchema.Created })))

    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain('"httpApiStatus": 201')
  })

  test("returns a non-envelope success unchanged", () => {
    const output = compile(api(HttpApiEndpoint.get("health", "/health", { success: Schema.String })))

    expect(output.operations[0]?.success).toBe("value")
  })

  test("rejects multiple success shapes until their public semantics are explicit", () => {
    expect(() =>
      compile(
        api(
          HttpApiEndpoint.get("get", "/session", {
            success: [Schema.String, Schema.Number],
          }),
        ),
      ),
    ).toThrow("Multiple success schemas: session.get")
  })

  test("models an SSE success as a direct stream", () => {
    const output = compile(
      api(
        HttpApiEndpoint.get("subscribe", "/event", {
          success: HttpApiSchema.StreamSse({ data: Schema.Struct({ type: Schema.String }) }),
        }),
      ),
    )

    expect(output.operations[0]?.success).toBe("stream")
  })

  test("preserves annotated stream response statuses", () => {
    const output = compile(
      api(
        HttpApiEndpoint.get("subscribe", "/event", {
          success: HttpApiSchema.StreamSse({ data: Schema.String }).pipe(HttpApiSchema.status(202)),
        }),
      ),
    )

    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain(
      ".pipe(HttpApiSchema.status(202))",
    )
  })

  test("rejects schemas whose semantics cannot be emitted exactly", () => {
    const OpaqueUrl = Schema.declare((input): input is URL => input instanceof URL)

    expect(() => compile(api(HttpApiEndpoint.get("get", "/url", { success: OpaqueUrl })))).toThrow(
      "Unportable schema: session.get.success",
    )
  })

  test("rejects custom transformations hidden beneath standard HttpApi codecs", () => {
    const QueryBoolean = Schema.Literals(["yes", "no"]).pipe(
      Schema.decodeTo(Schema.Boolean, {
        decode: SchemaGetter.transform((value) => value === "yes"),
        encode: SchemaGetter.transform((value) => (value ? "yes" : "no")),
      }),
    )

    expect(() =>
      compile(
        api(
          HttpApiEndpoint.get("get", "/session", {
            query: { archived: QueryBoolean },
            success: Schema.String,
          }),
        ),
      ),
    ).toThrow("Effect schema requires authoritative import: session.get")
  })

  test("rejects custom validation checks without portable metadata", () => {
    const Positive = Schema.Number.check(Schema.makeFilter((value) => (value > 0 ? undefined : "positive")))

    expect(() => compile(api(HttpApiEndpoint.get("get", "/session", { success: Positive })))).toThrow(
      "Unportable schema: session.get.success",
    )
  })

  test("rejects spoofed and aborted validation checks", () => {
    const Spoofed = Schema.Number.check(
      Schema.makeFilter(() => "always fails", { meta: { _tag: "isFinite" }, arbitrary: {} }),
    )
    const Aborted = Schema.Number.check(Schema.isFinite().abort())

    expect(() => compile(api(HttpApiEndpoint.get("spoofed", "/session", { success: Spoofed })))).toThrow(
      "Unportable schema: session.spoofed.success",
    )
    expect(() => compile(api(HttpApiEndpoint.get("aborted", "/session", { success: Aborted })))).toThrow(
      "Unportable schema: session.aborted.success",
    )
  })

  test("rejects altered wire-side schemas even when the codec transformation is canonical", () => {
    const JsonNumber = Schema.toCodecJson(Schema.Number)
    const link = JsonNumber.ast.encoding?.[0]
    if (link === undefined) throw new Error("Expected JSON number encoding")
    // This helper is present at runtime but omitted from the public declaration surface.
    const replaceEncoding: unknown = Reflect.get(SchemaAST, "replaceEncoding")
    if (typeof replaceEncoding !== "function") throw new Error("Expected SchemaAST.replaceEncoding")
    const ast: unknown = replaceEncoding(JsonNumber.ast, [
      new SchemaAST.Link(Schema.String.check(Schema.isMinLength(2)).ast, link.transformation),
    ])
    if (!SchemaAST.isAST(ast)) throw new Error("Expected altered schema AST")
    const Altered = Schema.make(ast)

    expect(() => compile(api(HttpApiEndpoint.get("get", "/session", { success: Altered })))).toThrow(
      "Effect schema requires authoritative import: session.get",
    )
  })

  test("rejects lexical generation and annotation values", () => {
    const Generated = Schema.declare((input): input is string => typeof input === "string").annotate({
      generation: { runtime: "LocalOnly", Type: "string" },
    })
    const Annotated = Schema.declare((input): input is string => typeof input === "string").annotate({
      custom: () => "local",
    })

    expect(() => compile(api(HttpApiEndpoint.get("generated", "/session", { success: Generated })))).toThrow(
      "Unportable schema: session.generated.success",
    )
    expect(() => compile(api(HttpApiEndpoint.get("annotated", "/session", { success: Annotated })))).toThrow(
      "Unportable schema: session.annotated.success",
    )
  })

  test("preserves errors from server-only middleware", () => {
    class Unauthorized extends Schema.TaggedErrorClass<Unauthorized>()("Unauthorized", {}) {}
    class Authorization extends HttpApiMiddleware.Service<Authorization>()("Authorization", {
      error: Unauthorized,
    }) {}

    const output = compile(
      api(HttpApiEndpoint.get("get", "/session", { success: Schema.String }).middleware(Authorization)),
    )

    expect(output.operations[0]).toBeDefined()
    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain(
      'extends Schema.TaggedErrorClass<Endpoint0Error0Class>("Unauthorized")',
    )
  })

  test("preserves tagged error response statuses", () => {
    class Missing extends Schema.TaggedErrorClass<Missing>()("Missing", {}) {}
    const output = compile(
      api(
        HttpApiEndpoint.get("get", "/session", {
          success: Schema.String,
          error: Missing.pipe(HttpApiSchema.status(404)),
        }),
      ),
    )

    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain(
      'Endpoint0Error0Class.annotate({ "httpApiStatus": 404 })',
    )
  })

  test("supports every HttpApi method through the generic constructor", () => {
    const output = compile(api(HttpApiEndpoint.make("TRACE")("trace", "/trace", { success: Schema.String })))

    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain('HttpApiEndpoint.make("TRACE")')
  })

  test("uses safe unique module paths without changing public group identifiers", () => {
    const output = compile(
      HttpApi.make("test")
        .add(HttpApiGroup.make("../session").add(HttpApiEndpoint.get("get", "/session", { success: Schema.String })))
        .add(HttpApiGroup.make("GROUP-0").add(HttpApiEndpoint.get("list", "/session", { success: Schema.String }))),
    )

    expect(output.files.slice(0, 2).map((file) => file.path)).toEqual(["group-0.ts", "GROUP-0-1.ts"])
    expect(output.files[0]?.content).toContain('HttpApiGroup.make("../session"')
  })

  test("reserves support module names case-insensitively", () => {
    const output = compile(
      HttpApi.make("test")
        .add(HttpApiGroup.make("client").add(HttpApiEndpoint.get("get", "/client", { success: Schema.String })))
        .add(HttpApiGroup.make("INDEX").add(HttpApiEndpoint.get("get", "/index", { success: Schema.String }))),
    )

    expect(output.files.slice(0, 2).map((file) => file.path)).toEqual(["client-0.ts", "INDEX-1.ts"])
  })

  test("keeps searching when a reserved-name fallback is also occupied", () => {
    const output = compile(
      HttpApi.make("test")
        .add(HttpApiGroup.make("client-1").add(HttpApiEndpoint.get("first", "/first", { success: Schema.String })))
        .add(HttpApiGroup.make("client").add(HttpApiEndpoint.get("second", "/second", { success: Schema.String }))),
    )

    expect(output.files.slice(0, 2).map((file) => file.path)).toEqual(["client-1.ts", "client-1-1.ts"])
  })

  test("rejects collisions in the flattened client namespace", () => {
    expect(() =>
      compile(
        HttpApi.make("test")
          .add(HttpApiGroup.make("status").add(HttpApiEndpoint.get("get", "/nested", { success: Schema.String })))
          .add(
            HttpApiGroup.make("system", { topLevel: true }).add(
              HttpApiEndpoint.get("status", "/status", { success: Schema.String }),
            ),
          ),
      ),
    ).toThrow("Client name collision: status")
  })

  test("emits a usable raw type for top-level groups", () => {
    const output = compile(
      HttpApi.make("test").add(
        HttpApiGroup.make("health", { topLevel: true }).add(
          HttpApiEndpoint.get("check", "/health", { success: Schema.String }),
        ),
      ),
    )

    expect(output.files[0]?.content).toContain("type RawGroup = HttpApiClient.Client<typeof Group0")
  })

  it.effect("reports compiler failures in the generate Effect", () =>
    Effect.gen(function* () {
      const error = yield* generate(
        api(
          HttpApiEndpoint.get("get", "/url", {
            success: Schema.declare((input): input is URL => input instanceof URL),
          }),
        ),
        {
          directory: "/generated",
        },
      ).pipe(Effect.flip)

      expect(error).toBeInstanceOf(GenerationError)
      if (error instanceof GenerationError) expect(error.reason).toBe("Unportable schema: session.get.success")
    }).pipe(Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({}))),
  )

  test("rejects required client middleware without an adapter", () => {
    class SignedRequest extends HttpApiMiddleware.Service<SignedRequest>()("SignedRequest", {
      requiredForClient: true,
    }) {}

    expect(() =>
      compile(api(HttpApiEndpoint.get("get", "/session", { success: Schema.String }).middleware(SignedRequest))),
    ).toThrow("Client middleware requires adapter: SignedRequest")
  })

  test("maps transport and decode failures to one stable client error", () => {
    const output = compile(
      api(
        HttpApiEndpoint.get("get", "/session", {
          success: Schema.String,
        }),
      ),
    )

    expect(output.operations[0]?.errors).toContain("ClientError")
    expect(output.operations[0]?.errors).not.toContain("HttpClientError")
    expect(output.operations[0]?.errors).not.toContain("SchemaError")
    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain(
      "new ClientError({ cause: error })",
    )
  })
})
