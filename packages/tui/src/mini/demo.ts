// Demo mode for testing direct interactive mode without a real SDK.
//
// Enabled with `--demo`. Intercepts prompt submissions and drives the same
// presentation commits and footer actions as the live transport. This
// lets you test scrollback formatting, permission UI, canonical Form UI, and tool
// snapshots without making actual model calls. Pass a demo slash command as
// the initial interactive message to trigger a preview immediately.
//
// Slash commands:
//   /permission [kind] → triggers a permission request variant
//   /form [kind]       → triggers a canonical Form request variant
//   /fmt <kind>   → emits a specific tool/text type (text, reasoning, shell,
//                   write, edit, patch, subagent, question, error, mix)
//
// Demo mode handles permission and Form replies locally, completing or failing
// the synthetic tool parts through the same callbacks used by the live footer.
import path from "path"
import type { JsonValue, SessionMessageAssistantTool } from "@opencode-ai/client/promise"
import { writeSessionOutput } from "./stream"
import { toolCommit } from "./stream-v2.subagent"
import type {
  FooterApi,
  FooterView,
  FormCancel,
  FormReply,
  MiniFormRequest,
  MiniPermissionRequest,
  PermissionReply,
  RunPrompt,
  StreamCommit,
} from "./types"

const KINDS = [
  "markdown",
  "table",
  "text",
  "reasoning",
  "shell",
  "write",
  "edit",
  "patch",
  "subagent",
  "question",
  "error",
  "mix",
]
const PERMISSIONS = ["edit", "shell", "read", "subagent", "external", "doom"] as const
const FORMS = ["question", "external"] as const

type PermissionKind = (typeof PERMISSIONS)[number]
type FormKind = (typeof FORMS)[number]

function permissionKind(value: string | undefined): PermissionKind | undefined {
  const next = (value || "edit").toLowerCase()
  return PERMISSIONS.find((item) => item === next)
}

function formKind(value: string | undefined): FormKind | undefined {
  const next = (value || "question").toLowerCase()
  return FORMS.find((item) => item === next)
}

const SAMPLE_MARKDOWN = [
  "# Direct Mode Demo",
  "",
  "This is a realistic assistant response for direct-mode formatting checks.",
  "It mixes **bold**, _italic_, `inline code`, links, code fences, and tables in one streamed reply.",
  "",
  "## Summary",
  "",
  "- Restored the final markdown flush so the last block is committed on idle.",
  "- Switched markdown scrollback commits back to top-level block boundaries.",
  "- Added footer-level regression coverage for split-footer rendering.",
  "",
  "## Status",
  "",
  "| Area | Before | After | Notes |",
  "| --- | --- | --- | --- |",
  "| Direct mode | Missing final rows | Stable | Final markdown block now flushes on idle |",
  "| Tables | Dropped in streaming mode | Visible | Block-based commits match the working OpenTUI demo |",
  "| Tests | Partial coverage | Broader coverage | Includes a footer-level split render capture |",
  "",
  "> This sample intentionally includes a wide table so you can spot wrapping and commit bugs quickly.",
  "",
  "```ts",
  "const result = { markdown: true, tables: 2, stable: true }",
  "```",
  "",
  "## Files",
  "",
  "| File | Change |",
  "| --- | --- |",
  "| `scrollback.surface.ts` | Align markdown commit logic with the split-footer demo |",
  "| `footer.ts` | Keep active surfaces across footer-height-only resizes |",
  "| `footer.test.ts` | Capture real split-footer markdown payloads during idle completion |",
  "",
  "Next step: run `/fmt table` if you want a tighter table-only sample.",
].join("\n")

const SAMPLE_TABLE = [
  "# Table Sample",
  "",
  "| Kind | Example | Notes |",
  "| --- | --- | --- |",
  "| Pipe | `A\\|B` | Escaped pipes should stay in one cell |",
  "| Unicode | `漢字` | Wide characters should remain aligned |",
  "| Wrap | `LongTokenWithoutNaturalBreaks_1234567890` | Useful for width stress |",
  "| Status | done | Final row should still appear after idle |",
].join("\n")

type Ref = {
  msg: string
  part: string
  call: string
  tool: string
  input: Record<string, JsonValue>
  start: number
}

type FormRequest = {
  ref: Ref
  kind: FormKind
  request: MiniFormRequest
}

type Perm = {
  ref: Ref
  done: {
    title: string
    output: string
    metadata?: Record<string, JsonValue>
  }
}

