import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { createStore } from "solid-js/store"
import { Show, createMemo, onMount } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Spinner } from "./spinner"
import { Agent } from "@/agent/agent"
import { Instance } from "@/project/instance"
import { Global } from "@/global"
import { useLocal } from "@tui/context/local"
import path from "path"
import matter from "gray-matter"
import { Filesystem } from "@/util/filesystem"
import fs from "fs/promises"

type AgentMode = "all" | "primary" | "subagent"

const AVAILABLE_TOOLS = ["bash", "read", "write", "edit", "list", "glob", "grep", "webfetch", "task", "todowrite"]

export function DialogAgentCreate() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const local = useLocal()
  let textarea: TextareaRenderable

  const [store, setStore] = createStore({
    step: "description" as "description" | "generating" | "tools" | "mode" | "saving",
    location: "global" as "global" | "project",
    description: "",
    selectedTools: [...AVAILABLE_TOOLS],
    mode: "subagent" as AgentMode,
    generated: undefined as { identifier: string; whenToUse: string; systemPrompt: string } | undefined,
    error: undefined as string | undefined,
    activeToolIndex: 0,
  })

  const isGitProject = createMemo(() => Instance.project.vcs === "git")

  const targetPath = createMemo(() => {
    if (store.location === "global") {
      return path.join(Global.Path.config, "agent")
    }
    return path.join(Instance.worktree, ".opencode", "agent")
  })

  useKeyboard((evt) => {
    if (store.step === "generating" || store.step === "saving") {
      if (evt.name === "escape") evt.preventDefault()
      return
    }

    if (store.step === "description") {
      if (evt.name === "return") {
        if (store.description.trim().length > 0) {
          startGeneration()
        }
      }
      if (evt.name === "escape") {
        dialog.clear()
      }
      return
    }

    if (store.step === "tools") {
      if (evt.name === "up") {
        setStore("activeToolIndex", Math.max(0, store.activeToolIndex - 1))
        evt.preventDefault()
      }
      if (evt.name === "down") {
        setStore("activeToolIndex", Math.min(AVAILABLE_TOOLS.length - 1, store.activeToolIndex + 1))
        evt.preventDefault()
      }
      if (evt.name === "space" || evt.name === " ") {
        const tool = AVAILABLE_TOOLS[store.activeToolIndex]
        if (store.selectedTools.includes(tool)) {
          setStore("selectedTools", store.selectedTools.filter((t) => t !== tool))
        } else {
          setStore("selectedTools", [...store.selectedTools, tool])
        }
        evt.preventDefault()
      }
      if (evt.name === "return") {
        setStore("step", "mode")
        evt.preventDefault()
      }
      if (evt.name === "escape") {
        setStore("step", "description")
        evt.preventDefault()
      }
      return
    }

    if (store.step === "mode") {
      if (evt.name === "up" || evt.name === "down") {
        const modes: AgentMode[] = ["all", "primary", "subagent"]
        const currentIndex = modes.indexOf(store.mode)
        const nextIndex = evt.name === "up"
          ? (currentIndex - 1 + modes.length) % modes.length
          : (currentIndex + 1) % modes.length
        setStore("mode", modes[nextIndex])
        evt.preventDefault()
      }
      if (evt.name === "return") {
        saveAgent()
        evt.preventDefault()
      }
      if (evt.name === "escape") {
        setStore("step", "tools")
        evt.preventDefault()
      }
      return
    }
  })

  async function startGeneration() {
    setStore("step", "generating")
    setStore("error", undefined)

    try {
      const generated = await Agent.generate({ description: store.description })
      setStore("generated", generated)
      setStore("step", "tools")
    } catch (error) {
      setStore("error", error instanceof Error ? error.message : "Failed to generate agent")
      setStore("step", "description")
    }
  }

  async function saveAgent() {
    if (!store.generated) return

    setStore("step", "saving")

    try {
      const tools: Record<string, boolean> = {}
      for (const tool of AVAILABLE_TOOLS) {
        if (!store.selectedTools.includes(tool)) {
          tools[tool] = false
        }
      }

      const frontmatter: {
        description: string
        mode: AgentMode
        tools?: Record<string, boolean>
      } = {
        description: store.generated.whenToUse,
        mode: store.mode,
      }
      if (Object.keys(tools).length > 0) {
        frontmatter.tools = tools
      }

      const content = matter.stringify(store.generated.systemPrompt, frontmatter)
      const filePath = path.join(targetPath(), `${store.generated.identifier}.md`)

      await fs.mkdir(targetPath(), { recursive: true })

      // Check if file exists
      if (await Filesystem.exists(filePath)) {
        setStore("error", `Agent file already exists: ${filePath}`)
        setStore("step", "mode")
        return
      }

      await Filesystem.write(filePath, content)

      // Switch to the new agent
      local.agent.set(store.generated.identifier)
      dialog.clear()
    } catch (error) {
      setStore("error", error instanceof Error ? error.message : "Failed to save agent")
      setStore("step", "mode")
    }
  }

  onMount(() => {
    dialog.setSize("large")
    setTimeout(() => {
      if (!textarea || textarea.isDestroyed) return
      if (store.step === "description") {
        textarea.focus()
        textarea.gotoLineEnd()
      }
    }, 1)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Create Agent
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      {/* Location selection - only for git projects */}
      <Show when={store.step === "description" && isGitProject()}>
        <box gap={1} paddingTop={1}>
          <text fg={theme.textMuted}>Location</text>
          <box flexDirection="column" gap={1}>
            <box
              flexDirection="row"
              gap={2}
              paddingLeft={1}
              backgroundColor={store.location === "project" ? theme.backgroundElement : undefined}
              onMouseUp={() => setStore("location", "project")}
            >
              <text fg={store.location === "project" ? theme.primary : theme.textMuted}>
                {store.location === "project" ? "[x]" : "[ ]"}
              </text>
              <text fg={store.location === "project" ? theme.primary : theme.text}>Current project</text>
              <text fg={theme.textMuted}>({Instance.worktree})</text>
            </box>
            <box
              flexDirection="row"
              gap={2}
              paddingLeft={1}
              backgroundColor={store.location === "global" ? theme.backgroundElement : undefined}
              onMouseUp={() => setStore("location", "global")}
            >
              <text fg={store.location === "global" ? theme.primary : theme.textMuted}>
                {store.location === "global" ? "[x]" : "[ ]"}
              </text>
              <text fg={store.location === "global" ? theme.primary : theme.text}>Global</text>
              <text fg={theme.textMuted}>({Global.Path.config})</text>
            </box>
          </box>
        </box>
      </Show>

      {/* Description input */}
      <Show when={store.step === "description"}>
        <box gap={1} paddingTop={1}>
          <text fg={theme.text}>What should this agent do?</text>
          <textarea
            onSubmit={() => {
              if (store.description.trim().length > 0) startGeneration()
            }}
            height={3}
            keyBindings={[{ name: "return", action: "submit" }]}
            ref={(val: TextareaRenderable) => (textarea = val)}
            initialValue={store.description}
            placeholder="e.g., Review code for security issues"
            placeholderColor={theme.textMuted}
            textColor={theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.text}
            onInput={(e) => setStore("description", e)}
          />
        </box>
        <text fg={theme.textMuted}>Press enter to generate agent configuration</text>
      </Show>

      {/* Generating spinner */}
      <Show when={store.step === "generating"}>
        <box paddingTop={2}>
          <Spinner color={theme.text}>Generating agent configuration...</Spinner>
        </box>
      </Show>

      {/* Tools selection */}
      <Show when={store.step === "tools" && store.generated}>
        <box gap={1} paddingTop={1}>
          <text fg={theme.textMuted}>Agent: {store.generated!.identifier}</text>
          <text fg={theme.text}>Select tools to enable (space to toggle)</text>
          <box flexDirection="column" gap={0}>
            {AVAILABLE_TOOLS.map((tool, index) => {
              const enabled = store.selectedTools.includes(tool)
              const active = store.activeToolIndex === index
              return (
                <box
                  flexDirection="row"
                  gap={2}
                  paddingLeft={1}
                  backgroundColor={active ? theme.backgroundElement : undefined}
                  onMouseUp={() => {
                    if (enabled) {
                      setStore("selectedTools", store.selectedTools.filter((t) => t !== tool))
                    } else {
                      setStore("selectedTools", [...store.selectedTools, tool])
                    }
                  }}
                  onMouseOver={() => setStore("activeToolIndex", index)}
                >
                  <text fg={active ? theme.primary : theme.textMuted}>{enabled ? "[x]" : "[ ]"}</text>
                  <text fg={active ? theme.primary : theme.text}>{tool}</text>
                </box>
              )
            })}
          </box>
        </box>
        <text fg={theme.textMuted}>Press enter to continue, escape to go back</text>
      </Show>

      {/* Mode selection */}
      <Show when={store.step === "mode"}>
        <box gap={1} paddingTop={1}>
          <text fg={theme.textMuted}>Agent: {store.generated!.identifier}</text>
          <text fg={theme.text}>Select agent mode</text>
          <box flexDirection="column" gap={1}>
            {(
              [
                { value: "all" as AgentMode, label: "All", hint: "Can function in both primary and subagent roles" },
                { value: "primary" as AgentMode, label: "Primary", hint: "Acts as a primary/main agent" },
                { value: "subagent" as AgentMode, label: "Subagent", hint: "Can be used as a subagent by other agents" },
              ] as const
            ).map((item) => {
              const active = store.mode === item.value
              return (
                <box
                  flexDirection="row"
                  gap={2}
                  paddingLeft={1}
                  backgroundColor={active ? theme.backgroundElement : undefined}
                  onMouseUp={() => setStore("mode", item.value)}
                >
                  <text fg={active ? theme.primary : theme.textMuted}>{active ? "●" : "○"}</text>
                  <text fg={active ? theme.primary : theme.text}>{item.label}</text>
                  <text fg={theme.textMuted}>- {item.hint}</text>
                </box>
              )
            })}
          </box>
        </box>
        <text fg={theme.textMuted}>Press enter to create agent, escape to go back</text>
      </Show>

      {/* Saving spinner */}
      <Show when={store.step === "saving"}>
        <box paddingTop={2}>
          <Spinner color={theme.text}>Saving agent...</Spinner>
        </box>
      </Show>

      {/* Error display */}
      <Show when={store.error}>
        <box paddingTop={1}>
          <text fg={theme.error}>Error: {store.error}</text>
        </box>
      </Show>
    </box>
  )
}
