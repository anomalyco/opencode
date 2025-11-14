import { TextAttributes, TextareaRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { For, Show, createMemo, createSignal, onMount } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"

const FIELD_CONFIG = [
  {
    name: "name",
    label: "Name (optional - random if empty)",
    placeholder: "My Subagent",
    initialValue: "",
    required: false,
  },
  {
    name: "role",
    label: "Role",
    placeholder: "e.g., Bug Fixer, Feature Developer, Code Reviewer",
    initialValue: "",
    required: true,
  },
  {
    name: "prompt",
    label: "Prompt",
    placeholder: "What task should this subagent work on?",
    initialValue: "",
    required: true,
  },
  {
    name: "context",
    label: "Context",
    placeholder: "summary, full, or custom text",
    initialValue: "summary",
    required: false,
  },
] as const

type FieldKey = (typeof FIELD_CONFIG)[number]["name"]

const FIELD_DEFAULTS = FIELD_CONFIG.reduce<Record<FieldKey, string>>(
  (acc, field) => {
    acc[field.name] = field.initialValue ?? ""
    return acc
  },
  {} as Record<FieldKey, string>,
)

type CollaborationMode = "combine" | "blend" | "spliced"

const COLLAB_OPTIONS: Array<{
  value: CollaborationMode
  label: string
  hint: string
  description: string
}> = [
  {
    value: "combine",
    label: "Combine",
    hint: "High usage",
    description: "Run every agent in parallel and merge their full outputs for redundancy.",
  },
  {
    value: "blend",
    label: "Blend",
    hint: "Medium usage",
    description: "Stagger agents so each builds on the previous output for balanced cost and coverage.",
  },
  {
    value: "spliced",
    label: "Spliced",
    hint: "Optimal",
    description: "Split the work by expertise, let each agent focus, then stitch the winning pieces together.",
  },
]

export function DialogSubagentAdd(props: { sessionID: string }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const sync = useSync()

  const textareas: Partial<Record<FieldKey, TextareaRenderable>> = {}
  const [focusedIndex, setFocusedIndex] = createSignal(0)
  const [selectedAgents, setSelectedAgents] = createSignal<Set<string>>(new Set())
  const [strategy, setStrategy] = createSignal<CollaborationMode>("spliced")
  const [submitting, setSubmitting] = createSignal(false)

  const readFieldValue = (name: FieldKey, options?: { preserveFormatting?: boolean }) => {
    const fallback = FIELD_DEFAULTS[name] ?? ""
    const value = textareas[name]?.plainText ?? fallback
    return options?.preserveFormatting ? value : value.trim()
  }

  const agentOptions = createMemo(() => [...sync.data.agent].sort((a, b) => a.name.localeCompare(b.name)))
  const selectedAgentList = createMemo(() => Array.from(selectedAgents()).sort((a, b) => a.localeCompare(b)))
  const multiSelection = createMemo(() => selectedAgents().size > 1)
  const readyToSubmit = createMemo(() => !submitting() && selectedAgents().size > 0)

  const focusField = (index: number) => {
    const field = FIELD_CONFIG[index]
    if (!field) return
    setFocusedIndex(index)
    const textarea = textareas[field.name]
    textarea?.focus()
    textarea?.gotoLineEnd()
  }

  useKeyboard((evt) => {
    if (evt.name === "tab" && !evt.shift) {
      evt.preventDefault()
      focusField((focusedIndex() + 1) % FIELD_CONFIG.length)
      return
    }
    if (evt.name === "tab" && evt.shift) {
      evt.preventDefault()
      focusField((focusedIndex() - 1 + FIELD_CONFIG.length) % FIELD_CONFIG.length)
      return
    }
    if (evt.name === "return" && evt.ctrl) {
      evt.preventDefault()
      void submit()
    }
  })

  onMount(() => {
    dialog.setSize("large")
    setTimeout(() => focusField(0), 1)
    const defaultAgent = sync.data.agent.find((agent) => agent.name === "general")
    if (defaultAgent) {
      setSelectedAgents(new Set([defaultAgent.name]))
    }
  })

  const toggleAgent = (name: string) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const submit = async () => {
    if (submitting()) return
    const agents = selectedAgentList()
    if (!agents.length) {
      toast.show({
        variant: "warning",
        message: "Select at least one agent",
      })
      return
    }

    const values = {
      name: readFieldValue("name"),
      role: readFieldValue("role"),
      prompt: readFieldValue("prompt", { preserveFormatting: true }),
      context: readFieldValue("context") || "summary",
    }

    if (!values.role) {
      toast.show({
        variant: "warning",
        message: "Role is required",
      })
      return
    }
    if (!values.prompt.trim()) {
      toast.show({
        variant: "warning",
        message: "Prompt is required",
      })
      return
    }

    setSubmitting(true)
    const strategyValue = multiSelection() ? strategy() : undefined
    const strategyInfo = COLLAB_OPTIONS.find((opt) => opt.value === strategyValue)

    const instructionLines = [
      `Create ${agents.length > 1 ? "multiple subagents" : "a subagent"} using the add_task tool with the configuration below.`,
      "",
      `Name: ${values.name || "(random)"}`,
      `Role: ${values.role}`,
      "Prompt:",
      values.prompt,
      "",
      `Context mode: ${values.context}`,
      "",
      "Agents:",
      ...agents.map((agent) => `- ${agent}`),
    ]

    if (strategyInfo && agents.length > 1) {
      instructionLines.push(
        "",
        `Collaboration Strategy: ${strategyInfo.label} (${strategyInfo.hint})`,
        strategyInfo.description,
      )
    }

    instructionLines.push(
      "",
      "Steps:",
      "1. For each agent listed above, call the add_task tool with:",
      `   - description: ${values.role} (keep it concise)`,
      "   - prompt: reuse the prompt text above",
      "   - subagent_type: the agent name from the list",
      `   - context mode: ${values.context}`,
    )

    if (values.name) {
      instructionLines.push(`   - preferred display name: ${values.name}`)
    }

    if (strategyInfo && agents.length > 1) {
      instructionLines.push(
        `2. Coordinate execution using the ${strategyInfo.label} approach (${strategyInfo.description}).`,
        "3. Each subagent must call complete_task when finished.",
      )
    } else {
      instructionLines.push(
        "2. Start immediately without asking clarifying questions.",
        "3. Call complete_task when work is finished.",
      )
    }

    instructionLines.push("", "Run the add_task tool now.")

    try {
      console.log("[DialogSubagentAdd] Creating subagent(s):", {
        values,
        agents,
        strategy: strategyValue,
      })

      await sdk.client.session.prompt({
        path: { id: props.sessionID },
        body: {
          parts: [
            {
              type: "text",
              text: instructionLines.join("\n"),
            },
          ],
        },
      })

      toast.show({
        variant: "success",
        message:
          agents.length === 1
            ? `Subagent request sent for ${agents[0]}`
            : `Subagent requests sent for ${agents.length} agents`,
      })
      dialog.clear()
    } catch (error) {
      console.error("[DialogSubagentAdd] Error:", error)
      toast.show({
        variant: "error",
        message: "Error creating subagent",
      })
      dialog.clear()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between" alignItems="center">
        <text attributes={TextAttributes.BOLD}>Create Subagent</text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <For each={FIELD_CONFIG}>
        {(field, index) => {
          const isFocused = () => focusedIndex() === index()
          return (
            <box gap={0}>
              <text fg={theme.text}>
                {field.label}
                {field.required && <span style={{ fg: theme.error }}> *</span>}
                {isFocused() && <span style={{ fg: theme.accent }}> ← focused</span>}
              </text>
              <box>
                <textarea
                  ref={(val: TextareaRenderable) => {
                    textareas[field.name] = val
                  }}
                  initialValue={field.initialValue ?? ""}
                  placeholder={field.placeholder}
                />
              </box>
            </box>
          )
        }}
      </For>

      <box gap={0}>
        <text fg={theme.text}>Agents</text>
        <text fg={theme.textMuted}>Tick the agents that should run this task.</text>
        <box padding={1} backgroundColor={theme.backgroundElement}>
          <scrollbox height={12} scrollbarOptions={{ visible: false }}>
            <Show when={agentOptions().length > 0} fallback={<text fg={theme.textMuted}>No agents available.</text>}>
              <For each={agentOptions()}>
                {(agent) => {
                  const isSelected = createMemo(() => selectedAgents().has(agent.name))
                  return (
                    <box flexDirection="column" paddingBottom={1} onMouseUp={() => toggleAgent(agent.name)}>
                      <text fg={isSelected() ? theme.accent : theme.text}>
                        {isSelected() ? "[x]" : "[ ]"} @{agent.name}
                        <span style={{ fg: theme.textMuted }}>
                          {agent.mode ? ` • ${agent.mode}` : ""}
                          {agent.builtIn ? " • built-in" : ""}
                        </span>
                      </text>
                      <Show when={agent.description}>
                        <text fg={theme.textMuted} wrapMode="word">
                          {agent.description}
                        </text>
                      </Show>
                    </box>
                  )
                }}
              </For>
            </Show>
          </scrollbox>
        </box>
      </box>

      <Show when={multiSelection()}>
        <box gap={0}>
          <text fg={theme.text}>Collaboration Strategy</text>
          <text fg={theme.textMuted}>Choose how multiple agents should coordinate.</text>
          <box flexDirection="column" gap={0}>
            <For each={COLLAB_OPTIONS}>
              {(option) => {
                const active = createMemo(() => strategy() === option.value)
                return (
                  <text fg={active() ? theme.accent : theme.text} onMouseUp={() => setStrategy(option.value)}>
                    {active() ? "(●)" : "(○)"} {option.label} — {option.hint}
                    <span style={{ fg: theme.textMuted }}> · {option.description}</span>
                  </text>
                )
              }}
            </For>
          </box>
        </box>
      </Show>

      <text fg={selectedAgentList().length ? theme.textMuted : theme.error}>
        {selectedAgentList().length
          ? `${selectedAgentList().length} agent${selectedAgentList().length === 1 ? "" : "s"} selected`
          : "Select at least one agent."}
      </text>

      <box paddingTop={1}>
        <text fg={readyToSubmit() ? theme.text : theme.textMuted}>
          Ctrl+Enter to create subagent{multiSelection() ? "s" : ""} • Click agents to toggle selection
        </text>
      </box>
    </box>
  )
}