type Permit = {
  ref: Ref
  permission: string
  patterns: string[]
  metadata?: MiniPermissionRequest["metadata"]
  always: string[]
  done: Perm["done"]
}

type State = {
  id: string
  thinking: boolean
  footer: FooterApi
  msg: number
  part: number
  call: number
  perm: number
  form: number
  perms: Map<string, Perm>
  forms: Map<string, FormRequest>
  started: Set<string>
}

type Input = {
  sessionID: string
  thinking: boolean
  footer: FooterApi
}

function note(footer: FooterApi, text: string): void {
  footer.append({
    kind: "system",
    text,
    phase: "start",
    source: "system",
  })
}

function clearSubagent(footer: FooterApi): void {
  footer.event({
    type: "stream.subagent",
    state: {
      tabs: [],
      details: {},
      permissions: [],
      forms: [],
    },
  })
}

function showSubagent(
  state: State,
  input: {
    sessionID: string
    label: string
    description: string
    status: "running" | "completed" | "cancelled" | "error"
    title?: string
    commits: StreamCommit[]
  },
) {
  state.footer.event({
    type: "stream.subagent",
    state: {
      tabs: [
        {
          sessionID: input.sessionID,
          label: input.label,
          description: input.description,
          status: input.status,
          title: input.title,
          lastUpdatedAt: Date.now(),
        },
      ],
      details: {
        [input.sessionID]: {
          commits: input.commits,
        },
      },
      permissions: [],
      forms: [],
    },
  })
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (!signal) {
      setTimeout(resolve, ms)
      return
    }

    if (signal.aborted) {
      resolve()
      return
    }

    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", done)
      resolve()
    }, ms)

    signal.addEventListener("abort", done, { once: true })
  })
}

function split(text: string): string[] {
  if (text.length <= 48) {
    return [text]
  }

  const size = Math.ceil(text.length / 3)
  return [text.slice(0, size), text.slice(size, size * 2), text.slice(size * 2)]
}

function take(state: State, key: "msg" | "part" | "call" | "perm", prefix: string): string {
  state[key] += 1
  return `demo_${prefix}_${state[key]}`
}

function present(state: State, commits: StreamCommit[], view?: FooterView): void {
  writeSessionOutput(
    { footer: state.footer },
    {
      commits,
      updates: view
        ? [
            {
              type: "stream.patch" as const,
              patch: { status: view.type === "permission" ? "awaiting permission" : "awaiting form" },
            },
            { type: "stream.view" as const, view },
          ]
        : undefined,
    },
  )
}

function clearBlocker(state: State): void {
  writeSessionOutput(
    { footer: state.footer },
    {
      commits: [],
      updates: [
        { type: "stream.patch", patch: { status: "" } },
        { type: "stream.view", view: { type: "prompt" } },
      ],
    },
  )
}

function open(state: State): string {
  return take(state, "msg", "msg")
}

async function emitText(state: State, body: string, signal?: AbortSignal): Promise<void> {
  const msg = open(state)
  const part = take(state, "part", "part")
  for (const item of split(body)) {
    if (signal?.aborted) {
      return
    }

    present(state, [
      { kind: "assistant", source: "assistant", text: item, phase: "progress", messageID: msg, partID: part },
    ])
    await wait(45, signal)
  }
}

async function emitReasoning(state: State, body: string, signal?: AbortSignal): Promise<void> {
  const msg = open(state)
  const part = take(state, "part", "part")
  let first = true
  for (const item of split(body)) {
    if (signal?.aborted) {
      return
    }

    if (state.thinking) {
      present(state, [
        {
          kind: "reasoning",
          source: "reasoning",
          text: first ? `Thinking: ${item.replace(/\[REDACTED\]/g, "")}` : item.replace(/\[REDACTED\]/g, ""),
          phase: "progress",
          messageID: msg,
          partID: part,
        },
      ])
      first = false
    }
    await wait(45, signal)
  }
}

function make(state: State, tool: string, input: Record<string, JsonValue>): Ref {
  return {
    msg: open(state),
    part: take(state, "part", "part"),
    call: take(state, "call", "call"),
    tool,
    input,
    start: Date.now(),
  }
}

