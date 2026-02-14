/**
 * Terminal Settings Component
 *
 * Allows users to configure terminal launch commands for Claude, Codex, etc.
 * Also supports custom commands that appear in the "more" dropdown.
 */

import { Component, createEffect, createSignal, Index, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { showToast } from "@opencode-ai/ui/toast"

// Storage key for terminal commands
const TERMINAL_COMMANDS_KEY = "claxedo.terminalCommands"

// Default commands
const DEFAULT_COMMANDS = {
  claude: "claude --dangerously-skip-permissions",
  codex: 'codex -c model_reasoning_effort="high" --ask-for-approval never --sandbox danger-full-access',
}

export type CustomCommand = {
  id: string
  name: string
  command: string
}

export type TerminalCommands = {
  claude: string
  codex: string
  custom: CustomCommand[]
}

// Get terminal commands from storage
export function getTerminalCommands(): TerminalCommands {
  if (typeof localStorage === "undefined") return { ...DEFAULT_COMMANDS, custom: [] }
  try {
    const stored = localStorage.getItem(TERMINAL_COMMANDS_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return {
        claude: parsed.claude ?? DEFAULT_COMMANDS.claude,
        codex: parsed.codex ?? DEFAULT_COMMANDS.codex,
        custom: Array.isArray(parsed.custom) ? parsed.custom : [],
      }
    }
  } catch {
    // Ignore parse errors
  }
  return { ...DEFAULT_COMMANDS, custom: [] }
}

// Save terminal commands to storage
function saveTerminalCommands(commands: TerminalCommands) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(TERMINAL_COMMANDS_KEY, JSON.stringify(commands))
}

// Generate unique ID
function generateId() {
  return Math.random().toString(36).substring(2, 9)
}

