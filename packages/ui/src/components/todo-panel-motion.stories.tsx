// @ts-nocheck
import { createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
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
    const [cfg, setCfg] = createStore({
      open: true,
      step: 1,
      dockOpenDuration: 0.3,
      dockOpenBounce: 0,
      dockCloseDuration: 0.3,
      dockCloseBounce: 0,
      drawerExpandDuration: 0.3,
      drawerExpandBounce: 0,
      drawerCollapseDuration: 0.3,
      drawerCollapseBounce: 0,
      subtitleDuration: 600,
      subtitleAuto: true,
      subtitleTravel: 25,
      subtitleEdge: 17,
      countDuration: 600,
      countMask: 18,
      countMaskHeight: 0,
      countWidthDuration: 560,
    })
    const open = () => cfg.open
    const step = () => cfg.step
    const dockOpenDuration = () => cfg.dockOpenDuration
    const dockOpenBounce = () => cfg.dockOpenBounce
    const dockCloseDuration = () => cfg.dockCloseDuration
    const dockCloseBounce = () => cfg.dockCloseBounce
    const drawerExpandDuration = () => cfg.drawerExpandDuration
    const drawerExpandBounce = () => cfg.drawerExpandBounce
    const drawerCollapseDuration = () => cfg.drawerCollapseDuration
    const drawerCollapseBounce = () => cfg.drawerCollapseBounce
    const subtitleDuration = () => cfg.subtitleDuration
    const subtitleAuto = () => cfg.subtitleAuto
    const subtitleTravel = () => cfg.subtitleTravel
    const subtitleEdge = () => cfg.subtitleEdge
    const countDuration = () => cfg.countDuration
    const countMask = () => cfg.countMask
    const countMaskHeight = () => cfg.countMaskHeight
    const countWidthDuration = () => cfg.countWidthDuration
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
      setCfg("open", true)
      frame = requestAnimationFrame(() => {
        pin()
        frame = undefined
      })
    }

    const closeDock = () => {
      clear()
      setCfg("open", false)
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
      setCfg("step", (value) => (value + 1) % 4)
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
                    dockOpenVisualDuration={dockOpenDuration()}
                    dockOpenBounce={dockOpenBounce()}
                    dockCloseVisualDuration={dockCloseDuration()}
                    dockCloseBounce={dockCloseBounce()}
                    drawerExpandVisualDuration={drawerExpandDuration()}
                    drawerExpandBounce={drawerExpandBounce()}
                    drawerCollapseVisualDuration={drawerCollapseDuration()}
                    drawerCollapseBounce={drawerCollapseBounce()}
                    subtitleDuration={subtitleDuration()}
                    subtitleTravel={subtitleAuto() ? undefined : subtitleTravel()}
                    subtitleEdge={subtitleAuto() ? undefined : subtitleEdge()}
                    countDuration={countDuration()}
                    countMask={countMask()}
                    countMaskHeight={countMaskHeight()}
                    countWidthDuration={countWidthDuration()}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
          <button onClick={toggleDock} style={btn(dockOpen())}>
            {dockOpen() ? "Animate close" : "Animate open"}
          </button>
          <button onClick={toggleDrawer} style={btn(dockOpen() && collapsed())}>
            {dockOpen() && collapsed() ? "Expand todo dock" : "Collapse todo dock"}
          </button>
          <button onClick={cycle} style={btn(step() > 0)}>
            Cycle progress ({step()}/3 done)
          </button>
          {[0, 1, 2, 3].map((value) => (
            <button onClick={() => setCfg("step", value)} style={btn(step() === value)}>
              {value} done
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gap: "10px", "max-width": "560px" }}>
          <div style={{ "font-size": "12px", color: "var(--color-text-secondary, #a3a3a3)" }}>Dock open</div>
          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={{ width: "110px", "font-size": "13px", color: "var(--color-text-secondary, #a3a3a3)" }}>
              duration
            </span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.01"
              value={dockOpenDuration()}
              onInput={(event) => setCfg("dockOpenDuration", event.currentTarget.valueAsNumber)}
              style={{ flex: 1 }}
            />
            <span style={{ width: "64px", "text-align": "right", "font-size": "13px" }}>
              {Math.round(dockOpenDuration() * 1000)}ms
            </span>
          </label>
          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={{ width: "110px", "font-size": "13px", color: "var(--color-text-secondary, #a3a3a3)" }}>
              bounce
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={dockOpenBounce()}
              onInput={(event) => setCfg("dockOpenBounce", event.currentTarget.valueAsNumber)}
              style={{ flex: 1 }}
            />
            <span style={{ width: "64px", "text-align": "right", "font-size": "13px" }}>
              {dockOpenBounce().toFixed(2)}
            </span>
          </label>

          <div style={{ "font-size": "12px", color: "var(--color-text-secondary, #a3a3a3)", "margin-top": "4px" }}>
            Dock close
          </div>
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
              onInput={(event) => setCfg("dockCloseDuration", event.currentTarget.valueAsNumber)}
              style={{ flex: 1 }}
            />
            <span style={{ width: "64px", "text-align": "right", "font-size": "13px" }}>
              {Math.round(dockCloseDuration() * 1000)}ms
            </span>
          </label>
          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={{ width: "110px", "font-size": "13px", color: "var(--color-text-secondary, #a3a3a3)" }}>
              bounce
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={dockCloseBounce()}
              onInput={(event) => setCfg("dockCloseBounce", event.currentTarget.valueAsNumber)}
              style={{ flex: 1 }}
            />
            <span style={{ width: "64px", "text-align": "right", "font-size": "13px" }}>
              {dockCloseBounce().toFixed(2)}
            </span>
          </label>

          <div style={{ "font-size": "12px", color: "var(--color-text-secondary, #a3a3a3)", "margin-top": "4px" }}>
            Drawer expand
          </div>
          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={{ width: "110px", "font-size": "13px", color: "var(--color-text-secondary, #a3a3a3)" }}>
              duration
            </span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.01"
              value={drawerExpandDuration()}
              onInput={(event) => setCfg("drawerExpandDuration", event.currentTarget.valueAsNumber)}
              style={{ flex: 1 }}
            />
            <span style={{ width: "64px", "text-align": "right", "font-size": "13px" }}>
              {Math.round(drawerExpandDuration() * 1000)}ms
            </span>
          </label>
          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={{ width: "110px", "font-size": "13px", color: "var(--color-text-secondary, #a3a3a3)" }}>
              bounce
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={drawerExpandBounce()}
              onInput={(event) => setCfg("drawerExpandBounce", event.currentTarget.valueAsNumber)}
              style={{ flex: 1 }}
            />
            <span style={{ width: "64px", "text-align": "right", "font-size": "13px" }}>
              {drawerExpandBounce().toFixed(2)}
            </span>
          </label>

          <div style={{ "font-size": "12px", color: "var(--color-text-secondary, #a3a3a3)", "margin-top": "4px" }}>
            Drawer collapse
          </div>
          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={{ width: "110px", "font-size": "13px", color: "var(--color-text-secondary, #a3a3a3)" }}>
              duration
            </span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.01"
              value={drawerCollapseDuration()}
              onInput={(event) => setCfg("drawerCollapseDuration", event.currentTarget.valueAsNumber)}
              style={{ flex: 1 }}
            />
            <span style={{ width: "64px", "text-align": "right", "font-size": "13px" }}>
              {Math.round(drawerCollapseDuration() * 1000)}ms
            </span>
          </label>
          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={{ width: "110px", "font-size": "13px", color: "var(--color-text-secondary, #a3a3a3)" }}>
              bounce
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={drawerCollapseBounce()}
              onInput={(event) => setCfg("drawerCollapseBounce", event.currentTarget.valueAsNumber)}
              style={{ flex: 1 }}
            />
            <span style={{ width: "64px", "text-align": "right", "font-size": "13px" }}>
              {drawerCollapseBounce().toFixed(2)}
            </span>
          </label>

          <div style={{ "font-size": "12px", color: "var(--color-text-secondary, #a3a3a3)", "margin-top": "4px" }}>
            Subtitle odometer
          </div>
          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={{ width: "110px", "font-size": "13px", color: "var(--color-text-secondary, #a3a3a3)" }}>
              duration
            </span>
            <input
              type="range"
              min="120"
              max="1400"
              step="10"
              value={subtitleDuration()}
              onInput={(event) => setCfg("subtitleDuration", event.currentTarget.valueAsNumber)}
              style={{ flex: 1 }}
            />
            <span style={{ width: "64px", "text-align": "right", "font-size": "13px" }}>
              {Math.round(subtitleDuration())}ms
            </span>
          </label>
          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={{ width: "110px", "font-size": "13px", color: "var(--color-text-secondary, #a3a3a3)" }}>
              auto fit
            </span>
            <input
              type="checkbox"
              checked={subtitleAuto()}
              onInput={(event) => setCfg("subtitleAuto", event.currentTarget.checked)}
            />
            <span style={{ width: "64px", "text-align": "right", "font-size": "13px" }}>
              {subtitleAuto() ? "on" : "off"}
            </span>
          </label>
          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={{ width: "110px", "font-size": "13px", color: "var(--color-text-secondary, #a3a3a3)" }}>
              travel
            </span>
            <input
              type="range"
              min="0"
              max="40"
              step="1"
              value={subtitleTravel()}
              onInput={(event) => setCfg("subtitleTravel", event.currentTarget.valueAsNumber)}
              style={{ flex: 1 }}
            />
            <span style={{ width: "64px", "text-align": "right", "font-size": "13px" }}>{subtitleTravel()}px</span>
          </label>
          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={{ width: "110px", "font-size": "13px", color: "var(--color-text-secondary, #a3a3a3)" }}>
              edge
            </span>
            <input
              type="range"
              min="1"
              max="40"
              step="1"
              value={subtitleEdge()}
              onInput={(event) => setCfg("subtitleEdge", event.currentTarget.valueAsNumber)}
              style={{ flex: 1 }}
            />
            <span style={{ width: "64px", "text-align": "right", "font-size": "13px" }}>{subtitleEdge()}%</span>
          </label>

          <div style={{ "font-size": "12px", color: "var(--color-text-secondary, #a3a3a3)", "margin-top": "4px" }}>
            Count odometer
          </div>
          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={{ width: "110px", "font-size": "13px", color: "var(--color-text-secondary, #a3a3a3)" }}>
              duration
            </span>
            <input
              type="range"
              min="120"
              max="1400"
              step="10"
              value={countDuration()}
              onInput={(event) => setCfg("countDuration", event.currentTarget.valueAsNumber)}
              style={{ flex: 1 }}
            />
            <span style={{ width: "64px", "text-align": "right", "font-size": "13px" }}>
              {Math.round(countDuration())}ms
            </span>
          </label>
          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={{ width: "110px", "font-size": "13px", color: "var(--color-text-secondary, #a3a3a3)" }}>
              mask
            </span>
            <input
              type="range"
              min="4"
              max="40"
              step="1"
              value={countMask()}
              onInput={(event) => setCfg("countMask", event.currentTarget.valueAsNumber)}
              style={{ flex: 1 }}
            />
            <span style={{ width: "64px", "text-align": "right", "font-size": "13px" }}>{countMask()}%</span>
          </label>
          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={{ width: "110px", "font-size": "13px", color: "var(--color-text-secondary, #a3a3a3)" }}>
              mask height
            </span>
            <input
              type="range"
              min="0"
              max="14"
              step="1"
              value={countMaskHeight()}
              onInput={(event) => setCfg("countMaskHeight", event.currentTarget.valueAsNumber)}
              style={{ flex: 1 }}
            />
            <span style={{ width: "64px", "text-align": "right", "font-size": "13px" }}>{countMaskHeight()}px</span>
          </label>
          <label style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={{ width: "110px", "font-size": "13px", color: "var(--color-text-secondary, #a3a3a3)" }}>
              width spring
            </span>
            <input
              type="range"
              min="0"
              max="1200"
              step="10"
              value={countWidthDuration()}
              onInput={(event) => setCfg("countWidthDuration", event.currentTarget.valueAsNumber)}
              style={{ flex: 1 }}
            />
            <span style={{ width: "64px", "text-align": "right", "font-size": "13px" }}>
              {Math.round(countWidthDuration())}ms
            </span>
          </label>
        </div>
      </div>
    )
  },
}