function startTool(state: State, ref: Ref, structured: Record<string, JsonValue> = {}): SessionMessageAssistantTool {
  state.started.add(ref.part)
  const part = {
    type: "tool" as const,
    id: ref.call,
    name: ref.tool,
    state: { status: "running" as const, input: ref.input, structured, content: [] },
    time: { created: ref.start, ran: ref.start },
  }
  present(state, [toolCommit(part, ref.msg, "start")])
  return part
}

function askPermission(state: State, item: Permit): void {
  const tool = startTool(state, item.ref)

  const id = take(state, "perm", "perm")
  state.perms.set(id, {
    ref: item.ref,
    done: item.done,
  })

  present(state, [], {
    type: "permission",
    request: {
      id,
      sessionID: state.id,
      action: item.permission,
      resources: item.patterns,
      metadata: item.metadata ?? {},
      save: item.always,
      source: { type: "tool", messageID: item.ref.msg, callID: item.ref.call },
      tool,
    },
  })
}

function doneTool(
  state: State,
  ref: Ref,
  output: {
    title: string
    output: string
    metadata?: Record<string, JsonValue>
  },
): void {
  if (!state.started.has(ref.part)) startTool(state, ref)
  const part: SessionMessageAssistantTool = {
    type: "tool",
    id: ref.call,
    name: ref.tool,
    state: {
      status: "completed",
      input: ref.input,
      content: output.output ? [{ type: "text", text: output.output }] : [],
      structured: output.metadata ?? {},
    },
    time: { created: ref.start, ran: ref.start, completed: Date.now() },
  }
  present(state, [toolCommit(part, ref.msg, output.output ? "progress" : "final")])
}

function failTool(state: State, ref: Ref, error: string): void {
  if (!state.started.has(ref.part)) startTool(state, ref)
  present(state, [
    toolCommit(
      {
        type: "tool",
        id: ref.call,
        name: ref.tool,
        state: {
          status: "error",
          input: ref.input,
          error: { type: "unknown", message: error },
          structured: {},
          content: [],
        },
        time: { created: ref.start, ran: ref.start, completed: Date.now() },
      },
      ref.msg,
      "final",
    ),
  ])
}

function emitError(state: State, text: string): void {
  present(state, [{ kind: "error", source: "system", text, phase: "start" }])
}

async function emitBash(state: State, signal?: AbortSignal): Promise<void> {
  const ref = make(state, "shell", {
    command: "git status",
    workdir: process.cwd(),
    description: "Show git status",
  })
  startTool(state, ref)
  await wait(70, signal)
  doneTool(state, ref, {
    title: "git status",
    output: `${process.cwd()}\ngit status\nOn branch demo\nnothing to commit, working tree clean\n`,
    metadata: {
      exit: 0,
    },
  })
}

function emitWrite(state: State): void {
  const file = path.join(process.cwd(), "src", "demo-format.ts")
  const ref = make(state, "write", {
    path: file,
    content: "export const demo = 42\n",
  })
  doneTool(state, ref, {
    title: "write",
    output: "",
    metadata: {},
  })
}

function emitEdit(state: State): void {
  const file = path.join(process.cwd(), "src", "demo-format.ts")
  const ref = make(state, "edit", {
    path: file,
  })
  doneTool(state, ref, {
    title: "edit",
    output: "",
    metadata: {
      files: [
        {
          file,
          status: "modified",
          patch: "@@ -1 +1 @@\n-export const demo = 1\n+export const demo = 42\n",
        },
      ],
    },
  })
}

function emitPatch(state: State): void {
  const file = path.join(process.cwd(), "src", "demo-format.ts")
  const ref = make(state, "patch", {
    patchText: "*** Begin Patch\n*** End Patch",
  })
  doneTool(state, ref, {
    title: "patch",
    output: "",
    metadata: {
      files: [
        {
          status: "modified",
          file,
          patch: "@@ -1 +1 @@\n-export const demo = 1\n+export const demo = 42\n",
          deletions: 1,
        },
        {
          status: "added",
          file: path.join(process.cwd(), "README-demo.md"),
          patch: "@@ -0,0 +1,4 @@\n+# Demo\n+This is a generated preview file.\n",
          deletions: 0,
        },
      ],
    },
  })
}

