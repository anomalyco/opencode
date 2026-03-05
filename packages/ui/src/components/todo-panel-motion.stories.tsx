// @ts-nocheck
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { Todo } from "@opencode-ai/sdk/v2"
import { useGlobalSync } from "@/context/global-sync"
import { SessionComposerRegion, createSessionComposerState } from "@/pages/session/composer"

export default {
  title: "UI/Todo Panel Motion",
  id: "components-todo-panel-motion",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: `### Overview
This playground renders the real session composer region from app code.

### Source path
- \`packages/app/src/pages/session/composer/session-composer-region.tsx\`

### Includes
- \`SessionTodoDock\` (real)
- \`PromptInput\` (real)

No visual reimplementation layer is used for the dock/input stack.`,
      },
    },
  },
}

const pool = [
  "Refactor ToolStatusTitle DOM measurement to offscreen global measurer (unconstrained by timeline layout)",
  "Remove inline measure nodes/CSS hooks and keep width morph behavior intact",
  "Run typechecks/tests and report what changed",
  "Verify reduced-motion behavior in timeline",
  "Review diff for animation edge cases",
  "Document rollout notes in PR description",
  "Check keyboard and screen reader semantics",
  "Add storybook controls for iteration speed",
]

const btn = (accent?: boolean) =>
  ({
    padding: "6px 14px",
    "border-radius": "6px",
    border: "1px solid var(--color-divider, #333)",
    background: accent ? "var(--color-accent, #58f)" : "var(--color-fill-element, #222)",
    color: "var(--color-text, #eee)",
    cursor: "pointer",
    "font-size": "13px",
  }) as const

const css = `
[data-component="todo-stage"] {
  display: grid;
  gap: 20px;
  padding: 20px;
}

[data-component="todo-preview"] {
  height: 560px;
  min-height: 0;
}

[data-component="todo-session-root"] {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--background-base);
  border: 1px solid var(--border-weak-base);
  border-radius: 12px;
}

[data-component="todo-session-frame"] {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

[data-component="todo-session-panel"] {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--background-stronger);
}

[data-slot="todo-preview-content"] {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

[data-slot="todo-preview-scroll"] {
  height: 100%;
  overflow: auto;
  min-height: 0;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

[data-slot="todo-preview-spacer"] {
  flex: 1 1 auto;
  min-height: 0;
}

[data-slot="todo-preview-msg"] {
  border-radius: 8px;
  border: 1px solid var(--border-weak-base);
  background: var(--surface-base);
  color: var(--text-weak);
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.35;
}

[data-slot="todo-preview-msg"][data-strong="true"] {
  color: var(--text-strong);
}
`

export const Playground = {
  render: () => {
    const global = useGlobalSync()
    const [open, setOpen] = createSignal(true)
    const [step, setStep] = createSignal(1)
    const [dockCloseDuration, setDockCloseDuration] = createSignal(0.3)
    const state = createSessionComposerState({ closeMs: () => Math.round(dockCloseDuration() * 1000) })
    let frame
    let composerRef
    let scrollRef

    const todos = createMemo<Todo[]>(() => {
      const done = Math.max(0, Math.min(3, step()))
      return pool.slice(0, 3).map((content, i) => ({
        id: `todo-${i + 1}`,
        content,
        status: i < done ? "completed" : i === done && done < 3 ? "in_progress" : "pending",
      }))
    })

    createEffect(() => {
      global.todo.set("story-session", todos())
    })

    const clear = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = undefined
    }

    const pin = () => {
      if (!scrollRef) return
      scrollRef.scrollTop = scrollRef.scrollHeight
    }

    const collapsed = () =>
      !!composerRef?.querySelector('[data-action="session-todo-toggle-button"][data-collapsed="true"]')

    const setCollapsed = (value: boolean) => {
      const button = composerRef?.querySelector('[data-action="session-todo-toggle-button"]')
      if (!(button instanceof HTMLButtonElement)) return
      if (collapsed() === value) return
      button.click()
    }

    const openDock = () => {
      clear()
      setOpen(true)
      frame = requestAnimationFrame(() => {
        pin()
        frame = undefined
      })
    }

    const closeDock = () => {
      clear()
      setOpen(false)
    }

    const dockOpen = () => open()

    const toggleDock = () => {
      if (dockOpen()) {
        closeDock()
        return
      }
      openDock()
    }

    const toggleDrawer = () => {
      if (!dockOpen()) {
        openDock()
        frame = requestAnimationFrame(() => {
          pin()
          setCollapsed(true)
          frame = undefined
        })
        return
      }
      setCollapsed(!collapsed())
    }

    const cycle = () => {
      setStep((value) => (value + 1) % 4)
    }

    onCleanup(clear)

    return (
      <div data-component="todo-stage">
        <style>{css}</style>

        <div data-component="todo-preview">
          <div data-component="todo-session-root">
            <div data-component="todo-session-frame">
              <div data-component="todo-session-panel">
                <div data-slot="todo-preview-content">
                  <div data-slot="todo-preview-scroll" class="scroll-view__viewport" ref={scrollRef}>
                    <div data-slot="todo-preview-spacer" />
                    <div data-slot="todo-preview-msg" data-strong="true">
                      Thinking Checking type safety
                    </div>
                    <div data-slot="todo-preview-msg">Shell Prints five topic blocks between timed commands</div>
                  </div>
                </div>

                <div ref={composerRef}>
                  <SessionComposerRegion
                    state={state}
                    centered={false}
                    inputRef={() => {}}
                    newSessionWorktree=""
                    onNewSessionWorktreeReset={() => {}}
                    onSubmit={() => {}}
                    onResponseSubmit={pin}
                    setPromptDockRef={() => {}}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
          {(
            [
              ["Toggle dock", toggleDock],
              ["Toggle drawer", toggleDrawer],
              ["Cycle todos", cycle],
            ] as const
          ).map(([label, fn]) => (
            <button type="button" style={btn()} onClick={fn}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gap: "10px", "max-width": "560px" }}>
          <div style={{ "font-size": "12px", color: "var(--color-text-secondary, #a3a3a3)" }}>Dock close</div>
          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={{ width: "110px", "font-size": "13px", color: "var(--color-text-secondary, #a3a3a3)" }}>
              duration
            </span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.01"
              value={dockCloseDuration()}
              onInput={(event) => setDockCloseDuration(event.currentTarget.valueAsNumber)}
              style={{ flex: 1 }}
            />
            <span style={{ width: "64px", "text-align": "right", "font-size": "13px" }}>
              {Math.round(dockCloseDuration() * 1000)}ms
            </span>
          </label>
        </div>
      </div>
    )
  },
}
