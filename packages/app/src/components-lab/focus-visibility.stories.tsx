import "@/settings/settings.css"
import "@/settings/workspaces/project.css"

import { Accordion } from "@opencode/ui/accordion"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { ProjectAvatar } from "@opencode/ui/project-avatar"
import { Select } from "@opencode/ui/select"
import { Switch } from "@opencode/ui/switch"
import { Tabs } from "@opencode/ui/tabs"
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { createTabStripScroll } from "@/runtime/plugin/tab-strip-scroll"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { SettingsSearchField } from "@/settings/search-field"
import { forceFocusStyles } from "./force-focus"

// Each case renders production components, markup and CSS inside the ancestor that hides its focus, at the size the
// audit found it. On open the target is marked focused with the lab copy of the production focus rules, and any scroller
// is left where the browser's own scroll-into-view puts it, as the keys do. Real keyboard focus takes over from there.

type Failure = "Occluded" | "Clipped" | "Invisible"

type Case = {
  name: string
  failure: Failure
  target: string
  keys: string
  sizing: string
  source: string
  // The scroller the keys start in and the edge it starts at, such as the end of a list Shift+Tab walks back up.
  from?: { scroller: string; edge: "start" | "end" }
  render: () => JSX.Element
}

type Surface = { name: string; cases: Case[]; also: string[] }

const schemes = ["lab", "light", "dark"] as const

type VisibilityArgs = { scheme: (typeof schemes)[number]; forced: boolean; locator: boolean }

const models = [
  "Claude Haiku 4.5",
  "Claude Opus 4.6",
  "Claude Sonnet 4.5",
  "GPT-5",
  "GPT-5 mini",
  "GPT-5.1 Codex",
  "Gemini 2.5 Flash",
  "Gemini 2.5 Pro",
  "Grok 4",
  "Kimi K2",
  "Qwen3 Coder",
]

const panelTabs = [
  "changes",
  ...Array.from({ length: 12 }, (_, index) => `source-${String(index + 1).padStart(2, "0")}.ts`),
]

