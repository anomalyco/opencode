# OpenCode Detailed Code Reference for Trajectory Recording

## File Locations & Key Functions Quick Reference

### 1. LLM CLIENT & API CALLS

**Main LLM Call Entry Point**
- File: `/Users/michael/opencode/packages/opencode/src/session/prompt.ts`
- Function: `loop()` (line 232)
- Core Call: `streamText()` (line 508-598)

**Key Code Section: Building & Calling LLM**
```typescript
// Line 508-598 in prompt.ts
const result = await processor.process(() =>
  streamText({
    onError(error) { /* ... */ },
    async experimental_repairToolCall(input) { /* ... */ },
    headers: { /* provider-specific */ },
    maxRetries: 0,
    activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
    maxOutputTokens: ProviderTransform.maxOutputTokens(...),
    abortSignal: abort,
    providerOptions: ProviderTransform.providerOptions(...),
    stopWhen: stepCountIs(1),
    temperature: params.temperature,
    topP: params.topP,
    messages: [
      // System messages (line 560-565)
      ...system.map((x): ModelMessage => ({
        role: "system",
        content: x,
      })),
      // Message history (line 566-580)
      ...MessageV2.toModelMessage(msgs.filter(/* filter logic */)),
    ],
    tools: model.info.tool_call === false ? undefined : tools,
    model: wrapLanguageModel({
      model: model.language,
      middleware: [
        {
          async transformParams(args) {
            if (args.type === "stream") {
              args.params.prompt = ProviderTransform.message(...)
            }
            return args.params
          },
        },
      ],
    }),
  })
)
```

**Provider & Model Loading**
- File: `/Users/michael/opencode/packages/opencode/src/provider/provider.ts`
- Functions:
  - `getModel(providerID, modelID)` (line 590-650)
  - `getSDK(provider, model)` (line 517-584)
  - `defaultModel()` (line 696-710)

**Key Code: Model Resolution**
```typescript
// Line 590-650 in provider.ts - getModel()
export async function getModel(providerID: string, modelID: string) {
  const key = `${providerID}/${modelID}`
  const s = await state()
  if (s.models.has(key)) return s.models.get(key)!
  
  const provider = s.providers[providerID]
  if (!provider) { /* error */ }
  
  const info = provider.info.models[modelID]
  if (!info) { /* error */ }
  
  const sdk = await getSDK(provider.info, info)
  
  const keyReal = `${providerID}/${modelID}`
  const realID = s.realIdByKey.get(keyReal) ?? info.id
  const language = provider.getModel
    ? await provider.getModel(sdk, realID, provider.options)
    : sdk.languageModel(realID)
  
  s.models.set(key, {
    providerID,
    modelID,
    info,
    language,  // <-- THIS IS USED IN streamText()
    npm: info.provider?.npm ?? provider.info.npm,
  })
  return { modelID, providerID, info, language, npm }
}
```

**System Prompt Resolution**
- File: `/Users/michael/opencode/packages/opencode/src/session/prompt.ts`
- Function: `resolveSystemPrompt()` (line 621-641)

**Tool Resolution**
- File: `/Users/michael/opencode/packages/opencode/src/session/prompt.ts`
- Function: `resolveTools()` (line 643-757)

### 2. TOOL EXECUTION

**Tool Definition Base**
- File: `/Users/michael/opencode/packages/opencode/src/tool/tool.ts`
- Interface: `Tool.Info`, `Tool.Context`

**Tool Registry**
- File: `/Users/michael/opencode/packages/opencode/src/tool/registry.ts`
- Main Function: `tools()` (line 110-119)
- Enable/Disable: `enabled()` (line 121-140)

**Tool Execution Wrapper in Prompt**
- File: `/Users/michael/opencode/packages/opencode/src/session/prompt.ts`
- Location: Inside `resolveTools()` (line 666-725)

