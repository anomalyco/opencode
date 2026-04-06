# Message Shape

Problem:

- stored messages need enough data to replay and resume a session later
- prompt hooks often just want to append a synthetic user/assistant message
- today that means faking ids, timestamps, and request metadata

## Option 1: Two Message Shapes

Keep `User` / `Assistant` for stored history, but clean them up.

```ts
type User = {
  role: "user"
  time: { created: number }
  request: {
    agent: string
    model: ModelRef
    variant?: string
    format?: OutputFormat
    system?: string
    tools?: Record<string, boolean>
  }
}

type Assistant = {
  role: "assistant"
  run: { agent: string; model: ModelRef; path: { cwd: string; root: string } }
  usage: { cost: number; tokens: Tokens }
  result: { finish?: string; error?: Error; structured?: unknown; kind: "reply" | "summary" }
}
```

Add a separate transient `PromptMessage` for prompt surgery.

```ts
type PromptMessage = {
  role: "user" | "assistant"
  parts: PromptPart[]
}
```

Plugin hook example:

```ts
prompt.push({
  role: "user",
  parts: [{ type: "text", text: "Summarize the tool output above and continue." }],
})
```

Tradeoff: prompt hooks get easy lightweight messages, but there are now two message shapes.

## Option 2: Prompt Mutators

Keep `User` / `Assistant` as the stored history model.

Prompt hooks do not build messages directly. The runtime gives them prompt mutators.

```ts
type PromptEditor = {
  append(input: { role: "user" | "assistant"; parts: PromptPart[] }): void
  prepend(input: { role: "user" | "assistant"; parts: PromptPart[] }): void
  appendTo(target: "last-user" | "last-assistant", parts: PromptPart[]): void
  insertAfter(messageID: string, input: { role: "user" | "assistant"; parts: PromptPart[] }): void
  insertBefore(messageID: string, input: { role: "user" | "assistant"; parts: PromptPart[] }): void
}
```

Plugin hook examples:

```ts
prompt.append({
  role: "user",
  parts: [{ type: "text", text: "Summarize the tool output above and continue." }],
})
```

```ts
prompt.appendTo("last-user", [{ type: "text", text: BUILD_SWITCH }])
```

Tradeoff: avoids a second full message type and avoids fake ids/timestamps, but moves more magic into the hook API.

## Option 3: Separate Turn State

Move execution settings out of `User` and into a separate turn/request object.

```ts
type Turn = {
  id: string
  request: {
    agent: string
    model: ModelRef
    variant?: string
    format?: OutputFormat
    system?: string
    tools?: Record<string, boolean>
  }
}

type User = {
  role: "user"
  turnID: string
  time: { created: number }
}

type Assistant = {
  role: "assistant"
  turnID: string
  usage: { cost: number; tokens: Tokens }
  result: { finish?: string; error?: Error; structured?: unknown; kind: "reply" | "summary" }
}
```

Examples:

```ts
const turn = {
  request: {
    agent: "build",
    model: { providerID: "openai", modelID: "gpt-5" },
  },
}
```

```ts
const msg = {
  role: "user",
  turnID: turn.id,
  parts: [{ type: "text", text: "Summarize the tool output above and continue." }],
}
```

Tradeoff: stored messages get much smaller and cleaner, but replay now has to join messages with turn state and prompt hooks still need a way to pick which turn they belong to.