function emitTask(state: State): void {
  const ref = make(state, "subagent", {
    description: "Scan run/* for reducer touchpoints",
    agent: "explore",
  })
  doneTool(state, ref, {
    title: "Reducer touchpoints found",
    output: "",
    metadata: {
      sessionID: "sub_demo_1",
      status: "completed",
      output: "",
    },
  })
  const part = {
    type: "tool",
    id: "sub_demo_call_1",
    name: "read",
    state: {
      status: "running",
      input: {
        path: "packages/tui/src/mini/stream.ts",
        offset: 1,
        limit: 200,
      },
      structured: {},
      content: [],
    },
    time: { created: Date.now(), ran: Date.now() },
  } satisfies SessionMessageAssistantTool
  showSubagent(state, {
    sessionID: "sub_demo_1",
    label: "Explore",
    description: "Scan run/* for reducer touchpoints",
    status: "completed",
    title: "Reducer touchpoints found",
    commits: [
      {
        kind: "user",
        text: "Scan run/* for reducer touchpoints",
        phase: "start",
        source: "system",
      },
      {
        kind: "reasoning",
        text: "Thinking: tracing reducer and footer boundaries",
        phase: "progress",
        source: "reasoning",
        messageID: "sub_demo_msg_reasoning",
        partID: "sub_demo_reasoning_1",
      },
      {
        kind: "tool",
        text: "running read",
        phase: "start",
        source: "tool",
        messageID: "sub_demo_msg_tool",
        partID: "sub_demo_tool_1",
        tool: "read",
        part,
      },
      {
        kind: "assistant",
        text: "Footer updates flow through stream.ts into RunFooter",
        phase: "progress",
        source: "assistant",
        messageID: "sub_demo_msg_text",
        partID: "sub_demo_text_1",
      },
    ],
  })
}

function emitQuestionTool(state: State): void {
  const ref = make(state, "question", {
    questions: [
      {
        header: "Style",
        question: "Which output style do you want to inspect?",
        options: [
          { label: "Diff", description: "Show diff block" },
          { label: "Code", description: "Show code block" },
        ],
        multiple: false,
        custom: false,
      },
      {
        header: "Extras",
        question: "Pick extra rows",
        options: [
          { label: "Usage", description: "Add usage row" },
          { label: "Duration", description: "Add duration row" },
        ],
        multiple: true,
        custom: true,
      },
    ],
  })
  doneTool(state, ref, {
    title: "question",
    output: "",
    metadata: {
      answers: [["Diff"], ["Usage", "custom-note"]],
    },
  })
}

function emitPermission(state: State, kind: PermissionKind = "edit"): void {
  const root = process.cwd()
  const file = path.join(root, "src", "demo-format.ts")

  if (kind === "shell") {
    const command = "git status --short"
    const ref = make(state, "shell", {
      command,
      workdir: root,
      description: "Inspect worktree changes",
    })
    askPermission(state, {
      ref,
      permission: "shell",
      patterns: [command],
      always: ["*"],
      done: {
        title: "git status --short",
        output: `${root}\ngit status --short\n M src/demo-format.ts\n?? src/demo-permission.ts\n`,
        metadata: {
          exit: 0,
        },
      },
    })
    return
  }

  if (kind === "read") {
    const target = path.join(root, "package.json")
    const ref = make(state, "read", {
      path: target,
      offset: 1,
      limit: 80,
    })
    askPermission(state, {
      ref,
      permission: "read",
      patterns: [target],
      always: [target],
      done: {
        title: "read",
        output: ["1: {", '2:   "name": "opencode",', '3:   "private": true', "4: }"].join("\n"),
        metadata: {},
      },
    })
    return
  }

  if (kind === "subagent") {
    const ref = make(state, "subagent", {
      description: "Inspect footer spacing across direct-mode prompts",
      agent: "explore",
    })
    askPermission(state, {
      ref,
      permission: "subagent",
      patterns: ["explore"],
      always: ["*"],
      done: {
        title: "Footer spacing checked",
        output: "",
        metadata: {
          sessionID: "sub_demo_perm_1",
          status: "completed",
          output: "",
        },
      },
    })
    return
  }

  if (kind === "external") {
    const dir = path.join(path.dirname(root), "demo-shared")
    const target = path.join(dir, "README.md")
    const ref = make(state, "read", {
      path: target,
      offset: 1,
      limit: 40,
    })
    askPermission(state, {
      ref,
      permission: "external_directory",
      patterns: [`${dir}/**`],
      metadata: {
        parentDir: dir,
        filepath: target,
      },
      always: [`${dir}/**`],
      done: {
        title: "read",
        output: `1: # External demo\n2: Shared preview file\nPath: ${target}`,
        metadata: {},
      },
    })
    return
  }

  if (kind === "doom") {
    const ref = make(state, "subagent", {
      description: "Retry the formatter after repeated failures",
      agent: "general",
    })
    askPermission(state, {
      ref,
      permission: "doom_loop",
      patterns: ["*"],
      always: ["*"],
      done: {
        title: "Retry allowed",
        output: "Continuing after repeated failures.\n",
        metadata: {},
      },
    })
    return
  }

  const diff = "@@ -1 +1 @@\n-export const demo = 1\n+export const demo = 42\n"
  const ref = make(state, "edit", {
    path: file,
  })
  askPermission(state, {
    ref,
    permission: "edit",
    patterns: [file],
    always: [file],
    done: {
      title: "edit",
      output: "",
      metadata: {
        files: [{ file, status: "modified", patch: diff }],
      },
    },
  })
}

