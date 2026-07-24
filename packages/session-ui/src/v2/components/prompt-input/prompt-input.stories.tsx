// @ts-nocheck
import { createStore } from "solid-js/store"
import { PromptInputV2, type PromptInputV2PersistedState, type PromptInputV2Suggestion } from "."
import { createPromptInputV2Controller } from "./interaction"
import { createPromptInputV2Store } from "./store"
import { createEffect } from "solid-js"

const agents = [
  { id: "build", label: "Build" },
  { id: "plan", label: "Plan" },
  { id: "review", label: "Review" },
]

const variants = [
  { id: "default", label: "Default" },
  { id: "fast", label: "Fast" },
  { id: "thinking", label: "Thinking" },
]

const models = [
  { id: "claude-sonnet", name: "Claude Sonnet", providerID: "anthropic" },
  { id: "gpt-5", name: "GPT-5", providerID: "openai" },
  { id: "gemini-pro", name: "Gemini Pro", providerID: "google" },
]

const contextSuggestions: PromptInputV2Suggestion[] = [
  {
    id: "file-prompt",
    kind: "file",
    label: "prompt-input-v2.tsx",
    path: "src/components/prompt-input-v2.tsx",
    recent: true,
    mention: {
      type: "file",
      path: "src/components/prompt-input-v2.tsx",
      content: "@src/components/prompt-input-v2.tsx",
      start: 0,
      end: 0,
    },
  },
  {
    id: "file-story",
    kind: "file",
    label: "prompt-input-v2.stories.tsx",
    path: "src/components/prompt-input-v2.stories.tsx",
    mention: {
      type: "file",
      path: "src/components/prompt-input-v2.stories.tsx",
      content: "@src/components/prompt-input-v2.stories.tsx",
      start: 0,
      end: 0,
    },
  },
  {
    id: "agent-review",
    kind: "agent",
    label: "@review",
    description: "Ask the review agent",
    mention: { type: "agent", name: "review", content: "@review", start: 0, end: 0 },
  },
  {
    id: "reference-docs",
    kind: "reference",
    label: "@UI guidelines",
    path: "docs/ui.md",
    description: "Project reference",
    mention: {
      type: "file",
      path: "docs/ui.md",
      content: "@UI guidelines",
      start: 0,
      end: 0,
      mime: "application/x-directory",
      filename: "UI guidelines",
    },
  },
]

const commandSuggestions: PromptInputV2Suggestion[] = [
  {
    id: "command-fix",
    kind: "command",
    label: "/fix",
    trigger: "fix",
    title: "Fix",
    description: "Fix the current issue",
    keybind: ["Enter"],
  },
  {
    id: "command-review",
    kind: "command",
    label: "/review",
    trigger: "review",
    title: "Review",
    description: "Review pending changes",
  },
  {
    id: "command-test",
    kind: "command",
    label: "/test",
    trigger: "test",
    title: "Test",
    description: "Run relevant tests",
  },
]

function ControlledPromptInput() {
  // Agent choice is a persisted user/workspace preference in v1, not part of PromptStore.
  const [preferences, setPreferences] = createStore({ agent: "build" })

  const [runtime, setRuntime] = createStore({
    stopping: false,
  })

  // This matches the v1 PromptStore and can use the same persistence boundary.
  const state = createStore<PromptInputV2PersistedState>({
    prompt: [
      { type: "text", content: "", start: 0, end: 0 },
      {
        type: "image",
        id: "attachment-1",
        filename: "requirements.md",
        mime: "text/markdown",
        dataUrl: "data:text/markdown;base64,IyBSZXF1aXJlbWVudHM=",
      },
    ],
    cursor: 0,
    model: { providerID: "anthropic", modelID: "claude-sonnet", variant: null },
    context: {
      items: [
        {
          key: "file:src/components/prompt-input-v2.tsx:1:40",
          type: "file",
          path: "src/components/prompt-input-v2.tsx",
          selection: { startLine: 1, startChar: 0, endLine: 40, endChar: 0 },
          comment: "Keep this component context-free",
        },
      ],
    },
  })
  const store = createPromptInputV2Store(state)

  const controller = createPromptInputV2Controller({
    store: state,
    commands: () => commandSuggestions,
    context: () => contextSuggestions,
    searchContextFiles: (query) => {
      const needle = query.trim().toLowerCase()
      return contextSuggestions.filter(
        (item) => item.kind === "file" && `${item.label} ${item.path ?? ""}`.toLowerCase().includes(needle),
      )
    },
    view: {
      add: {
        onAttach: () => addAttachment("architecture.txt", "text/plain"),
      },
      agent: {
        options: () => agents,
        current: () => preferences.agent,
        onSelect: (agent) => setPreferences("agent", agent),
      },
      model: {
        options: () => models.map((model) => ({ id: model.id, label: model.name, providerID: model.providerID })),
        current: () =>
          models.find(
            (model) => model.id === store.state.model?.modelID && model.providerID === store.state.model?.providerID,
          )?.id ?? "",
        onSelect(id) {
          const model = models.find((item) => item.id === id)
          if (!model) return
          store.setModel({
            providerID: model.providerID,
            modelID: model.id,
            variant: store.state.model?.variant,
          })
        },
      },
      variant: {
        options: () => variants,
        current: () => store.state.model?.variant ?? "default",
        onSelect: (variant) => store.setVariant(variant === "default" ? null : variant),
      },
      submit: {
        stopping: () => runtime.stopping,
        working: () => runtime.stopping,
        onSubmit: () => {
          store.reset()
          setRuntime("stopping", true)
        },
        onStop: () => setRuntime("stopping", false),
      },
      onDrop: (event) => addAttachment(event.dataTransfer?.files[0]?.name ?? "dropped-file.txt", "text/plain"),
    },
  })

  const addAttachment = (filename: string, mime: string) => {
    store.addAttachment({
      type: "image",
      id: `attachment-${store.state.prompt.filter((part) => part.type === "image").length + 1}`,
      filename,
      mime,
      dataUrl: `data:${mime};base64,`,
    })
  }

  return (
    <div class="mx-auto flex max-w-[760px] flex-col gap-4 pt-32">
      <PromptInputV2 controller={controller} />
    </div>
  )
}

export default {
  title: "Session UI/PromptInputV2",
  id: "session-ui-prompt-input-v2",
  component: PromptInputV2,
}

export const ControlledComposition = {
  render: () => <ControlledPromptInput />,
}