const surfaces: Surface[] = [
  {
    name: "Timeline",
    cases: [
      {
        name: "Copy response: ring cut at the bottom by the virtual row",
        failure: "Clipped",
        target: '[aria-label="Copy response"]',
        keys: "Click the response text, press Tab.",
        sizing: "Any width (audited at 1100×800 and 390×680). The row clips at its measured height.",
        source:
          "app/src/session/timeline/virtualizer.tsx:1077–86 (overflow: clip, clip margin 0.5px), session-ui message-part.css:577–83",
        render: () => (
          <div style={{ width: "420px", position: "relative", overflow: "clip", "overflow-clip-margin": "0.5px" }}>
            <div data-component="text-part">
              <div data-slot="text-part-body">
                <div data-component="markdown">
                  <p>Historical response 8. Existing session content keeps the virtual timeline realistic.</p>
                </div>
              </div>
              <div data-slot="text-part-copy-wrapper">
                <IconButton
                  icon={<Icon name="copy" size="small" />}
                  size="small"
                  variant="ghost-muted"
                  aria-label="Copy response"
                />
                <span data-slot="text-part-meta">Build · Claude Opus 4.6 · 2s</span>
              </div>
            </div>
          </div>
        ),
      },
      {
        name: "Folded prompt: links lose their left edge, then scroll into the fade",
        failure: "Occluded",
        target: '[data-slot="user-message-link"][href$="deep"]',
        keys: "Click the first line of the prompt, press Tab: the first link's left stroke is cut. Press Tab again: the deep link scrolls into the 40px fade.",
        sizing:
          "Prompts over 12 lines fold to 8. The link has no authored focus rule, so its browser default ring shows only with real focus.",
        source: "session-ui message-part.css:221–230 (fold overflow: hidden, 40px mask), message-content.tsx:786",
        render: () => (
          <div data-component="user-message" style={{ width: "380px" }}>
            <div data-slot="user-message-text" dir="auto">
              <div data-slot="user-message-fold" data-folded style={{ "max-height": "8lh" }}>
                <div>
                  <a data-slot="user-message-link" href="https://example.com/start" target="_blank" rel="noreferrer">
                    https://example.com/start
                  </a>
                  {" is where the investigation began.\n"}
                  {Array.from({ length: 12 }, (_, index) => `This is context line ${index + 1}.\n`).join("")}
                  <a data-slot="user-message-link" href="https://example.com/deep" target="_blank" rel="noreferrer">
                    https://example.com/deep
                  </a>
                  {"\nThis is context line 14."}
                </div>
              </div>
              <button type="button" data-slot="user-message-fold-toggle" aria-expanded="false">
                <span>Read more</span>
                <Icon name="chevron-down" size="small" />
              </button>
            </div>
          </div>
        ),
      },
      {
        name: "Changed file row: no visible focus",
        failure: "Invisible",
        target: '[data-slot="accordion-trigger"]',
        keys: "Click above the list, press Tab.",
        sizing: "Any width. The trigger sets outline: none and nothing replaces it.",
        source: "ui/src/data-display/accordion/accordion.css:58",
        render: () => (
          <div style={{ width: "380px" }}>
            <Accordion collapsible>
              <Accordion.Item value="view">
                <Accordion.Header>
                  <Accordion.Trigger>packages/app/src/components/view.tsx</Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Content>+12 −3</Accordion.Content>
              </Accordion.Item>
            </Accordion>
          </div>
        ),
      },
    ],
    also: [
      "Shift+Tab from the session header's More actions to Copy response leaves it under the sticky header.",
      "The new timeline's command group loses the bottom of its shadow.",
      "The timeline ScrollView viewport and the diff viewer take focus with nothing visible.",
    ],
  },
  {
    name: "Right panel",
    cases: [
      {
        name: "Tab strip: End puts the last tab under the sticky Add tab",
        failure: "Occluded",
        target: '[data-pane-tab="source-12.ts"]',
        keys: "Click any tab, press Home, then End.",
        sizing: "Side panel 360px wide with 13 tabs open.",
        source:
          "app/src/runtime/plugin/side-region.tsx:333 (sticky +), ui tabs.css:605–621 (strip mask), tabs.css:100 (no ring)",
        from: { scroller: '[data-slot="tabs-list"]', edge: "start" },
        render: () => <TabStrip />,
      },
      {
        name: "Selected panel tab: no visible focus",
        failure: "Invisible",
        target: '[data-pane-tab="changes"]',
        keys: "From any tab, press Home.",
        sizing: "Any panel width.",
        source: "ui/src/navigation/tabs/tabs.css:100–103 (outline: none, box-shadow: none)",
        from: { scroller: '[data-slot="tabs-list"]', edge: "end" },
        render: () => <TabStrip />,
      },
    ],
    also: [
      "Review header at a 164px preview: Previous and Next overlap the line buttons, and Split diff is cut off.",
      "CSV preview at 80px: Copy content overflows the header.",
      "Line comment More options runs past the panel edge at 360px.",
      "Files and Review trees: ArrowDown from the selected file moves focus with no visible change (pierre-tree.tsx:41–42, 84–92).",
      "Git changes inline select, and the source and diff viewers: no visible focus (same pattern as the Language select below).",
    ],
  },
  {
    name: "Settings",
    cases: [
      {
        name: "Models: Shift+Tab hides the focused switch under the sticky header",
        failure: "Occluded",
        target: '[data-component="settings-row"]:nth-child(5) [data-slot="switch-input"]',
        keys: "Click the last row's name, then press Shift+Tab until a row scrolls up.",
        sizing: "Audited at 1280×800 and 390×680. The panel has no scroll padding for its sticky header.",
        source: "app/src/settings/settings.css:587–611 (.settings-panel, sticky .settings-tab-header)",
        from: { scroller: ".settings-panel", edge: "end" },
        render: () => (
          <div class="settings-panel" style={{ width: "560px", height: "340px" }}>
            <div class="settings-tab-header settings-tab-header--stacked">
              <div class="settings-tab-header-row">
                <div class="flex min-w-0 flex-col gap-1">
                  <h2 class="settings-tab-title">Models</h2>
                  <span class="text-11-regular text-v2-text-text-muted">
                    Choose which models appear in the model picker.
                  </span>
                </div>
              </div>
              <SettingsSearchField value="" active={false} placeholder="Search models" onInput={() => undefined} />
            </div>
            <div class="settings-tab-body settings-models">
              <SettingsList variant="catalog">
                <For each={models}>
                  {(name) => (
                    <SettingsRow title={name} description="">
                      <div>
                        <Switch defaultChecked hideLabel>
                          {name}
                        </Switch>
                      </div>
                    </SettingsRow>
                  )}
                </For>
              </SettingsList>
            </div>
          </div>
        ),
      },
      {
        name: "Worktrees: Delete ring cut at the top and right by its row",
        failure: "Clipped",
        target: '[aria-label="Delete “opencode-dialogs”?"]',
        keys: "Click the path, press Tab.",
        sizing: "Audited at 1280×800. Delete is the row's top-right control.",
        source: "app/src/settings/settings.css:1919–27 (row overflow: hidden), workspaces.tsx:543–553",
        render: () => (
          <div class="settings-tab-body settings-workspaces" style={{ width: "560px", padding: "0" }}>
            <div class="settings-workspaces-inventory">
              <SettingsList>
                <div class="settings-workspaces-row-motion">
                  <div class="settings-workspaces-row">
                    <div class="settings-workspaces-row-header">
                      <div class="settings-workspaces-copy">
                        <div class="settings-workspaces-main">/Users/alex/work/opencode-dialogs</div>
                        <span class="settings-workspaces-meta">0 sessions in opencode</span>
                      </div>
                      <div class="settings-workspaces-row-actions">
                        <IconButton
                          type="button"
                          variant="ghost-muted"
                          size="small"
                          aria-label="Delete “opencode-dialogs”?"
                          icon={<Icon name="trash" size="small" />}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </SettingsList>
            </div>
          </div>
        ),
      },
      {
        name: "Language: inline select shows no focus",
        failure: "Invisible",
        target: '[data-component="select-v2"]',
        keys: "Click the row title, press Tab.",
        sizing: "Any width. Inline appearance sets outline: none, and focus only recolours that outline.",
        source: "ui/src/forms/select/select.css:100–103, 193–204",
        render: () => (
          <div style={{ width: "560px" }}>
            <SettingsList>
              <SettingsRow title="Language" description="Change the display language">
                <Select
                  options={["English", "Deutsch", "Français"]}
                  current="English"
                  placement="bottom-end"
                  gutter={6}
                  onSelect={() => undefined}
                />
              </SettingsRow>
            </SettingsList>
          </div>
        ),
      },
      {
        name: "Project colour: the selected swatch looks the same focused",
        failure: "Invisible",
        target: '[aria-label="Cyan"]',
        keys: "Click the row title, press Tab three times.",
        sizing: "Any width. Focus and selection share one ring.",
        source: "app/src/settings/workspaces/project.css:328–332",
        render: () => (
          <div style={{ width: "560px" }}>
            <SettingsList>
              <SettingsRow title="Colour" description="The project's avatar colour">
                <div class="project-settings-colors">
                  <For each={["orange", "yellow", "cyan"] as const}>
                    {(color) => (
                      <button
                        type="button"
                        aria-label={color[0].toUpperCase() + color.slice(1)}
                        aria-pressed={color === "cyan"}
                        class="project-settings-color"
                        classList={{ "project-settings-color--selected": color === "cyan" }}
                      >
                        <ProjectAvatar
                          fallback=""
                          variant={color}
                          class="!size-5 [&_[data-slot=project-avatar-surface]]:!rounded-[6px]"
                        />
                        <Show when={color === "cyan"}>
                          <Icon name="check" size="small" class="project-settings-color-check" />
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              </SettingsRow>
            </SettingsList>
          </div>
        ),
      },
    ],
    also: [
      "Section headings and Timeline detail controls lose their bottom stroke at the scrollport edge.",
      "The selected Settings navigation tab looks the same focused and blurred.",
    ],
  },
]

function FocusVisibility(props: VisibilityArgs) {
  createEffect(() => {
    if (!props.forced) return

    onCleanup(forceFocusStyles())
  })

  return (
    <main
      data-color-scheme={props.scheme === "lab" ? undefined : props.scheme}
      style={{
        display: "grid",
        gap: "32px",
        width: "min(1240px, 100%)",
        padding: "24px",
        "box-sizing": "border-box",
        color: "var(--v2-text-text-base)",
        background: "var(--v2-background-bg-base)",
      }}
    >
      <header style={{ display: "grid", gap: "4px" }}>
        <h1 style={{ ...heading, "font-size": "18px" }}>Focus visibility</h1>
        <p style={{ ...label, margin: "0" }}>
          Where focus is clipped, covered or invisible. Each case opens with its target focused; the dashed box marks
          where that target is. Follow the keys to reproduce it with real focus.
        </p>
      </header>
      <For each={surfaces}>
        {(surface) => (
          <section style={{ display: "grid", gap: "12px" }}>
            <h2 style={heading}>{surface.name}</h2>
            <div
              style={{
                display: "grid",
                "grid-template-columns": "repeat(auto-fill, minmax(min(100%, 600px), 1fr))",
                gap: "12px",
              }}
            >
              <For each={surface.cases}>
                {(item) => <CaseCard case={item} forced={props.forced} locator={props.locator} />}
              </For>
            </div>
            <div style={{ display: "grid", gap: "4px" }}>
              <span style={{ ...label, color: "var(--v2-text-text-base)" }}>Same audit, not rendered here</span>
              <ul style={{ ...label, margin: "0", "padding-inline-start": "18px" }}>
                <For each={surface.also}>{(line) => <li>{line}</li>}</For>
              </ul>
            </div>
          </section>
        )}
      </For>
    </main>
  )
}

function CaseCard(props: { case: Case; forced: boolean; locator: boolean }) {
  let stage: HTMLDivElement | undefined

  const [box, setBox] = createSignal<{ left: number; top: number; width: number; height: number }>()

  const target = () => {
    const active = document.activeElement

    if (stage && active instanceof HTMLElement && stage.contains(active)) return active

    return stage?.querySelector<HTMLElement>(props.case.target) ?? undefined
  }

  const place = () => {
    const element = target()

    if (!stage || !element) return setBox(undefined)

    // Visually hidden inputs (switches) are a pixel wide: mark the control they drive instead.
    const rect = (
      element.offsetWidth < 4 && element.parentElement ? element.parentElement : element
    ).getBoundingClientRect()

    const outer = stage.getBoundingClientRect()

    setBox({ left: rect.left - outer.left, top: rect.top - outer.top, width: rect.width, height: rect.height })
  }

  onMount(() => {
    const frame = requestAnimationFrame(place)

    stage?.addEventListener("scroll", place, true)
    window.addEventListener("resize", place)
    onCleanup(() => {
      cancelAnimationFrame(frame)
      stage?.removeEventListener("scroll", place, true)
      window.removeEventListener("resize", place)
    })
  })

  createEffect(() => {
    if (!props.forced) return

    // Controls settle in the frames after mount: Select replaces its trigger, and the tab strip starts its own scroll to
    // the newest tab. The target is marked and scrolled to after both.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const element = stage?.querySelector<HTMLElement>(props.case.target)

        if (!stage || !element) return

        const from = props.case.from
        const scroller = from ? stage.querySelector<HTMLElement>(from.scroller) : undefined

        scroller?.scrollTo({
          top: from?.edge === "end" ? scroller.scrollHeight : 0,
          left: from?.edge === "end" ? scroller.scrollWidth : 0,
          behavior: "instant",
        })
        element.setAttribute("data-lab-focus", "")
        revealInStage(stage, element)
        place()
      })
    })

    onCleanup(() => {
      cancelAnimationFrame(frame)
      stage?.querySelectorAll("[data-lab-focus]").forEach((element) => element.removeAttribute("data-lab-focus"))
    })
  })

  return (
    <figure
      style={{
        display: "grid",
        gap: "12px",
        margin: "0",
        padding: "16px",
        "border-radius": "8px",
        border: "1px solid var(--v2-border-border-base)",
        "min-width": "0",
      }}
    >
      <div style={{ display: "flex", gap: "8px", "align-items": "baseline", "justify-content": "space-between" }}>
        <span style={{ ...label, color: "var(--v2-text-text-base)", "font-weight": 530 }}>{props.case.name}</span>
        <span style={{ ...label, color: "var(--v2-state-fg-danger)", "flex-shrink": 0 }}>{props.case.failure}</span>
      </div>
      <div
        ref={stage}
        onFocusIn={() => {
          // Real focus replaces the marked one, so only one target shows at a time.
          stage?.querySelectorAll("[data-lab-focus]").forEach((element) => element.removeAttribute("data-lab-focus"))
          requestAnimationFrame(place)
        }}
        style={{ position: "relative", padding: "12px", overflow: "auto", "max-width": "100%" }}
      >
        {props.case.render()}
        <Show when={props.locator && box()}>
          {(rect) => (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: `${rect().left - 6}px`,
                top: `${rect().top - 6}px`,
                width: `${rect().width + 12}px`,
                height: `${rect().height + 12}px`,
                border: "1px dashed var(--v2-state-fg-danger)",
                "border-radius": "4px",
                "pointer-events": "none",
                "z-index": 20,
              }}
            />
          )}
        </Show>
      </div>
      <dl style={{ ...label, display: "grid", "grid-template-columns": "auto 1fr", gap: "2px 12px", margin: "0" }}>
        <dt>Keys</dt>
        <dd style={{ margin: "0", color: "var(--v2-text-text-base)" }}>{props.case.keys}</dd>
        <dt>Sizing</dt>
        <dd style={{ margin: "0" }}>{props.case.sizing}</dd>
        <dt>Source</dt>
        <dd style={{ margin: "0", "font-family": "var(--font-family-mono)", "font-size": "11px" }}>
          {props.case.source}
        </dd>
      </dl>
    </figure>
  )
}