function demoForm(kind: FormKind): { title: string; fields: MiniFormRequest["fields"]; questions?: JsonValue[] } {
  if (kind === "question") {
    const questions: JsonValue[] = [
      {
        header: "Layout",
        question: "Which footer view should be the reference for spacing checks?",
        options: [
          { label: "Form", description: "Inspect the canonical Form footer" },
          { label: "Prompt", description: "Return to the normal composer" },
        ],
        multiple: false,
        custom: true,
      },
      {
        header: "Checks",
        question: "Pick formatting previews",
        options: [
          { label: "Diff", description: "Emit an edit diff" },
          { label: "Subagent", description: "Emit a subagent card" },
        ],
        multiple: true,
        custom: true,
      },
    ]
    return {
      title: "Questions",
      questions,
      fields: [
        {
          key: "q0",
          title: "Layout",
          description: "Which footer view should be the reference for spacing checks?",
          type: "string",
          options: [
            { value: "Form", label: "Form", description: "Inspect the canonical Form footer" },
            { value: "Prompt", label: "Prompt", description: "Return to the normal composer" },
          ],
          custom: true,
        },
        {
          key: "q1",
          title: "Checks",
          description: "Pick formatting previews",
          type: "multiselect",
          options: [
            { value: "Diff", label: "Diff", description: "Emit an edit diff" },
            { value: "Subagent", label: "Subagent", description: "Emit a subagent card" },
          ],
          custom: true,
        },
      ],
    }
  }
  return {
    title: "MCP authorization",
    fields: [
      {
        key: "authorization",
        type: "external",
        url: "https://example.com/opencode-demo",
        title: "Authorize demo MCP server",
        description: "Complete authorization in your browser",
      },
    ],
  }
}

function emitForm(state: State, kind: FormKind = "question"): void {
  const form = demoForm(kind)
  const ref = make(state, kind === "question" ? "question" : "mcp_demo", {
    ...(form.questions ? { questions: form.questions } : { form: kind }),
  })
  startTool(state, ref)
  state.form++
  const request: MiniFormRequest = {
    id: `frm_demo_${state.form}`,
    sessionID: state.id,
    title: form.title,
    metadata:
      kind === "question"
        ? { kind: "question", tool: { messageID: ref.msg, callID: ref.call } }
        : { kind: "mcp", message: `Synthetic ${kind} MCP elicitation` },
    fields: form.fields,
  }
  state.forms.set(request.id, { ref, kind, request })
  present(state, [], { type: "form", request })
}

async function emitFmt(state: State, kind: string, body: string, signal?: AbortSignal): Promise<boolean> {
  if (kind === "text") {
    await emitText(state, body || SAMPLE_MARKDOWN, signal)
    return true
  }

  if (kind === "markdown" || kind === "md") {
    await emitText(state, body || SAMPLE_MARKDOWN, signal)
    return true
  }

  if (kind === "table") {
    await emitText(state, body || SAMPLE_TABLE, signal)
    return true
  }

  if (kind === "reasoning") {
    await emitReasoning(state, body || "Planning next steps [REDACTED] while preserving reducer ordering.", signal)
    return true
  }

  if (kind === "shell") {
    await emitBash(state, signal)
    return true
  }

  if (kind === "write") {
    emitWrite(state)
    return true
  }

  if (kind === "edit") {
    emitEdit(state)
    return true
  }

  if (kind === "patch") {
    emitPatch(state)
    return true
  }

  if (kind === "subagent") {
    emitTask(state)
    return true
  }

  if (kind === "question") {
    emitQuestionTool(state)
    return true
  }

  if (kind === "error") {
    emitError(state, body || "demo error event")
    return true
  }

  if (kind === "mix") {
    await emitText(state, SAMPLE_MARKDOWN, signal)
    await wait(50, signal)
    await emitReasoning(state, "Thinking through formatter edge cases [REDACTED].", signal)
    await wait(50, signal)
    await emitBash(state, signal)
    emitWrite(state)
    emitEdit(state)
    emitPatch(state)
    emitTask(state)
    emitQuestionTool(state)
    emitError(state, "demo mixed scenario error")
    return true
  }

  return false
}