**Key Code: Tool Wrapper**
```typescript
// Line 666-725 in prompt.ts
tools[item.id] = tool({
  id: item.id as any,
  description: item.description,
  inputSchema: jsonSchema(schema as any),
  async execute(args, options) {
    // 1. Plugin hook before execution
    await Plugin.trigger(
      "tool.execute.before",
      {
        tool: item.id,
        sessionID: input.sessionID,
        callID: options.toolCallId,
      },
      { args },
    )
    
    // 2. Execute actual tool
    const result = await item.execute(args, {
      sessionID: input.sessionID,
      abort: options.abortSignal!,
      messageID: input.processor.message.id,
      callID: options.toolCallId,
      extra: input.model,
      agent: input.agent.name,
      // Update tool metadata during execution
      metadata: async (val) => {
        const match = input.processor.partFromToolCall(options.toolCallId)
        if (match && match.state.status === "running") {
          await Session.updatePart({
            ...match,
            state: {
              title: val.title,
              metadata: val.metadata,
              status: "running",
              input: args,
              time: { start: Date.now() },
            },
          })
        }
      },
    })
    
    // 3. Plugin hook after execution
    await Plugin.trigger(
      "tool.execute.after",
      {
        tool: item.id,
        sessionID: input.sessionID,
        callID: options.toolCallId,
      },
      result,
    )
    
    return result
  },
  
  toModelOutput(result) {
    return {
      type: "text",
      value: result.output,
    }
  },
})
```

**Stream Event Processing**
- File: `/Users/michael/opencode/packages/opencode/src/session/processor.ts`
- Function: `process()` (line 41-380)
- Events handled: lines 50-329

**Key Code: Tool Call Event (tool-call)**
```typescript
// Line 120-178 in processor.ts
case "tool-call": {
  const match = toolcalls[value.toolCallId]
  if (match) {
    const part = await Session.updatePart({
      ...match,
      tool: value.toolName,
      state: {
        status: "running",
        input: value.input,
        time: {
          start: Date.now(),
        },
      },
      metadata: value.providerMetadata,
    })
    toolcalls[value.toolCallId] = part as MessageV2.ToolPart
    
    // Doom loop detection...
  }
  break
}
```

**Key Code: Tool Result Event (tool-result)**
```typescript
// Line 180-201 in processor.ts
case "tool-result": {
  const match = toolcalls[value.toolCallId]
  if (match && match.state.status === "running") {
    await Session.updatePart({
      ...match,
      state: {
        status: "completed",
        input: value.input,
        output: value.output.output,
        metadata: value.output.metadata,
        title: value.output.title,
        time: {
          start: match.state.time.start,
          end: Date.now(),
        },
        attachments: value.output.attachments,
      },
    })
    delete toolcalls[value.toolCallId]
  }
  break
}
```

### 3. AGENT EXECUTION LOOP

**Main Loop Function**
- File: `/Users/michael/opencode/packages/opencode/src/session/prompt.ts`
- Function: `loop()` (line 232-612)

**Key Code: Loop Structure**
```typescript
// Line 232-612 in prompt.ts
export const loop = fn(Identifier.schema("session"), async (sessionID) => {
  const abort = start(sessionID)
  if (!abort) {
    return new Promise<MessageV2.WithParts>((resolve, reject) => {
      const callbacks = state()[sessionID].callbacks
      callbacks.push({ resolve, reject })
    })
  }

  using _ = defer(() => cancel(sessionID))

  let step = 0
  while (true) {
    SessionStatus.set(sessionID, { type: "busy" })
    log.info("loop", { step, sessionID })
    if (abort.aborted) break
    
    // Get current message state
    let msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))
    let lastUser: MessageV2.User | undefined
    let lastAssistant: MessageV2.Assistant | undefined
    let lastFinished: MessageV2.Assistant | undefined
    let tasks: (MessageV2.CompactionPart | MessageV2.SubtaskPart)[] = []
    
    // Parse message history
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (!lastUser && msg.info.role === "user") lastUser = msg.info as MessageV2.User
      if (!lastAssistant && msg.info.role === "assistant") lastAssistant = msg.info as MessageV2.Assistant
      if (!lastFinished && msg.info.role === "assistant" && msg.info.finish)
        lastFinished = msg.info as MessageV2.Assistant
      if (lastUser && lastFinished) break
      const task = msg.parts.filter((part) => part.type === "compaction" || part.type === "subtask")
      if (task && !lastFinished) {
        tasks.push(...task)
      }
    }

    // Check exit condition
    if (!lastUser) throw new Error("No user message found")
    if (
      lastAssistant?.finish &&
      !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
      lastUser.id < lastAssistant.id
    ) {
      log.info("exiting loop", { sessionID })
      break
    }

    step++
    
    // Title generation (first step only)
    if (step === 1)
      ensureTitle({
        session: await Session.get(sessionID),
        modelID: lastUser.model.modelID,
        providerID: lastUser.model.providerID,
        message: msgs.find((m) => m.info.role === "user")!,
        history: msgs,
      })

    const model = await Provider.getModel(lastUser.model.providerID, lastUser.model.modelID)
    const task = tasks.pop()

    // Handle pending subtask
    if (task?.type === "subtask") {
      // Subtask execution (lines 292-397)
      continue
    }

    // Handle pending compaction
    if (task?.type === "compaction") {
      // Compaction processing (lines 400-413)
      continue
    }

    // Check for context overflow
    if (
      lastFinished &&
      lastFinished.summary !== true &&
      SessionCompaction.isOverflow({ tokens: lastFinished.tokens, model: model.info })
    ) {
      // Create compaction task
      continue
    }

    // Normal processing step
    const agent = await Agent.get(lastUser.agent)
    msgs = insertReminders({
      messages: msgs,
      agent,
    })
    
    const processor = SessionProcessor.create({
      assistantMessage: (await Session.updateMessage({
        id: Identifier.ascending("message"),
        parentID: lastUser.id,
        role: "assistant",
        mode: agent.name,
        path: { cwd: Instance.directory, root: Instance.worktree },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        modelID: model.modelID,
        providerID: model.providerID,
        time: { created: Date.now() },
        sessionID,
      })) as MessageV2.Assistant,
      sessionID: sessionID,
      model: model.info,
      providerID: model.providerID,
      abort,
    })
    
    // Resolve chat parameters
    const system = await resolveSystemPrompt({...})
    const tools = await resolveTools({...})
    const params = await Plugin.trigger("chat.params", {...})

    // Execute LLM call
    const result = await processor.process(() =>
      streamText({...})
    )
    
    if (result === "stop") break
    continue
  }
  
  // Return last assistant message
  SessionCompaction.prune({ sessionID })
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user") continue
    const queued = state()[sessionID]?.callbacks ?? []
    for (const q of queued) {
      q.resolve(item)
    }
    return item
  }
  throw new Error("Impossible")
})
```