export const SettingsTerminals: Component = () => {
  const initial = getTerminalCommands()
  const [claudeCommand, setClaudeCommand] = createSignal(initial.claude)
  const [codexCommand, setCodexCommand] = createSignal(initial.codex)
  const [customCommands, setCustomCommands] = createStore<CustomCommand[]>(initial.custom)
  const [hasChanges, setHasChanges] = createSignal(false)

  // Track changes
  createEffect(() => {
    const current = getTerminalCommands()
    const customChanged = JSON.stringify(customCommands) !== JSON.stringify(current.custom)
    const changed = claudeCommand() !== current.claude || codexCommand() !== current.codex || customChanged
    setHasChanges(changed)
  })

  const handleSave = () => {
    saveTerminalCommands({
      claude: claudeCommand(),
      codex: codexCommand(),
      custom: [...customCommands],
    })
    setHasChanges(false)
    showToast({
      variant: "success",
      icon: "circle-check",
      title: "Terminal commands saved",
      description: "Your terminal command settings have been updated.",
    })
  }

  const handleReset = () => {
    setClaudeCommand(DEFAULT_COMMANDS.claude)
    setCodexCommand(DEFAULT_COMMANDS.codex)
    setCustomCommands([])
  }

  let newCommandInputRef: HTMLInputElement | undefined

  const addCustomCommand = () => {
    const newId = generateId()
    setCustomCommands(customCommands.length, { id: newId, name: "", command: "" })
    // Focus the new name input after render
    requestAnimationFrame(() => {
      newCommandInputRef?.focus()
    })
  }

  const updateCustomCommand = (index: number, field: "name" | "command", value: string) => {
    setCustomCommands(index, field, value)
  }

  const removeCustomCommand = (index: number) => {
    setCustomCommands(produce((cmds) => cmds.splice(index, 1)))
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-raised-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">Terminals</h2>
          <p class="text-12-regular text-text-weak">
            Configure the commands used when launching terminal sessions.
          </p>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        {/* Default Commands Section */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">Default Commands</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            {/* Claude Command */}
            <div class="flex flex-col gap-2 py-3 border-b border-border-weak-base">
              <div class="flex flex-col gap-0.5">
                <span class="text-14-medium text-text-strong">Claude Command</span>
                <span class="text-12-regular text-text-weak">Command for the C quick-launch button</span>
              </div>
              <input
                id="claude-command"
                type="text"
                value={claudeCommand()}
                onInput={(e: InputEvent) => setClaudeCommand((e.target as HTMLInputElement).value)}
                placeholder="claude --dangerously-skip-permissions"
                class="w-full px-3 py-2 bg-surface-base border border-border-base rounded-md text-text-base font-mono text-sm focus:outline-none focus:border-border-strong"
              />
            </div>

            {/* Codex Command */}
            <div class="flex flex-col gap-2 py-3">
              <div class="flex flex-col gap-0.5">
                <span class="text-14-medium text-text-strong">Codex Command</span>
                <span class="text-12-regular text-text-weak">Command for the X quick-launch button</span>
              </div>
              <input
                id="codex-command"
                type="text"
                value={codexCommand()}
                onInput={(e: InputEvent) => setCodexCommand((e.target as HTMLInputElement).value)}
                placeholder="codex ..."
                class="w-full px-3 py-2 bg-surface-base border border-border-base rounded-md text-text-base font-mono text-sm focus:outline-none focus:border-border-strong"
              />
            </div>
          </div>
        </div>

        {/* Custom Commands Section */}
        <div class="flex flex-col gap-1">
          <div class="flex items-center justify-between pb-2">
            <div class="flex flex-col gap-0.5">
              <h3 class="text-14-medium text-text-strong">Custom Commands</h3>
              <p class="text-12-regular text-text-weak">
                Add custom commands that appear in the dropdown menu.
              </p>
            </div>
            <Button size="small" variant="secondary" icon="plus-small" onClick={addCustomCommand}>
              Add
            </Button>
          </div>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <Show
              when={customCommands.length > 0}
              fallback={
                <div class="py-4 text-14-regular text-text-weak">
                  No custom commands yet.
                </div>
              }
            >
              <Index each={customCommands}>
                {(cmd, index) => (
                  <div class="flex gap-3 items-start py-3 border-b border-border-weak-base last:border-none">
                    <div class="flex flex-col gap-2 flex-1 min-w-0">
                      <input
                        ref={(el) => {
                          if (index === customCommands.length - 1) {
                            newCommandInputRef = el
                          }
                        }}
                        type="text"
                        value={cmd().name}
                        onInput={(e: InputEvent) => updateCustomCommand(index, "name", (e.target as HTMLInputElement).value)}
                        placeholder="Command name (e.g., Aider)"
                        class="w-full px-3 py-2 bg-surface-base border border-border-base rounded-md text-text-base text-sm focus:outline-none focus:border-border-strong"
                      />
                      <input
                        type="text"
                        value={cmd().command}
                        onInput={(e: InputEvent) => updateCustomCommand(index, "command", (e.target as HTMLInputElement).value)}
                        placeholder="Command to run (e.g., aider --model gpt-4)"
                        class="w-full px-3 py-2 bg-surface-base border border-border-base rounded-md text-text-base font-mono text-sm focus:outline-none focus:border-border-strong"
                      />
                    </div>
                    <IconButton
                      icon="trash"
                      variant="ghost"
                      class="shrink-0 mt-1.5 text-text-weak hover:text-text-danger"
                      onClick={() => removeCustomCommand(index)}
                      aria-label="Remove command"
                    />
                  </div>
                )}
              </Index>
            </Show>
          </div>
        </div>

        {/* Actions */}
        <div class="flex items-center gap-2">
          <Button size="small" variant="primary" onClick={handleSave} disabled={!hasChanges()}>
            Save Changes
          </Button>
          <Button size="small" variant="ghost" onClick={handleReset}>
            Reset to Defaults
          </Button>
        </div>
      </div>
    </div>
  )
}