function intro(state: State): void {
  note(
    state.footer,
    [
      "Demo slash commands enabled for interactive mode.",
      `- /permission [kind] (${PERMISSIONS.join(", ")})`,
      `- /form [kind] (${FORMS.join(", ")})`,
      `- /fmt <kind> (${KINDS.join(", ")})`,
      "Examples:",
      "- /permission shell",
      "- /form question",
      "- /form external",
      "- /fmt markdown",
      "- /fmt table",
      "- /fmt text your custom text",
    ].join("\n"),
  )
}

export function createRunDemo(input: Input) {
  const state: State = {
    id: input.sessionID,
    thinking: input.thinking,
    footer: input.footer,
    msg: 0,
    part: 0,
    call: 0,
    perm: 0,
    form: 0,
    perms: new Map(),
    forms: new Map(),
    started: new Set(),
  }

  const start = async (): Promise<void> => {
    intro(state)
  }

  const prompt = async (line: RunPrompt, signal?: AbortSignal): Promise<boolean> => {
    const text = line.text.trim()
    const list = text.split(/\s+/)
    const cmd = list[0] || ""

    clearSubagent(state.footer)

    if (cmd === "/help") {
      intro(state)
      return true
    }

    if (cmd === "/permission") {
      const kind = permissionKind(list[1])
      if (!kind) {
        note(state.footer, `Pick a permission kind: ${PERMISSIONS.join(", ")}`)
        return true
      }

      emitPermission(state, kind)
      return true
    }

    if (cmd === "/form") {
      const kind = formKind(list[1])
      if (!kind) {
        note(state.footer, `Pick a form kind: ${FORMS.join(", ")}`)
        return true
      }

      emitForm(state, kind)
      return true
    }

    if (cmd === "/fmt") {
      const kind = (list[1] || "").toLowerCase()
      const body = list.slice(2).join(" ")
      if (!kind) {
        note(state.footer, `Pick a kind: ${KINDS.join(", ")}`)
        return true
      }

      const ok = await emitFmt(state, kind, body, signal)
      if (ok) {
        return true
      }

      note(state.footer, `Unknown kind "${kind}". Use: ${KINDS.join(", ")}`)
      return true
    }

    return false
  }

  const permission = (input: PermissionReply): boolean => {
    const item = state.perms.get(input.requestID)
    if (!item || !input.reply) {
      return false
    }

    state.perms.delete(input.requestID)
    clearBlocker(state)

    if (input.reply === "reject") {
      failTool(state, item.ref, input.message || "permission rejected")
      return true
    }

    doneTool(state, item.ref, item.done)
    return true
  }

  const formReply = (input: FormReply): boolean => {
    const form = state.forms.get(input.formID)
    if (!form || input.sessionID !== form.request.sessionID) return false
    state.forms.delete(input.formID)
    clearBlocker(state)
    if (form.kind === "question") {
      doneTool(state, form.ref, {
        title: "question",
        output: "",
        metadata: {
          answers: form.request.fields.map((field) => {
            const value = input.answer[field.key]
            if (value === undefined) return []
            return Array.isArray(value) ? [...value] : [String(value)]
          }),
        },
      })
      return true
    }
    doneTool(state, form.ref, {
      title: form.request.title,
      output: `Form submitted: ${Object.entries(input.answer)
        .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(", ") : String(value)}`)
        .join("; ")}\n`,
      metadata: { answer: input.answer },
    })
    return true
  }

  const formCancel = (input: FormCancel): boolean => {
    const form = state.forms.get(input.formID)
    if (!form || input.sessionID !== form.request.sessionID) return false
    state.forms.delete(input.formID)
    clearBlocker(state)
    failTool(state, form.ref, "form cancelled")
    return true
  }

  return {
    start,
    prompt,
    permission,
    formReply,
    formCancel,
  }
}