**Loop State Management**
- File: `/Users/michael/opencode/packages/opencode/src/session/prompt.ts`
- State function: `state()` (line 59-78)
- Assert busy: `assertNotBusy()` (line 80-83)
- Cancel: `cancel()` (line 218-230)

**Start/End Points**
- Loop start: `loop()` entry (line 232)
- Processor start: `SessionProcessor.create()` (line 436)
- Processor end: `return "stop"` or `return "continue"` (lines 373-375, 599-600)

### 4. MESSAGE & CONVERSATION MANAGEMENT

**Message History Building**
- File: `/Users/michael/opencode/packages/opencode/src/session/prompt.ts`
- Location: Lines 559-581 (in streamText parameters)

**Key Code: Message Accumulation**
```typescript
// Line 559-581 in prompt.ts
messages: [
  ...system.map(
    (x): ModelMessage => ({
      role: "system",
      content: x,
    }),
  ),
  ...MessageV2.toModelMessage(
    msgs.filter((m) => {
      if (m.info.role !== "assistant" || m.info.error === undefined) {
        return true
      }
      if (
        MessageV2.AbortedError.isInstance(m.info.error) &&
        m.parts.some((part) => part.type !== "step-start" && part.type !== "reasoning")
      ) {
        return true
      }
      return false
    }),
  ),
],
```

**Message Conversion Function**
- File: `/Users/michael/opencode/packages/opencode/src/session/message-v2.ts`
- Function: `toModelMessage()` (line 551-668)

**Key Code: Message to UIMessage Conversion**
```typescript
// Line 551-668 in message-v2.ts
export function toModelMessage(
  input: {
    info: Info
    parts: Part[]
  }[],
): ModelMessage[] {
  const result: UIMessage[] = []

  for (const msg of input) {
    if (msg.parts.length === 0) continue

    if (msg.info.role === "user") {
      const userMessage: UIMessage = {
        id: msg.info.id,
        role: "user",
        parts: [],
      }
      result.push(userMessage)
      for (const part of msg.parts) {
        if (part.type === "text" && !part.ignored)
          userMessage.parts.push({
            type: "text",
            text: part.text,
          })
        if (part.type === "file" && part.mime !== "text/plain" && part.mime !== "application/x-directory")
          userMessage.parts.push({
            type: "file",
            url: part.url,
            mediaType: part.mime,
            filename: part.filename,
          })
        // Special parts...
      }
    }

    if (msg.info.role === "assistant") {
      const assistantMessage: UIMessage = {
        id: msg.info.id,
        role: "assistant",
        parts: [],
      }
      result.push(assistantMessage)
      for (const part of msg.parts) {
        if (part.type === "text")
          assistantMessage.parts.push({
            type: "text",
            text: part.text,
            providerMetadata: part.metadata,
          })
        if (part.type === "tool") {
          if (part.state.status === "completed") {
            assistantMessage.parts.push({
              type: ("tool-" + part.tool) as `tool-${string}`,
              state: "output-available",
              toolCallId: part.callID,
              input: part.state.input,
              output: part.state.output,
              callProviderMetadata: part.metadata,
            })
          }
          // Error handling...
        }
      }
    }
  }

  return convertToModelMessages(result)
}
```