function TabStrip() {
  return (
    <aside
      id="review-panel"
      class="relative flex overflow-hidden bg-v2-background-bg-base rounded-[10px] shadow-[var(--v2-elevation-raised)]"
      style={{ width: "360px", height: "96px" }}
    >
      <Tabs defaultValue="changes" class="flex-1 min-w-0">
        <div class="session-review-v2-tabs-bar sticky top-0 shrink-0 flex items-center">
          <Tabs.List ref={(el: HTMLDivElement) => onCleanup(createTabStripScroll({ el, lead: () => false }))}>
            <For each={panelTabs}>
              {(name) => (
                <Tabs.Trigger value={name} data-pane-tab={name} hideCloseButton>
                  {name === "changes" ? "Changes" : name}
                </Tabs.Trigger>
              )}
            </For>
            <div class="h-full shrink-0 sticky end-0 z-10 flex items-center justify-center bg-v2-background-bg-base">
              <IconButton variant="ghost" icon={<Icon name="plus" />} aria-label="Add tab" />
            </div>
          </Tabs.List>
        </div>
      </Tabs>
    </aside>
  )
}

// Scrolls the target into view inside the case the way focusing it does, without moving the review page around it.
function revealInStage(stage: HTMLElement, element: HTMLElement) {
  const outside = [stage, ...ancestors(stage)].map((node) => ({
    node,
    top: node.scrollTop,
    left: node.scrollLeft,
  }))

  element.scrollIntoView({ block: "nearest", inline: "nearest" })
  outside.forEach((item) => item.node.scrollTo({ top: item.top, left: item.left }))
}

function ancestors(node: HTMLElement): HTMLElement[] {
  return node.parentElement ? [node.parentElement, ...ancestors(node.parentElement)] : []
}

const heading = {
  margin: "0",
  color: "var(--v2-text-text-base)",
  "font-size": "14px",
  "font-weight": 600,
  "line-height": "var(--line-height-base)",
} as const

const label = {
  color: "var(--v2-text-text-muted)",
  "font-size": "12px",
  "line-height": "var(--line-height-compact)",
} as const

export default {
  title: "App/Design review/Focus visibility",
  id: "review-focus-visibility",
  args: { scheme: "lab", forced: true, locator: true } satisfies VisibilityArgs,
  argTypes: { scheme: { control: "select", options: schemes } },
  parameters: { layout: "fullscreen" },
}

export const AllSurfaces = { render: (args: VisibilityArgs) => <FocusVisibility {...args} /> }
