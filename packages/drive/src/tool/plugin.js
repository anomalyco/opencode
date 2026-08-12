import { Effect, Schedule, Schema, Scope } from "effect"

const MAX_BUFFER_CHARS = 1024 * 1024
const BACKGROUND_INSTRUCTION =
  "You will be notified automatically when the command finishes. DO NOT sleep, poll, or proactively check on its progress."
const descriptions = {
  shell: "Executes a shell command.",
  webfetch: "Fetch content from an HTTP or HTTPS URL and return it as text, markdown, or HTML.",
  websearch: "Search the web using the session's local web search provider.",
  write: "Writes a file to the local filesystem, overwriting if one exists.",
}

class ToolFailure extends Schema.TaggedErrorClass()("LLM.ToolFailure", {
  message: Schema.String,
}) {}

const content = (result) => [
  { type: "text", text: result.output },
  ...(result.status === "running" ? [{ type: "text", text: BACKGROUND_INSTRUCTION }] : []),
]

const output = (result) => ({
  output: result,
  content: content(result),
})

const progress = (result) => ({
  structured: result,
  content: content(result),
})

const failure = (cause) =>
  cause instanceof ToolFailure
    ? cause
    : new ToolFailure({ message: cause instanceof Error ? cause.message : String(cause) })

const parse = (line) =>
  Effect.try({
    try: () => JSON.parse(line),
    catch: (cause) => failure(cause),
  })

const waitForBackground = (options, shellID) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(`${options.endpoint}/background/${shellID}`, {
          headers: { authorization: `Bearer ${options.token}` },
          signal,
        }),
      catch: failure,
    })
    if (!response.ok)
      return yield* new ToolFailure({ message: `Drive background shell returned HTTP ${response.status}` })
    return yield* Effect.tryPromise({
      try: () => response.json(),
      catch: failure,
    })
  })

const notifyWhenDone = (ctx, options, sessionID, shellID) =>
  Effect.gen(function* () {
    const completion = yield* waitForBackground(options, shellID).pipe(
      Effect.retry({ times: 3, schedule: Schedule.spaced("100 millis") }),
    )
    yield* ctx.session
      .synthetic({
        id: `msg_${shellID}_completion`,
        sessionID,
        text: `<shell id="${shellID}" state="${completion.state}" command="${completion.command}">\n${completion.output}\n</shell>`,
        description: completion.command,
        metadata: { source: "shell", state: completion.state },
      })
      .pipe(Effect.retry({ times: 3, schedule: Schedule.spaced("100 millis") }))
    yield* Effect.tryPromise({
      try: (signal) =>
        fetch(`${options.endpoint}/background/${shellID}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${options.token}` },
          signal,
        }).then((response) => {
          if (!response.ok)
            throw new Error(`Drive background shell acknowledgement returned HTTP ${response.status}`)
        }),
      catch: failure,
    }).pipe(Effect.retry({ times: 3, schedule: Schedule.spaced("100 millis") }))
  }).pipe(
    Effect.catch((cause) => Effect.logError("Drive background shell notification failed", cause)),
  )

const execute = (ctx, scope, options, name, input, context) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(`${options.endpoint}/execute/${name}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            input,
            context: { callID: context.id },
          }),
          signal,
        }),
      catch: failure,
    })
    if (!response.ok || !response.body)
      return yield* new ToolFailure({ message: `Drive tool handler returned HTTP ${response.status}` })

    const reader = response.body.getReader()
    return yield* Effect.acquireUseRelease(
      Effect.succeed(reader),
      (reader) =>
        Effect.gen(function* () {
          const decoder = new TextDecoder()
          let buffer = ""
          let result
          while (true) {
            const chunk = yield* Effect.tryPromise({
              try: () => reader.read(),
              catch: failure,
            })
            buffer += decoder.decode(chunk.value, { stream: !chunk.done })
            if (buffer.length > MAX_BUFFER_CHARS)
              return yield* new ToolFailure({
                message: `Drive tool event exceeds ${MAX_BUFFER_CHARS} characters`,
              })
            let newline
            while ((newline = buffer.indexOf("\n")) !== -1) {
              const line = buffer.slice(0, newline)
              buffer = buffer.slice(newline + 1)
              if (!line) continue
              const event = yield* parse(line)
              if (event.type === "progress") yield* context.progress(progress(event.result))
              if (event.type === "success") result = event.result
              if (event.type === "failure")
                return yield* new ToolFailure({ message: event.message })
            }
            if (chunk.done) break
          }
          if (!result)
            return yield* new ToolFailure({ message: "Drive tool handler ended without a result" })
          if (name === "shell" && result.status === "running" && result.shellID)
            yield* notifyWhenDone(ctx, options, context.sessionID, result.shellID).pipe(
              Effect.forkIn(scope, { startImmediately: true }),
            )
          return output(result)
        }),
      (reader) => Effect.promise(() => reader.cancel().catch(() => undefined)),
    )
  })

export default {
  id: "opencode-drive.tool-handlers",
  effect: (ctx) =>
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      yield* ctx.tool.transform((tools) => {
        for (const name of ctx.options.tools) {
          tools.add({
            name,
            description: descriptions[name],
            input: ctx.options.schemas[name],
            options: { codemode: false },
            execute: (input, context) => execute(ctx, scope, ctx.options, name, input, context),
          })
        }
      })
    }),
}