**Message Storage**
- File: `/Users/michael/opencode/packages/opencode/src/session/index.ts`
- Functions:
  - `updateMessage()` (line 344-350)
  - `updatePart()` (line 379-388)
  - `messages()` (line 287-301)

**Key Code: Update Functions**
```typescript
// Line 344-350 in index.ts - updateMessage
export const updateMessage = fn(MessageV2.Info, async (msg) => {
  await Storage.write(["message", msg.sessionID, msg.id], msg)
  Bus.publish(MessageV2.Event.Updated, {
    info: msg,
  })
  return msg
})

// Line 379-388 in index.ts - updatePart
export const updatePart = fn(UpdatePartInput, async (input) => {
  const part = "delta" in input ? input.part : input
  const delta = "delta" in input ? input.delta : undefined
  await Storage.write(["part", part.messageID, part.id], part)
  Bus.publish(MessageV2.Event.PartUpdated, {
    part,
    delta,
  })
  return part
})
```

**Message Schema**
- File: `/Users/michael/opencode/packages/opencode/src/session/message-v2.ts`
- Lines 284-371

---

## Critical Code Flow Paths

### Path 1: User Message → LLM Call → Tool Execution → Result

1. **User submits prompt**: `SessionPrompt.prompt()` called
2. **Creates user message**: `Session.updateMessage()` stores message info
3. **User parts stored**: `Session.updatePart()` for each part
4. **Enter main loop**: `SessionPrompt.loop()`
5. **Get history**: `MessageV2.stream()` → `MessageV2.toModelMessage()`
6. **Build LLM call**: `streamText()` with messages, tools, system prompt
7. **Tool call event**: Processor catches `tool-call` event
8. **Tool execution**: Wrapped tool's `execute()` called
9. **Tool result**: `tool-result` event → `Session.updatePart()`
10. **Next iteration**: History includes tool result

### Path 2: LLM Response Processing

1. **Stream starts**: `start` event
2. **Text arrives**: `text-start` → `text-delta` → `text-end` events
3. **Text stored**: `Session.updatePart()` creates TextPart
4. **Step boundaries**: `start-step` and `finish-step` events
5. **Usage tracked**: `Session.getUsage()` calculates cost
6. **Message updated**: `Session.updateMessage()` with cost/tokens
7. **Finish reason**: Set on message when stream completes

### Path 3: Message History Building for Next Call

1. **Loop iteration**: `msgs = MessageV2.stream(sessionID)`
2. **Filter messages**: Remove certain error messages
3. **Convert format**: `MessageV2.toModelMessage(msgs)`
4. **System prepended**: `system.map(x => ({ role: "system", ... }))`
5. **Result**: Array of ModelMessage[] passed to `streamText()`

---

## Performance & Token Tracking

**Token & Cost Calculation**
- File: `/Users/michael/opencode/packages/opencode/src/session/index.ts`
- Function: `getUsage()` (line 390-441)

**Usage Event Handling**
- File: `/Users/michael/opencode/packages/opencode/src/session/processor.ts`
- Event: `finish-step` (lines 242-280)

**Compaction Trigger**
- File: `/Users/michael/opencode/packages/opencode/src/session/compaction.ts`
- Function: `isOverflow()` - checks if tokens exceed model context

---

## Plugin Integration Points

**Chat Parameters Plugin Hook**
- Location: `prompt.ts` line 478-499
- Event: `"chat.params"`

**Tool Execution Hooks**
- Location: `prompt.ts` lines 671-715
- Events: `"tool.execute.before"`, `"tool.execute.after"`

---

## Error Handling & Retry

**Error Types**
- File: `/Users/michael/opencode/packages/opencode/src/session/message-v2.ts`
- Types: `AuthError`, `APIError`, `AbortedError`, `OutputLengthError`

**Retry Logic**
- File: `/Users/michael/opencode/packages/opencode/src/session/processor.ts`
- Lines: 331-347
- Uses `SessionRetry.delay()` and `SessionRetry.sleep()`

**Error Handling in Processor**
- Catches during stream processing (line 331)
- Stores error in message via `MessageV2.fromError()`
- Publishes `Session.Event.Error`

