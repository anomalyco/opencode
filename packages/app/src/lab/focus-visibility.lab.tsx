import "@/composer/editor/editor.css"
import "@/home/projects/view.css"
import "@/home/sessions/view.css"
import "@/shell/titlebar/tab-nav.css"
import "@/shell/titlebar/titlebar.css"
import "@/session/session-identity-header.css"
import "@/settings/settings.css"
import "@/settings/general/interface-mode.css"
import "@/shell/titlebar/pinned-area.css"
import "@/settings/workspaces/project.css"
import "@/shell/palette-menu.css"
import "@/shell/search-list.css"
import "@opencode/session-ui/sources/panel"
import "../../../gui-plugins/src/browser/bar.css"
import treeFocusCss from "../../../gui-plugins/src/file/tree-focus.css?inline"

import { SessionFilePanelV2 } from "@opencode/session-ui/v2/session-file-panel-v2"
import { SessionReviewV2Sidebar, SessionReviewV2SidebarToggle } from "@opencode/session-ui/v2/session-review-v2"
import { Accordion } from "@opencode/ui/accordion"
import { StickyAccordionHeader } from "@opencode/ui/sticky-accordion-header"
import { Button } from "@opencode/ui/button"
import { Checkbox } from "@opencode/ui/checkbox"
import { Collapsible } from "@opencode/ui/collapsible"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { ProjectAvatar } from "@opencode/ui/project-avatar"
import { RadioGroup, RadioItem } from "@opencode/ui/radio"
import { ScrollView } from "@opencode/ui/scroll-view"
import { SegmentedControl, SegmentedControlItem } from "@opencode/ui/segmented-control"
import { Select } from "@opencode/ui/select"
import { Switch } from "@opencode/ui/switch"
import { Tabs } from "@opencode/ui/tabs"
import { TextInput } from "@opencode/ui/text-input"
import { createEffect, createSignal, createUniqueId, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { createTabStripScroll } from "@/runtime/plugin/tab-strip-scroll"
import { createOverlayFocus } from "@opencode/ui/context/overlay-focus"
import { installFocusRescue } from "@opencode/ui/context/focus-rescue"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Menu } from "@opencode/ui/menu"
import { Popover } from "@kobalte/core/popover"
import { WaitingButton } from "@/providers/connect/step-actions"
import { SessionHeaderActions } from "@/session/header/session-header-actions"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { SettingsSearchField } from "@/settings/search-field"
import { trackTabHeader } from "@/settings/tab-header"
import { forceFocusStyles } from "./force-focus"

// Each case renders production components, markup and CSS inside the ancestor that hides its focus, at the size the
// audit found it. On open the target is marked focused with the lab copy of the production focus rules, and any scroller
// is left where the browser's own scroll-into-view puts it, as the keys do. Real keyboard focus takes over from there.

// Inconsistent: focus showed, but not as the shared ring (another colour, width, offset or shape, or a background).
// Lost: focus fell to the page when the focused element went.
type Failure = "Occluded" | "Clipped" | "Invisible" | "Inconsistent" | "Lost"

type Case = {
  name: string
  failure: Failure
  target: string
  keys: string
  sizing: string
  source: string
  // How it was fixed, so each case stays here as a check that it holds.
  fix: string
  // The scroller the keys start in and the edge it starts at, such as the end of a list Shift+Tab walks back up.
  from?: { scroller: string; edge: "start" | "end" }
  render: (forced: () => boolean) => JSX.Element
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
    name: "Titlebar",
    cases: [
      {
        name: "Narrow-screen Tabs button: no keyboard ring",
        failure: "Invisible",
        target: "button",
        keys: "Narrow the browser and Tab to the Tabs button.",
        sizing: "Below the mobile breakpoint, the button fills the titlebar.",
        source: "app/src/shell/titlebar/titlebar.tsx",
        fix: "Draw the shared ring inside the button instead of suppressing the outline.",
        render: () => (
          <button class="h-7 w-48 rounded-[6px] px-2 text-start focus-visible:-outline-offset-2">Tabs</button>
        ),
      },
      {
        name: "Search and New tab: ring cut at the top and bottom by the titlebar row",
        failure: "Clipped",
        target: '[aria-label="Search sessions"]',
        keys: "Click the titlebar's empty space, press Tab.",
        sizing: "Any width. The buttons are as tall as the 36px row, which clips for the tab strip.",
        source: "app/src/shell/titlebar (row overflow: hidden), titlebar.css",
        fix: "Titlebar IconButtons draw the 2px ring inset (offset -2px, titlebar.css), inside the row that clips them. Found once they got a ring at all.",
        render: () => (
          <div
            data-slot="titlebar-v2"
            class="shrink-0 relative flex flex-row h-9 bg-v2-background-bg-deep overflow-visible"
            style={{ width: "360px" }}
          >
            <div class="h-full flex-1 overflow-hidden flex flex-row items-center gap-1.5 px-2">
              <div class="-me-0.5 flex shrink-0 items-center gap-0.5">
                <IconButton variant="ghost-muted" icon={<Icon name="sessions-stack" />} aria-label="Home" class="!w-9" />
                <IconButton
                  variant="ghost-muted"
                  icon={<Icon name="magnifying-glass" />}
                  aria-label="Search sessions"
                  class="!w-9"
                />
                <IconButton variant="ghost-muted" icon={<Icon name="plus" />} aria-label="New tab" class="!w-9" />
              </div>
            </div>
          </div>
        ),
      },
      {
        name: "Session tab: selected and keyboard focused look the same",
        failure: "Invisible",
        target: "[data-titlebar-tab-link]",
        keys: "Focus Search in the top tab bar, then press Tab to reach the session tab.",
        sizing: "The tab and the strip both clip overflow.",
        source: "app/src/shell/titlebar/tab-nav.tsx, titlebar.css",
        fix: "The link suppresses its outline. Its rounded tab wrapper now draws the inset ring when the link has keyboard focus. The close button keeps its own ring.",
        render: () => (
          <div class="flex items-center gap-2 overflow-hidden" style={{ width: "280px" }}>
            <IconButton variant="ghost-muted" icon={<Icon name="magnifying-glass" />} aria-label="Search sessions" />
            <div
              data-slot="titlebar-tab-item"
              class="flex h-7 min-w-0 items-center gap-1.5 overflow-hidden rounded-[6px] bg-v2-background-bg-layer-02 px-1.5"
            >
              <a data-titlebar-tab-link href="#review-focus-visibility" class="flex h-full items-center gap-1.5">
                <ProjectAvatar fallback="O" variant="blue" class="!size-4" />
                <span class="text-13-medium">Test message</span>
              </a>
              <IconButton variant="ghost-muted" size="small" icon={<Icon name="close" />} aria-label="Close tab" />
            </div>
          </div>
        ),
      },
    ],
    also: [],
  },
  {
    name: "Session header and composer",
    cases: [
      {
        name: "Child session: parent breadcrumb only changes background",
        failure: "Inconsistent",
        target: "button",
        keys: "Open a child session and Tab from the project to its parent breadcrumb.",
        sizing: "The breadcrumb has space for the default outset ring.",
        source: "app/src/session/session-identity-header.tsx",
        fix: "Use the shared outset ring for the parent breadcrumb and preserve hover styling.",
        render: () => <button class="h-7 rounded-[6px] px-1.5 text-13-medium">Parent session</button>,
      },
      {
        name: "Project button: keyboard focus only changes the background",
        failure: "Inconsistent",
        target: '[data-slot="session-location-trigger"]',
        keys: "Tab to the project name at the start of the session header.",
        sizing: "Any header width, including when the label collapses to an icon.",
        source: "app/src/session/session-identity-header.tsx",
        fix: "Keep hover and menu-open backgrounds, and let the project button draw the shared outset keyboard ring.",
        render: () => (
          <button
            type="button"
            data-slot="session-location-trigger"
            class="flex h-7 items-center gap-2 rounded-[6px] px-1.5 text-13-regular text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
          >
            <ProjectAvatar fallback="O" variant="blue" class="!size-4" />
            opencode
          </button>
        ),
      },
      {
        name: "Editable session title: skipped by Tab",
        failure: "Invisible",
        target: "h1 > button",
        keys: "From the project button, press Tab. In a session, Enter or Space opens rename and Escape returns focus.",
        sizing: "An editable session title. Read-only titles remain plain headings.",
        source: "app/src/session/timeline/message-timeline.tsx, session/session-identity-header.css",
        fix: "A native button inside the heading makes rename reachable with Tab and gives it the shared outset ring.",
        render: () => (
          <div class="flex items-center gap-2">
            <button type="button" class="h-7 rounded-[6px] px-1.5 text-13-regular">
              opencode
            </button>
            <Icon name="chevron-right" />
            <h1 class="session-title-rename w-fit text-13-medium">
              <button type="button" class="truncate hover:bg-v2-overlay-simple-overlay-hover">
                Test message
              </button>
            </h1>
          </div>
        ),
      },
      {
        name: "Right panel toggle: focus arrives before the header",
        failure: "Inconsistent",
        target: '[aria-controls="review-panel"]',
        keys: "Focus the preceding header action and press Tab. Shift+Tab goes back to that action.",
        sizing: "Desktop width, with the review panel open or closed.",
        source:
          "app/src/session/screen.tsx, session/timeline/message-timeline.tsx, session/session-identity-header.css",
        fix: "The toggle follows the other header actions in DOM order. It stays at the pane row's end visually when the panel opens.",
        render: () => (
          <div class="flex items-center gap-2">
            <IconButton variant="ghost-muted" icon={<Icon name="layout-left" />} aria-label="Session details" />
            <SessionHeaderActions
              state={{
                reviewLabel: "Toggle review",
                reviewKeybind: [],
                reviewVisible: true,
                reviewOpened: false,
                onReviewToggle: () => undefined,
              }}
            />
          </div>
        ),
      },
    ],
    also: [],
  },
  {
    name: "New session",
    cases: [
      ...(["tip", "dismiss"] as const).map(
        (part): Case => ({
          name: `Provider tip ${part === "dismiss" ? "dismiss button" : "link"}: focus only changes the background`,
          failure: "Inconsistent",
          target: part === "dismiss" ? '[aria-label="Dismiss"]' : "button:first-child",
          keys: `On New session, Tab to the provider tip${part === "dismiss" ? ", then Tab to Dismiss" : ""}.`,
          sizing: "The tip appears when no provider is connected. Both controls have room for an outset ring.",
          source: "app/src/new-session/view.tsx",
          fix: "Keep the hover treatment and use the shared rounded keyboard ring. Dismiss still reveals when it takes focus.",
          render: () => (
            <div data-component="new-session-tip" class="flex max-w-full items-center gap-1">
              <button
                type="button"
                class="flex h-6 min-w-0 items-center rounded-[4px] ps-1.5 text-13-regular text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover"
              >
                <span class="truncate">Connect to 75+ providers to use other models</span>
                <Icon name="chevron-right" class="shrink-0" />
              </button>
              <button
                type="button"
                aria-label="Dismiss"
                class="grid size-6 shrink-0 place-items-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover"
              >
                <Icon name="close" />
              </button>
            </div>
          ),
        }),
      ),
      {
        name: "Project picker: keyboard focus looks like hover",
        failure: "Inconsistent",
        target: '[data-action="prompt-project"]',
        keys: "On New session, Tab to the project picker below the composer.",
        sizing: "The project picker and worktree picker sit below the composer, outside its clipping frame.",
        source: "app/src/new-session/view.tsx, project/selector.tsx",
        fix: "Use the shared rounded outset ring on the project and worktree pickers, including the add-project fallback.",
        render: () => (
          <button
            type="button"
            data-action="prompt-project"
            class="flex h-7 items-center gap-1.5 rounded-[4px] ps-1.5 pe-2 text-13-regular text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
          >
            <ProjectAvatar fallback="D" class="!size-4" />
            Default Project
            <Icon name="chevron-down" class="text-v2-icon-icon-muted" />
          </button>
        ),
      },
      {
        name: "Composer Send: ring touches the button fill",
        failure: "Inconsistent",
        target: '[data-action="composer-submit"]',
        keys: "Type a draft, then Tab to Send.",
        sizing: "Send sits outside the scrolling toolbar controls, with 8px of space to the composer frame.",
        source: "app/src/composer/editor/editor.css",
        fix: "Keep the toolbar rings inset but let the fixed Send button use the default 2px outset ring.",
        render: () => (
          <div data-component="composer" class="w-[240px] overflow-clip rounded-xl bg-v2-background-bg-layer-01">
            <div class="px-4 pt-4 pb-2 text-13-regular">Review the recent changes.</div>
            <div data-slot="composer-actions" class="flex h-11 items-center justify-end px-2">
              <IconButton
                type="button"
                data-action="composer-submit"
                variant="submit"
                class="size-7 rounded-md p-[6px]"
                aria-label="Send"
                icon={<Icon name="arrow-up" />}
              />
            </div>
          </div>
        ),
      },
    ],
    also: [],
  },
  {
    name: "Timeline",
    cases: [
      {
        name: "Copy response: focus scrolls under the sticky session header",
        failure: "Occluded",
        target: '[aria-label="Copy response"]',
        keys: "In a long session, Shift+Tab into the timeline and watch the copy button scroll clear of the header.",
        sizing: "The scrollport reserves the 48px header and its 16px fade.",
        source: "app/src/index.css, session/timeline/message-timeline.tsx",
        fix: "Set block-start scroll padding where the header inset is present, so keyboard scroll reveals the whole ring.",
        render: () => (
          <ScrollView data-slot="session-timeline-scroll" class="h-32 w-[300px] bg-v2-background-bg-layer-01">
            <div data-slot="session-header-inset" class="sticky top-0 z-10 h-16 bg-v2-background-bg-base p-3">
              Session header
            </div>
            <div class="h-28 p-2">
              <IconButton variant="ghost-muted" icon={<Icon name="copy" />} aria-label="Copy response" />
            </div>
          </ScrollView>
        ),
      },
      {
        name: "Read more: the folded prompt uses an old accent ring",
        failure: "Inconsistent",
        target: "button",
        keys: "Tab to Read more on a folded prompt.",
        sizing: "The text disclosure has room for the default outset ring.",
        source: "session-ui/src/components/message-part.css",
        fix: "Replace the old 1px accent outline with the shared 2px ring.",
        render: () => (
          <div data-component="user-message">
            <button type="button" data-slot="user-message-fold-toggle" aria-expanded="false">
              Read more <Icon name="chevron-down" />
            </button>
          </div>
        ),
      },
      {
        name: "Timeline Find close: an old thin outline shows at rest in forced colours",
        failure: "Inconsistent",
        target: "button",
        keys: "Open Find in a session and Tab to its close button.",
        sizing: "The icon sits inside the compact Find field.",
        source: "app/src/session/timeline/search-bar.tsx",
        fix: "Draw no outline at rest and use the shared inset ring on keyboard focus.",
        render: () => (
          <button
            type="button"
            aria-label="Close Find"
            class="grid size-5 place-items-center rounded-[4px] focus-visible:-outline-offset-2"
          >
            <Icon name="close" />
          </button>
        ),
      },
      ...[
        { name: "Execute call", slot: "execute-tool-call", source: "components/message-part.css" },
        { name: "More search results", slot: "exa-tool-more", source: "components/message-part.css" },
        { name: "Fetched page link", slot: "webfetch-link", source: "components/basic-tool.css" },
        { name: "Timeline event link", slot: "timeline-event-item", source: "timeline-next/timeline-next.css" },
      ].map(
        (example): Case => ({
          name: `${example.name}: thin accent outline`,
          failure: "Inconsistent",
          target: "button",
          keys: `Tab to the ${example.name.toLowerCase()} in the timeline.`,
          sizing: "There is room for the default outset ring.",
          source: `session-ui/src/${example.source}`,
          fix: "Replace the 1px accent outline with the shared 2px ring and rounded corners.",
          render: () => (
            <div data-timeline="next" class="w-56">
              <div data-component={example.slot === "execute-tool-call" ? "execute-tool-calls" : "timeline-event-list"}>
                <button
                  type="button"
                  role="button"
                  data-slot={example.slot}
                  class={example.slot === "webfetch-link" ? "webfetch-link" : undefined}
                >
                  {example.name}
                </button>
              </div>
            </div>
          ),
        }),
      ),
      {
        name: "Copy response: ring cut at the bottom by the virtual row",
        failure: "Clipped",
        target: '[aria-label="Copy response"]',
        keys: "Click the response text, press Tab.",
        sizing: "Any width (audited at 1100×800 and 390×680). The row clips at its measured height.",
        source:
          "app/src/session/timeline/virtualizer.tsx:1077–86 (overflow: clip, clip margin 0.5px), session-ui message-part.css:577–83",
        fix: "The virtual row's overflow-clip-margin went from 0.5px to 5px (virtualizer.tsx), room for the 2px ring at its 2px offset. The same margin keeps card shadows at a row edge.",
        render: () => (
          <div style={{ width: "420px", position: "relative", overflow: "clip", "overflow-clip-margin": "5px" }}>
            <div data-component="text-part">
              <div data-slot="text-part-body">
                <div data-component="markdown">
                  <p>Historical response 8. Existing session content keeps the virtual timeline realistic.</p>
                </div>
              </div>
              <div data-slot="text-part-copy-wrapper" data-keep-copy-visible>
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
        fix: "The fold pads its sides by 5px and takes it back with a negative margin, so a ring at either end of a line is inside the clip. Links keep a 40px bottom scroll-margin, clear of the fade, and draw the default ring.",
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
        fix: "The trigger draws the 2px ring inset (offset -2px), since the list clips a full-width row.",
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
      {
        name: "New timeline tool row: background only",
        failure: "Inconsistent",
        target: '[data-slot="collapsible-trigger"]',
        keys: "Turn on the new timeline, click the response above a tool row, press Tab.",
        sizing: "Any width. The trigger also holds the gap below an open row.",
        source: "session-ui/src/timeline-next/timeline-next.css",
        fix: "Keyboard focus rings the row's line of text (tool-trigger) at the default 2px offset with a 4px radius, instead of filling it with the hover background. A ring on the trigger itself would take in the gap below an open row.",
        render: () => (
          <div data-timeline="next" style={{ width: "380px" }}>
            <Collapsible variant="ghost">
              <Collapsible.Trigger>
                <div data-component="tool-trigger" class="text-13-regular" style={{ gap: "6px" }}>
                  Read <span class="text-v2-text-text-muted">src/session/timeline.tsx</span>
                </div>
              </Collapsible.Trigger>
              <Collapsible.Content>Content</Collapsible.Content>
            </Collapsible>
          </div>
        ),
      },
      {
        name: "Compaction divider: thin accent ring",
        failure: "Inconsistent",
        target: '[data-slot="session-compaction-divider"]',
        keys: "Click the message above a compaction, press Tab.",
        sizing: "Any width.",
        source: "session-ui/src/components/session-compaction.css",
        fix: "Was 1px in --v2-text-text-accent. Now the shared 2px ring in the focus colour at a 2px offset.",
        render: () => (
          <div data-component="session-compaction-message" data-quiet style={{ width: "380px" }}>
            <button type="button" data-slot="session-compaction-divider">
              Compacted
            </button>
          </div>
        ),
      },
      {
        name: "Session link in a response: ring in the text colour",
        failure: "Inconsistent",
        target: ".markdown-session-link",
        keys: "Click the response text, press Tab.",
        sizing: "Any width.",
        source: "session-ui/src/components/markdown.css",
        fix: "Was 2px in currentColor, so it took the link's colour. Now the shared focus colour at a 2px offset.",
        render: () => (
          <div data-component="markdown" style={{ width: "380px" }}>
            <p>
              Continued from{" "}
              <a href="#review-focus-visibility" class="markdown-session-link">
                Fix the review panel
              </a>
              .
            </p>
          </div>
        ),
      },
      {
        name: "Sources chip: 1px ring",
        failure: "Inconsistent",
        target: '[data-component="sources-chip"]',
        keys: "Turn on the Sources experiment, click a response that searched the web, press Tab.",
        sizing: "Any width.",
        source: "session-ui/src/sources/sources.css",
        fix: "The chip was 1px at a 1px offset, and the panel's rows 1px inset. Now the shared 2px ring: outset on the chip, inset (-2px) on the rows, which fill the panel's scrolling list.",
        render: () => (
          <button type="button" data-component="sources-chip">
            3 sources
          </button>
        ),
      },
      {
        name: "Question progress: ring runs into the next segment",
        failure: "Clipped",
        target: '[data-slot="question-progress-segment"]',
        keys: "Open a multi-question prompt, Tab to the progress segments.",
        sizing: "Any width. Segments sit 2px apart.",
        source: "session-ui/src/components/question-prompt.css",
        fix: "Was 2px at a 1px offset, which overlapped the neighbouring segment. Now inset (-2px), inside the segment.",
        render: () => (
          <div data-component="dock-prompt" data-kind="question" style={{ width: "240px" }}>
            <div data-slot="question-progress">
              <button type="button" data-slot="question-progress-segment" aria-label="Question 1">
                <span data-slot="question-progress-bar" />
              </button>
              <button type="button" data-slot="question-progress-segment" aria-label="Question 2">
                <span data-slot="question-progress-bar" />
              </button>
              <button type="button" data-slot="question-progress-segment" aria-label="Question 3">
                <span data-slot="question-progress-bar" />
              </button>
            </div>
          </div>
        ),
      },
    ],
    also: [
      "Fixed: the new timeline's command group lost the bottom of its shadow. The 5px row clip margin above covers it.",
    ],
  },
  {
    name: "Home",
    cases: [
      {
        name: "Home search results: Shift+Tab reaches a background-only option",
        failure: "Invisible",
        target: "input",
        keys: "Type a Home search. Use ArrowDown to move the highlight and Shift+Tab to leave the field.",
        sizing: "Results are controlled by the search input's active descendant.",
        source: "app/src/home/sessions/view.tsx, view.css",
        fix: "Remove result buttons from the Tab order. Give the active option a visible system highlight in forced colours.",
        render: () => <SearchHighlightExample kind="home-session-search-row" />,
      },
      {
        name: "Home viewport: invisible Tab stop",
        failure: "Invisible",
        target: ".scroll-view__viewport",
        keys: "Tab through the list: focus skips the viewport. Click it, then use ArrowDown or PageDown to scroll.",
        sizing: "The items inside the viewport take Tab focus and show the ring.",
        source: "ui/src/components/scroll-view.tsx, scroll-view.css",
        fix: "Keep the viewport out of the Tab order. A click still focuses it so the keyboard can scroll it.",
        render: () => (
          <ScrollView class="h-[90px] w-[300px] rounded-[6px] bg-v2-background-bg-layer-01">
            <div class="grid gap-3 p-3 text-13-regular">
              <span>Recent sessions</span>
              <span>Review focus states</span>
              <span>Check mobile layout</span>
              <span>Update the Lab</span>
            </div>
          </ScrollView>
        ),
      },
      ...(["Projects", "opencode"] as const).map(
        (label): Case => ({
          name: `Side tabs: ${label === "Projects" ? "Projects heading" : "project row"} has only a background change`,
          failure: "Inconsistent",
          target: '[data-slot="sidebar-project-row"] > button',
          keys: `Open Side tabs and Tab to ${label}. Tab again to focus the adjacent icon button independently.`,
          sizing: "The row spans the sidebar, including the trailing action.",
          source: "app/src/shell/titlebar/sidebar-organized.tsx, sidebar-customized.tsx, tab-nav.css",
          fix: "Draw the inset ring around the whole row when its main button has keyboard focus. The trailing button keeps its own ring.",
          render: () => (
            <div data-slot="sidebar-project-row" class="flex h-7 w-[250px] items-center rounded-[6px] pe-1">
              <button
                type="button"
                class="flex h-full flex-1 items-center gap-2 px-2 text-13-regular focus-visible:outline-none"
              >
                {label === "Projects" ? null : <ProjectAvatar fallback="O" class="!size-4" />}
                {label}
              </button>
              <IconButton
                size="small"
                variant="ghost-muted"
                icon={<Icon name={label === "Projects" ? "folder-add-left" : "outline-dots"} />}
                aria-label={label === "Projects" ? "Add project" : "More options"}
              />
            </div>
          ),
        }),
      ),
      {
        name: "Recent sessions: keyboard focus looks like hover",
        failure: "Inconsistent",
        target: '[data-component="home-session-row"]',
        keys: "In Home, Tab from New session into Recent sessions. Click the example or move the pointer over it to compare.",
        sizing: "Each session is its own full-width Tab stop.",
        source: "app/src/home/sessions/view.tsx, view.css",
        fix: "Use a rounded 2px inset ring for the session button. Hover keeps its background; search results, row actions and inline rename keep their existing focus styles.",
        render: () => (
          <div class="w-[360px] max-w-full overflow-hidden">
            <button
              type="button"
              data-component="home-session-row"
              class="flex h-10 w-full items-center gap-1.5 rounded-[6px] px-3 text-start text-13-medium hover:bg-v2-overlay-simple-overlay-hover"
            >
              <ProjectAvatar fallback="O" variant="blue" class="!size-4" />
              <span>Test message</span>
              <span class="text-13-regular text-v2-text-text-muted">opencode</span>
            </button>
          </div>
        ),
      },
      {
        name: "Project row: focus looks like selection",
        failure: "Inconsistent",
        target: '[data-component="home-project-row"]',
        keys: "In Home › Projects, Tab from Add project to a project row.",
        sizing: "The row fills the scrolling list, and its hover actions sit over its trailing edge.",
        source: "app/src/home/projects/view.tsx, view.css",
        fix: "Replace the faint shadow with a 2px inset ring around the selected or unselected row. Paint it above the hover actions without blocking clicks.",
        render: () => (
          <div class="w-[260px] overflow-hidden">
            <div data-home-row data-selected class="relative flex h-7 items-center rounded-[6px]">
              <button
                type="button"
                data-component="home-project-row"
                data-slot="home-project-nav-button"
                class="flex h-7 w-full items-center gap-2 rounded-[6px] px-1.5 text-13-regular"
              >
                <ProjectAvatar fallback="O" variant="blue" class="!size-4" />
                opencode
              </button>
              <div data-slot="home-row-actions" class="absolute end-1 inset-y-0 flex items-center ps-2">
                <IconButton
                  size="small"
                  variant="ghost-muted"
                  icon={<Icon name="outline-dots" />}
                  aria-label="More options"
                />
              </div>
            </div>
          </div>
        ),
      },
      ...(["Settings", "Help"] as const).map(
        (action): Case => ({
          name: `${action}: barely visible keyboard focus`,
          failure: "Inconsistent",
          target: "button",
          keys: `Tab to ${action} below the Projects list or in the Home footer.`,
          sizing: "The same control is used in the sidebar and the narrower footer.",
          source: "app/src/home/projects/view.tsx, view.css",
          fix: "Replace the faint shadow with the shared 2px keyboard ring, inset so the edges stay visible.",
          render: () => (
            <button
              type="button"
              data-slot="home-project-nav-button"
              class="flex h-7 w-[260px] items-center gap-2 rounded-[6px] px-1.5 text-13-regular text-v2-text-text-faint"
            >
              <Icon name={action === "Settings" ? "settings-gear" : "help"} />
              {action}
            </button>
          ),
        }),
      ),
    ],
    also: [],
  },
  {
    name: "Browser device toolbar",
    cases: (["width", "height"] as const).map((axis) => ({
      name: `${axis === "width" ? "Side" : "Bottom"} resize grip: the preview clips the keyboard ring`,
      failure: "Clipped",
      target: `[data-axis="${axis}"]`,
      keys: "Enable the browser device toolbar, choose a device size, and Tab to the resize grip.",
      sizing: "The preview clips at its outer edge. Each grip has a 14px hit area.",
      source: "gui-plugins/src/browser/bar.css",
      fix: "Draw the shared 2px ring inset around the rounded hit area so the preview cannot clip it. The grip still resizes the same way.",
      render: () => (
        <div
          data-component="browser-preview"
          data-fixed
          data-resizable
          style={{ "grid-template": "100px / 220px", width: "234px", height: "118px", "box-sizing": "border-box" }}
        >
          <div class="rounded-[6px] bg-v2-background-bg-base" aria-hidden="true" />
          <div
            data-slot="browser-viewport-grip"
            data-axis="width"
            role="separator"
            tabIndex={0}
            aria-label="Resize viewport width"
            aria-orientation="vertical"
          />
          <div
            data-slot="browser-viewport-grip"
            data-axis="height"
            role="separator"
            tabIndex={0}
            aria-label="Resize viewport height"
          />
          <div data-slot="browser-viewport-grip" data-axis="corner" aria-hidden="true" />
        </div>
      ),
    })),
    also: [],
  },
  {
    name: "Right panel",
    cases: [
      {
        name: "Files and Review tree: ArrowDown moves focus without a visible cue",
        failure: "Invisible",
        target: '[data-slot="lab-tree-host"]',
        keys: "Tab to a file tree and use the arrow keys. The focus outline follows the row without changing selection.",
        sizing: "The tree rows are full width inside the plugin's shadow root.",
        source: "gui-plugins/src/file/pierre-tree.tsx, tree-focus.css",
        fix: "Use the shared inset ring on the keyboard-focused row, independently of the selected background.",
        render: () => <TreeFocusExample />,
      },
      {
        name: "Git changes: file-tree toggle covers the start of the ring",
        failure: "Occluded",
        target: '[data-component="select-v2"]',
        keys: "In Review, focus the file-tree toggle and press Tab.",
        sizing: "The toggle ends 2px before the selector, in both the sidebar and the collapsed toolbar.",
        source: "session-ui/src/v2/components/session-review-v2.css",
        fix: "Draw the mode selector's ring inset so the floating toggle cannot cover it.",
        render: () => (
          <div class="h-[100px] w-[340px]">
            <SessionFilePanelV2
              toolbar={false}
              sidebarToggle={<SessionReviewV2SidebarToggle opened onToggle={() => undefined} />}
              sidebar={
                <SessionReviewV2Sidebar
                  open
                  transition={false}
                  filter=""
                  onFilterChange={() => undefined}
                  title={
                    <Select
                      options={["Git changes", "Branch changes"]}
                      current="Git changes"
                      onSelect={() => undefined}
                    />
                  }
                />
              }
            />
          </div>
        ),
      },
      {
        name: "Tab strip: End puts the last tab under the sticky Add tab",
        failure: "Occluded",
        target: '[data-pane-tab="source-12.ts"]',
        keys: "Click any tab, press Home, then End.",
        sizing: "Side panel 360px wide with 13 tabs open.",
        source:
          "app/src/runtime/plugin/side-region.tsx:333 (sticky +), ui tabs.css:605–621 (strip mask), tabs.css:100 (no ring)",
        fix: 'Kobalte moved focus without scrolling, so End left the tab where it was. The strip now scrolls a keyboard-focused tab into view (tab-strip-scroll.ts), and its scroll-padding-inline, --tab-strip-add plus the 24px fade (tabs.css), keeps it clear of the "+". The ring covers the whole tab, close button included.',
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
        fix: "The tab draws the 2px ring inset (offset -2px) around its label and close button, since the strip scrolls and would clip a ring outside.",
        from: { scroller: '[data-slot="tabs-list"]', edge: "end" },
        render: () => <TabStrip />,
      },
    ],
    also: [
      "Review header at a 164px preview: Previous and Next overlap the line buttons, and Split diff is cut off.",
      "CSV preview at 80px: Copy content overflows the header.",
      "Line comment More options runs past the panel edge at 360px.",
    ],
  },
  {
    name: "Settings",
    cases: [
      {
        name: "Interface layout: selection and focus use the same blue",
        failure: "Inconsistent",
        target: "input",
        keys: "Tab onto the selected Interface layout card.",
        sizing: "The card has a separate selected border and an outset focus ring.",
        source: "app/src/settings/general/interface-mode.css",
        fix: "Selection is a 2px neutral border, a check outside the corner and a faded sketch on the other cards. Blue is only the keyboard ring.",
        render: () => <ModeCards group="interface" />,
      },
      ...(["Work account", "Add account"] as const).map(
        (label): Case => ({
          name: `Connect: ${label} has only a background change`,
          failure: "Inconsistent",
          target: "button",
          keys: "Open a provider with saved accounts in Connect and Tab through the accounts and Add account.",
          sizing: "Each button is a separate Tab stop in the scrolling dialog.",
          source: "app/src/providers/connect/dialog.tsx",
          fix: "Show a shared inset ring, rather than reusing the hover background as the only cue.",
          render: () => (
            <button
              type="button"
              class="flex h-8 w-64 items-center rounded-md px-2 text-start focus-visible:-outline-offset-2"
            >
              {label}
            </button>
          ),
        }),
      ),
      {
        name: "Extensions tab panel: the ring loses both sides",
        failure: "Clipped",
        target: '[role="tabpanel"]',
        keys: "Open Settings › Extensions › MCPs and Tab from the selected tab onto its panel.",
        sizing: "The panel stretches edge to edge inside a clipping tabs root.",
        source: "app/src/settings/settings.css (.settings-subtabs)",
        fix: "Keep the tab panel reachable, including when it has no interactive content. Draw its ring inset, independently of the rings on its children.",
        render: () => (
          <div class="w-[400px] max-w-full">
            <Tabs variant="pill" defaultValue="mcps" class="settings-subtabs">
              <Tabs.List>
                <Tabs.Trigger value="mcps">MCPs</Tabs.Trigger>
                <Tabs.Trigger value="plugins">Plugins</Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content value="mcps">
                <div class="settings-extension-row">
                  <span>Available to all projects</span>
                  <span class="text-v2-text-text-muted">Manage in opencode.json</span>
                </div>
              </Tabs.Content>
              <Tabs.Content value="plugins">Manage plugins</Tabs.Content>
            </Tabs>
          </div>
        ),
      },
      {
        name: "Connect provider dialog: breadcrumb focus only changes text colour",
        failure: "Inconsistent",
        target: "nav button",
        keys: "Open Connect, choose a provider, then Tab or Shift+Tab to the Connect breadcrumb.",
        sizing: "The breadcrumb is a compact text button, not a full-width row.",
        source: "app/src/providers/connect/dialog.tsx",
        fix: "Both interactive breadcrumbs use the shared outset keyboard ring with a 4px radius. Non-interactive breadcrumb labels remain plain text.",
        render: () => (
          <div data-slot="dialog-header" class="w-[320px] rounded-xl border border-v2-border-border-base p-4">
            <nav aria-label="Provider connection" class="flex items-center gap-1 text-13-regular">
              <button type="button" class="rounded-[4px] text-v2-text-text-faint hover:text-v2-text-text-base">
                Connect
              </button>
              <Icon name="chevron-right" class="text-v2-icon-icon-muted" />
              <span class="text-13-medium">OpenCode Go</span>
            </nav>
          </div>
        ),
      },
      {
        name: "Providers: Show more providers draws a full-width square ring",
        failure: "Inconsistent",
        target: ".settings-providers-view-all",
        keys: "In Settings › Providers, Tab from the last Connect button to Show more providers.",
        sizing: "The section is a column; by default its children stretch across the panel.",
        source: "app/src/settings/settings.css (.settings-providers-view-all)",
        fix: "Size the text action to its label, give it a 4px corner radius, and use the shared 2px outset ring.",
        render: () => (
          <div class="settings-section" style={{ width: "min(100%, 560px)" }}>
            <h3 class="settings-section-title">Popular providers</h3>
            <SettingsList>
              <SettingsRow title="OpenAI" description="Connect an account to use OpenAI models">
                <Button size="small">Connect</Button>
              </SettingsRow>
            </SettingsList>
            <button type="button" class="settings-providers-view-all">
              Show more providers
            </button>
          </div>
        ),
      },
      {
        name: "Models: Shift+Tab hides the focused switch under the sticky header",
        failure: "Occluded",
        target: '[data-component="settings-row"]:nth-child(5) [data-slot="switch-input"]',
        keys: "Click the last row's name, then press Shift+Tab until a row scrolls up.",
        sizing: "Audited at 1280×800 and 390×680. The panel has no scroll padding for its sticky header.",
        source: "app/src/settings/settings.css:587–611 (.settings-panel, sticky .settings-tab-header)",
        fix: "tab-header.ts writes the header's height to --settings-tab-header-height; focusable controls in .settings-tab-body take it, plus the 24px fade, as their top scroll-margin.",
        from: { scroller: ".settings-panel", edge: "end" },
        render: () => <ModelsPanel />,
      },
      {
        name: "Extensions: Check for updates and How to add skills cut at the right",
        failure: "Clipped",
        target: ".settings-extension-link",
        keys: "Open Extensions › Skills (or Plugins), press Tab until the link (or Check for updates) is focused.",
        sizing: "Any width. Both sit flush with the sub-tab panel's end edge.",
        source:
          "ui tabs-current.css (tabs-v2 root overflow: clip), settings.css (.settings-subtabs panel overflow: auto), extensions.tsx",
        fix: "The tabs root clips with a 5px overflow-clip-margin, and the scrolling sub-tab panel pads its sides by 5px and takes it back with a negative margin, so a ring at either edge shows.",
        render: () => (
          <div style={{ width: "560px" }}>
            <Tabs variant="pill" defaultValue="skills" class="settings-subtabs">
              <Tabs.List>
                <Tabs.Trigger value="skills">Skills</Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content value="skills">
                <div class="flex items-center justify-between">
                  <span class="text-13-medium">Available to all projects</span>
                  <a class="settings-extension-link text-13-regular underline" href="#review-focus-visibility">
                    How to add skills
                  </a>
                </div>
              </Tabs.Content>
            </Tabs>
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
        fix: "The row clips with overflow: clip and a 5px overflow-clip-margin instead of overflow: hidden, so the removal animation still clips and the ring shows.",
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
        fix: "Inline Select draws the default ring immediately on keyboard focus, with no outline at rest. A transparent rest outline would show in forced colours. Bordered selects keep their normal field border.",
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
        fix: "Focus is the default outline and selection a neutral ring in --v2-border-border-inverse, so the two read apart.",
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
      {
        name: "Navigation and sub-tabs: square ring on a rounded tab",
        failure: "Inconsistent",
        target: '[data-slot="tabs-v2-trigger"]',
        keys: "Click the page title, press Shift+Tab to the navigation (or Tab to a sub-tab), then the arrow keys.",
        sizing: "Any width.",
        source: "ui/src/navigation/tabs/tabs-current.css",
        fix: "The trigger inside the tab has no radius, so its ring was square. The ring now goes on the tab's wrapper (:has(trigger:focus-visible)), inset 2px, and follows the tab's radius. It also shows only for the keyboard (:focus-visible), not after a click.",
        render: () => (
          <div style={{ width: "360px" }}>
            <Tabs variant="pill" defaultValue="mcps" class="settings-subtabs">
              <Tabs.List>
                <Tabs.Trigger value="mcps">MCPs</Tabs.Trigger>
                <Tabs.Trigger value="plugins">Plugins</Tabs.Trigger>
                <Tabs.Trigger value="skills">Skills</Tabs.Trigger>
              </Tabs.List>
            </Tabs>
          </div>
        ),
      },
      {
        name: "Timeline › Advanced: background only",
        failure: "Inconsistent",
        target: '[data-slot="collapsible-trigger"]',
        keys: "Open Settings › Timeline, Tab to Advanced.",
        sizing: "Any width.",
        source: "ui/src/components/collapsible.css",
        fix: "A standalone disclosure, not a list row, so it takes the default ring (2px offset) with a 4px radius instead of the hover background.",
        render: () => (
          <div style={{ width: "360px" }}>
            <Collapsible variant="ghost">
              <Collapsible.Trigger>
                <span>Advanced</span>
                <Collapsible.Arrow />
              </Collapsible.Trigger>
              <Collapsible.Content>Content</Collapsible.Content>
            </Collapsible>
          </div>
        ),
      },
      {
        name: "Projects: thin square ring inside the row's highlight",
        failure: "Inconsistent",
        target: ".settings-project-card > button",
        keys: "Open Settings › Projects, press Tab to a project row.",
        sizing: "Any width.",
        source: "app/src/settings/settings.css, settings/workspaces/project-row.tsx",
        fix: "The row's inner button drew a 1px inset box-shadow with square corners inside the row's highlight. The ring is now on the whole row (.settings-project-card:has(> button:first-child:focus-visible)), 2px, inset 2px, with its radius. The options button keeps its own ring.",
        render: () => (
          <div style={{ width: "360px" }}>
            <div role="listitem" data-component="settings-project-card" class="settings-project-card">
              <button
                type="button"
                class="flex h-full min-w-0 flex-1 items-center gap-2 rounded-[4px] bg-transparent text-start focus-visible:outline-none"
              >
                <ProjectAvatar fallback="O" variant="blue" class="!size-5" />
                <span class="text-[13px] font-[530]">opencode</span>
              </button>
            </div>
          </div>
        ),
      },
    ],
    also: [
      "Fixed: the sticky header's scroll margin (Models, above) now applies on every Settings page, not just Models (navigation.tsx).",
      "Section headings and Timeline detail controls lose their bottom stroke at the scrollport edge.",
      "Fixed: the selected Settings navigation tab looked the same focused and blurred. The tab ring above covers it.",
    ],
  },
  {
    name: "Consolidated navigation and other dev changes",
    cases: [
      {
        name: "Sidebar actions: New session, Sessions and Settings draw an outset ring",
        failure: "Inconsistent",
        target: '[data-action="vertical-tabs-home"]',
        keys: "With Consolidated navigation, Tab from Toggle sidebar to Sessions.",
        sizing: "Full-width 28px rows; the outset ring ran 2px past the row into the sidebar's padding.",
        source: "app/src/shell/titlebar/titlebar.tsx (SidebarAction), tab-nav.css",
        fix: "[data-titlebar-tab-action] rows draw the shared ring inset (-2px), as the session tabs below them do. That covers the sidebar actions, the recently closed list and project session rows.",
        render: () => (
          <div class="flex w-[240px] flex-col gap-[3px] bg-v2-background-bg-deep p-2">
            <For
              each={
                [
                  ["vertical-tabs-new", "edit", "New session"],
                  ["vertical-tabs-home", "sessions-stack", "Sessions"],
                  ["vertical-tabs-settings", "settings-gear", "Settings"],
                ] as const
              }
            >
              {([action, icon, label]) => (
                <button
                  type="button"
                  data-titlebar-tab-action
                  data-action={action}
                  class="group flex h-7 w-full items-center gap-2 rounded-[6px] px-2 text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-faint hover:text-v2-text-text-base"
                >
                  <Icon name={icon} class="shrink-0" />
                  <span class="min-w-0 truncate">{label}</span>
                </button>
              )}
            </For>
          </div>
        ),
      },
      {
        name: "Toggle sidebar: the ring loses 1px on the right",
        failure: "Clipped",
        target: '[aria-label="Toggle sidebar"]',
        keys: "Tab from New session to Toggle sidebar in the sidebar header.",
        sizing: "The 32px button sits flush with the sidebar's end edge, which clips.",
        source: "app/src/shell/sidebar-toggle.tsx",
        fix: "The toggle draws the shared ring inset (-2px), wherever it sits.",
        render: () => (
          <div class="flex h-9 w-[240px] items-center justify-end overflow-hidden bg-v2-background-bg-deep">
            <IconButton
              variant="ghost-muted"
              size="large"
              class="shrink-0 focus-visible:-outline-offset-2"
              aria-label="Toggle sidebar"
              icon={<Icon name="layout-left-full" />}
            />
          </div>
        ),
      },
      {
        name: "Recent and Inbox Show more: a full-width button with an outset ring cut at both sides",
        failure: "Clipped",
        target: '[data-component="button-v2"]',
        keys: "Tab past the last Recent row to Show more.",
        sizing: "w-full in the sidebar's scroller; the ring reached 4px past each side.",
        source: "app/src/shell/titlebar/recent-sessions.tsx, inbox.tsx",
        fix: "Show more, Show less and Archived draw the shared ring inset (-2px).",
        render: () => (
          <div class="w-[240px] overflow-y-auto">
            <Button
              variant="ghost-muted"
              size="normal"
              class="w-full justify-start px-2 focus-visible:-outline-offset-2"
            >
              Show more
            </Button>
          </div>
        ),
      },
      {
        name: "Inbox rows and headings: keyboard focus only changes the background",
        failure: "Inconsistent",
        target: '[data-slot="sidebar-inbox-item"]',
        keys: "With the Inbox layout, Tab into the list and move with the arrow keys.",
        sizing: "Roving focus: one row is the Tab stop, arrows move between rows.",
        source: "app/src/shell/titlebar/inbox.tsx",
        fix: "Roving focus shows a ring on the focused row. Rows and section headings take the shared ring inset (-2px); the selected row keeps its pressed background, so selection stays distinct.",
        render: () => (
          <div class="flex w-[260px] flex-col gap-1">
            <button
              type="button"
              aria-expanded="true"
              class="flex h-6 w-full items-center rounded-[6px] px-2 text-start text-[13px] leading-4 font-medium text-v2-text-text-muted focus-visible:-outline-offset-2"
            >
              Needs attention
            </button>
            <button
              type="button"
              data-slot="sidebar-inbox-item"
              class="flex h-[54px] w-full flex-col gap-1.5 rounded-[6px] p-2 text-start text-13-regular hover:bg-v2-overlay-simple-overlay-hover focus-visible:-outline-offset-2"
            >
              Refactor the session store
            </button>
          </div>
        ),
      },
      {
        name: "Tab groups: the header, colour swatches and menu draw no ring",
        failure: "Invisible",
        target: "[data-tab-group-header] button",
        keys: "With tab groups on, Tab to a group's header, then open its menu and Tab to the colours.",
        sizing: "The header fills its row; the swatches sit in a menu; the menu trigger is 20px.",
        source: "app/src/shell/titlebar/tab-groups-ui.tsx",
        fix: "All three suppressed the outline. The header and its menu trigger take the shared ring inset (-2px); swatches take the default ring, over the selected swatch's neutral ring.",
        render: () => (
          <div data-tab-group-header class="flex h-7 w-[240px] items-center gap-1 px-1">
            <button
              type="button"
              aria-expanded="true"
              class="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-[6px] px-1 text-start text-13-medium focus-visible:-outline-offset-2"
            >
              Release
            </button>
            <button
              type="button"
              aria-label="Group options"
              class="my-auto flex size-5 shrink-0 items-center justify-center rounded-[4px] text-v2-icon-icon-muted focus-visible:-outline-offset-2"
            >
              <Icon name="sliders" />
            </button>
          </div>
        ),
      },
      {
        name: "Mobile tabs drawer: New session, Home, Settings and Help only change the background",
        failure: "Inconsistent",
        target: '[data-action="mobile-tabs-new-session"]',
        keys: "Below the mobile breakpoint, open the tabs drawer and Tab past the tabs.",
        sizing: "Full-width rows in the drawer.",
        source: "app/src/shell/titlebar/titlebar.tsx",
        fix: "The rows take the shared ring inset (-2px); hover keeps its background.",
        render: () => (
          <button
            type="button"
            data-action="mobile-tabs-new-session"
            class="flex h-7 w-[260px] items-center gap-2 rounded-[6px] px-2 text-[13px] leading-4 hover:bg-v2-background-bg-layer-02 focus-visible:-outline-offset-2"
          >
            <Icon name="plus" />
            New session
          </button>
        ),
      },
      {
        name: "Model picker and MCP error: rows and Back only change the background",
        failure: "Inconsistent",
        target: '[data-component="settings-row"]',
        keys: "Open the model picker and Tab into the list; or open an MCP's error and Tab to Back.",
        sizing: "Full-width catalog rows; a 20px back button in the dialog header.",
        source: "app/src/providers/models/select-dialog.tsx, providers/connect/mcp-dialog.tsx",
        fix: "Rows that are Tab stops take the shared ring inset (-2px); the arrow-key highlight stays a background. Back takes the default ring.",
        render: () => (
          <div class="w-[360px]">
            <SettingsList variant="catalog">
              <button
                type="button"
                data-component="settings-row"
                class="w-full px-4 text-start hover:bg-v2-overlay-simple-overlay-hover focus-visible:-outline-offset-2"
              >
                <div data-slot="settings-row-copy">
                  <div data-slot="settings-row-title">Claude Sonnet 4.5</div>
                </div>
              </button>
            </SettingsList>
          </div>
        ),
      },
      {
        name: "Pinned group: keyboard focus only changes the background",
        failure: "Inconsistent",
        target: '[data-slot="pinned-group-trigger"]',
        keys: "With Consolidated navigation, pin sessions into a group, then Tab to the group.",
        sizing: "A 28px square in the clipped titlebar row; a full-width row in side tabs.",
        source: "app/src/shell/titlebar/pinned-area.tsx, pinned-area.css",
        fix: "The group takes the shared ring inset (-2px), like the pinned tabs beside it, and sits above the group's outline so it covers none of the ring.",
        render: () => (
          <div data-component="pinned-group" data-orientation="horizontal" class="relative flex items-center gap-1 p-1">
            <button
              type="button"
              data-slot="pinned-group-trigger"
              aria-label="Release"
              class="flex size-7 shrink-0 items-center justify-center rounded-[6px] hover:bg-v2-overlay-simple-overlay-hover focus-visible:-outline-offset-2"
            >
              <span class="size-3 rounded-[3px] bg-v2-background-bg-accent" />
            </button>
          </div>
        ),
      },
      {
        name: "Pinned group menu: Escape drops focus on the page",
        failure: "Lost",
        target: '[data-slot="pinned-group-trigger"]',
        keys: "In top tabs, focus a group and press Shift+F10 or right-click it, then Escape.",
        sizing: "The top-tabs menu's only trigger is a hidden span, so Kobalte had nothing to return to.",
        source: "app/src/shell/titlebar/pinned-area.tsx",
        fix: "The menu records how it opened (createOverlayFocus) and returns focus to the control that opened it: the group, or the ⋯ in side tabs.",
        render: () => (
          <button
            type="button"
            data-slot="pinned-group-trigger"
            aria-label="Release"
            class="flex size-7 items-center justify-center rounded-[6px] focus-visible:-outline-offset-2"
          >
            <span class="size-3 rounded-[3px] bg-v2-background-bg-accent" />
          </button>
        ),
      },
      {
        name: "Recent group heading: keyboard focus only changes the background",
        failure: "Inconsistent",
        target: "button[aria-expanded]",
        keys: "With Recent grouped by date, status or project, Tab to a heading.",
        sizing: "A full-width heading in the sidebar's scroller.",
        source: "app/src/shell/titlebar/recent-sessions.tsx",
        fix: "The heading takes the shared ring inset (-2px).",
        render: () => (
          <div class="w-[240px] overflow-y-auto">
            <button
              type="button"
              aria-expanded="true"
              class="flex h-6 w-full items-center gap-1 rounded-[6px] ps-2 pe-8 text-start text-[13px] leading-4 font-medium text-v2-text-text-muted focus-visible:-outline-offset-2"
            >
              Today
            </button>
          </div>
        ),
      },
      {
        name: "Recent view options: the ring loses its top edge",
        failure: "Clipped",
        target: '[data-slot="recent-view-trigger"]',
        keys: "With nothing pinned, Tab to the options button beside the Recent heading.",
        sizing: "A 20px button centred in a 24px heading at the top of the scroller.",
        source: "app/src/shell/titlebar/recent-view-menu.tsx",
        fix: "The trigger draws the shared ring inset (-2px), inside the scroller's edge.",
        render: () => (
          <div class="flex h-6 w-[240px] items-center justify-between overflow-y-auto ps-2 pe-1 text-13-medium">
            Recent
            <IconButton
              variant="ghost-muted"
              size="small"
              data-slot="recent-view-trigger"
              class="focus-visible:-outline-offset-2"
              aria-label="View options"
              icon={<Icon name="sliders" />}
            />
          </div>
        ),
      },
      {
        name: "Find previous and next: a 1px ring on an outline that is always there",
        failure: "Inconsistent",
        target: "button",
        keys: "Press ⌘F in a session, then Tab from the field to the arrows.",
        sizing: "20px buttons inside the compact Find field.",
        source: "app/src/session/timeline/search-bar.tsx",
        fix: "No outline at rest; the shared ring inset (-2px) with a 4px radius on keyboard focus, as the close button beside them does.",
        render: () => (
          <div class="flex items-center gap-0.5">
            <For each={["Previous match", "Next match"]}>
              {(label, index) => (
                <button
                  type="button"
                  aria-label={label}
                  class="flex size-5 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover focus-visible:-outline-offset-2"
                >
                  <Icon name="chevron-down" classList={{ "rotate-180": index() === 0 }} />
                </button>
              )}
            </For>
          </div>
        ),
      },
      {
        name: "Navigation mode: the selected card looks focused",
        failure: "Inconsistent",
        target: "input",
        keys: "In Settings › General with Consolidated on, look at the Tabs and List cards, then Tab onto one.",
        sizing: "The selected card had a focus-blue border and a focus-blue inset shadow.",
        source: "app/src/settings/general/interface-mode.css",
        fix: "As with the layout cards: a 2px neutral border, a check outside the corner and a faded sketch on the other card. Blue is only the keyboard ring.",
        render: () => <ModeCards group="navigation" />,
      },
      {
        name: "Home sessions: Shift+Tab hides the row under the sticky date header",
        failure: "Occluded",
        target: '[data-component="home-session-row"]',
        keys: "Scroll Home down, then Shift+Tab up through the sessions.",
        sizing:
          "The sticky search (68, 84 or 108px) and the 28px date header now stay at the top while the list scrolls.",
        source: "app/src/home/sessions/view.css",
        fix: "Rows take a top scroll-margin of 100, 116 or 140px, so focus scrolls them clear of both.",
        render: () => (
          <button
            type="button"
            data-component="home-session-row"
            class="flex h-10 w-[420px] items-center rounded-[6px] px-3 text-start"
          >
            Refactor the session store
          </button>
        ),
      },
    ],
    also: [
      "Rebased onto origin/dev, which retired the Projects sidebar (sidebar-organized.tsx) and added Consolidated navigation, Home's sticky date headers and Find's previous and next buttons. The Home project scope trigger it added also takes the ring and createOverlayFocus.",
    ],
  },
  {
    name: "Focus after removal",
    cases: [
      {
        name: "Tab strip: closing a background tab drops focus on the page",
        failure: "Lost",
        target: '[aria-label="Close Draft"]',
        keys: "Tab to a tab's close button and press Enter. Focus moves to the next tab, or the previous one after the last.",
        sizing: "Titlebar and sidebar tab strips. The right panel's Kobalte tabs select themselves on focus, so rescue stays out of them.",
        source: "ui/src/context/focus-rescue.tsx, app/src/shell/titlebar/tab-strip.tsx",
        fix: "Chromium leaves focus on <body> when the focused element goes, with no event. focus-rescue watches what had focus and, inside a [data-focus-scope], moves it to the next item, or the previous one after the last. The tab strips, the sidebar, the titlebar and the right panel are scopes.",
        render: () => <RemovalTabs />,
      },
      {
        name: "Settings rows: deleting a row from its confirm dialog drops focus",
        failure: "Lost",
        target: '[data-component="settings-row"]:nth-child(2) [data-component="button-v2"]',
        keys: "Tab to a row's Delete, press Enter, then confirm. Focus moves to the next row's Delete.",
        sizing:
          "Worktrees, providers, servers and every SettingsList. The dialog returns focus to the row before the row goes.",
        source: "ui/src/context/focus-rescue.tsx, app/src/settings/list.tsx, ui/src/context/dialog.tsx",
        fix: "SettingsList and the settings screen are scopes. When the dialog's opener is gone, focus moves from where that row was.",
        render: () => <RemovalSettingsRows />,
      },
      {
        name: "Row menu: removing a row from its own menu drops focus",
        failure: "Lost",
        target: '[aria-label="More for Website"]',
        keys: "Tab to a row's ⋯, press Enter, then choose Remove. Focus moves to the next row's ⋯.",
        sizing: "Home projects and sessions, servers, sidebar rows, line comments and queued messages.",
        source: "ui/src/context/focus-rescue.tsx, ui/src/navigation/menu/menu.tsx",
        fix: "The menu returns focus to its trigger, which went with the row. Focus rescue walks back past the menu's items to that trigger and moves focus from where its row was.",
        render: () => <RemovalRowMenu />,
      },
      {
        name: "Composer chips: removing the last chip drops focus",
        failure: "Lost",
        target: '[aria-label="Remove notes.md"]',
        keys: "Tab to a chip's remove button and press Enter. Focus moves to the next chip, and to the prompt after the last.",
        sizing: "Attachments, context files, comments and quotes above the prompt; the queue and the docks below it.",
        source:
          "ui/src/context/focus-rescue.tsx, app/src/composer/editor/editor.tsx, session/composer/session-composer-region.tsx",
        fix: "The chip row is a scope inside the composer dock's scope. With no chip left, focus widens to the dock and takes the next control after the row: the prompt.",
        render: () => <RemovalChips />,
      },
      {
        name: "Toasts: dismissing the only toast drops focus",
        failure: "Lost",
        target: '[aria-label="Dismiss"]',
        keys: "Press Show toast, Tab to the toast's Dismiss and press Enter. Focus returns to Show toast.",
        sizing: "Any toast with an action or dismiss button.",
        source: "ui/src/context/focus-rescue.tsx, ui/src/feedback/toast/toast.tsx",
        fix: "The toast region is a scope. Dismissing a toast moves focus to the next toast; when none is left, focus goes back to what had it before.",
        render: () => <RemovalToast />,
      },
      {
        name: "Inline rename: Enter ends the edit and drops focus",
        failure: "Lost",
        target: '[contenteditable="true"]',
        keys: "Edit the title, then press Enter. Focus returns to the tab.",
        sizing: "Titlebar tab titles, terminal tabs.",
        source: "ui/src/context/focus-rescue.tsx, app/src/shell/titlebar/tab-nav.tsx",
        fix: "A field that stops being editable stays in place. Focus moves to the control around it, here the tab link.",
        render: () => <RemovalRename />,
      },
      {
        name: "Reset: the button disables itself and drops focus",
        failure: "Lost",
        target: '[data-action="reset"]',
        keys: "Tab to Reset and press Enter. Focus moves to the next control.",
        sizing: "Settings › Shortcuts Reset, and any button disabled by its own action.",
        source: "ui/src/context/focus-rescue.tsx, app/src/settings/keybinds/keybinds.tsx",
        fix: "A focused control that becomes disabled counts as gone. Focus moves to the next control in its scope.",
        render: () => <RemovalReset />,
      },
    ],
    also: [
      "The same rule covers: Home sessions and projects, the sidebar's Inbox, Recent and pinned rows, the queue, the question and permission docks, banners above the composer, line comments, the review panel, the timeline's message menus, Show more buttons, and inline confirms in dialogs.",
      "An item inside an overlay (a menu item, a dialog button) leaves its overlay to return focus. Focus rescue steps in only when the overlay's opener is gone too, from where that opener was.",
    ],
  },
  {
    name: "Overlay focus return",
    cases: [
      {
        name: "Select: Escape after a click rings the trigger",
        failure: "Inconsistent",
        target: '[data-component="select-v2"]',
        keys: "Click the select, press Escape: no ring. Tab to it, press ArrowDown, then Escape or Enter: the ring returns.",
        sizing:
          "Any select. Kobalte returns focus with a plain focus(), and Chromium rings it because Escape is a key press.",
        source: "ui/src/forms/select/select.tsx, ui/src/context/overlay-focus.tsx",
        fix: "The wrapper records how the list opened (createOverlayFocus) and restores the trigger with that ring: none after a pointer open, the ring after a keyboard open, however it closed.",
        render: () => (
          <Select options={["English", "Deutsch", "Français"]} current="English" onSelect={() => undefined} />
        ),
      },
      {
        name: "Context menu: Escape after a right-click rings the row",
        failure: "Inconsistent",
        target: "button",
        keys: "Right-click the row, then press Escape: no ring.",
        sizing: "Any context menu: titlebar tabs, Home sessions and projects, file trees.",
        source: "ui/src/navigation/menu/menu.tsx (Menu.Context)",
        fix: "Context menus returned focus through Kobalte alone. They now record how they opened, as dropdown menus do, and return focus to what had it with that ring.",
        render: () => (
          <Menu.Context gutter={6}>
            <Menu.Context.Trigger>
              <button
                type="button"
                class="flex h-8 w-[260px] items-center rounded-md px-2 text-start text-13-regular hover:bg-v2-overlay-simple-overlay-hover focus-visible:-outline-offset-2"
              >
                Refactor the session store
              </button>
            </Menu.Context.Trigger>
            <Menu.Context.Portal>
              <Menu.Context.Content>
                <Menu.Item>Rename</Menu.Item>
                <Menu.Item>Archive</Menu.Item>
              </Menu.Context.Content>
            </Menu.Context.Portal>
          </Menu.Context>
        ),
      },
      {
        name: "Home project picker: no keyboard ring, then a ring after Escape",
        failure: "Invisible",
        target: '[data-component="home-projects-dropdown"]',
        keys: "On a narrow Home, Tab to the project picker. Click it and press Escape: no ring.",
        sizing: "Below the Home breakpoint, the picker replaces the projects panel and fills its column.",
        source: "app/src/home/projects/view.tsx",
        fix: "The trigger suppressed its outline, so it never showed focus. It now takes the shared ring inset (-2px), and the popover restores it with createOverlayFocus, as Select does.",
        render: () => <OverlayPopover component="home-projects-dropdown" label="All projects" width="280px" />,
      },
      {
        name: "Composer todo and plugin pills: Escape after a click rings the pill",
        failure: "Inconsistent",
        target: '[data-component="session-todo-pill"]',
        keys: "Click the todo pill, press Escape: no ring. Tab to it, press Enter, then Escape: the ring returns.",
        sizing: "The pills in the lane above the composer.",
        source: "app/src/session/composer/todo-pill.tsx, plugin-pills.tsx",
        fix: "Both popovers restore their pill with createOverlayFocus instead of Kobalte's plain focus().",
        render: () => <OverlayPopover component="session-todo-pill" label="2 of 5 done" />,
      },
    ],
    also: [
      "Reviewed, left as is: the Home browse dialog's fallback focus (home/projects/browse.tsx) runs only when the opener has gone; the mobile panel drawer's Back and the location picker's Choose return follow the key or click that closed them.",
      "The workspace selector (new-session/workspace/selector.tsx) returns focus to the composer.",
    ],
  },
  {
    name: "Provider dialogs",
    cases: [
      {
        name: "Connect provider list: Tab and arrow keys only change the background",
        failure: "Inconsistent",
        target: "[data-provider-id]",
        keys: "Open Connect, then press ArrowDown in the search field, or Tab into the list.",
        sizing: "Full-width rows in a scroller with no side padding.",
        source: "app/src/providers/connect/dialog.tsx (ProviderList)",
        fix: "The rows picked their background on :focus, so a click drew it too, and drew no ring. They now take the shared ring inset (-2px) on :focus-visible; hover and the arrow-key highlight keep the background.",
        render: () => (
          <div class="flex w-[320px] flex-col gap-0.5 overflow-y-auto">
            <For each={["OpenCode Zen", "Anthropic", "OpenAI"]}>
              {(name) => (
                <button
                  type="button"
                  data-provider-id={name}
                  class="flex min-h-8 w-full items-center gap-2 rounded-md py-1.5 ps-2 pe-2 text-left text-[13px] leading-5 tracking-[-0.04px] hover:bg-v2-overlay-simple-overlay-hover focus-visible:-outline-offset-2"
                >
                  <Icon name="server" class="shrink-0 text-v2-icon-icon-base" />
                  <span class="min-w-0 truncate font-[440] text-v2-text-text-base">{name}</span>
                </button>
              )}
            </For>
          </div>
        ),
      },
      {
        name: "Sign-in method: keyboard focus only changes the background",
        failure: "Inconsistent",
        target: '[data-action="provider-connect-method"]',
        keys: "Open Connect, choose a provider with more than one sign-in method, then Tab to a method.",
        sizing: "Full-width rows.",
        source: "app/src/providers/connect/dialog.tsx (MethodSelection)",
        fix: "The shared ring inset (-2px) replaces the background. The chevron still appears on hover and keyboard focus.",
        render: () => (
          <div class="flex w-[320px] flex-col">
            <For each={["Sign in with a browser", "Enter an API key"]}>
              {(label) => (
                <button
                  type="button"
                  data-action="provider-connect-method"
                  class="group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] leading-5 tracking-[-0.04px] hover:bg-v2-overlay-simple-overlay-hover focus-visible:-outline-offset-2"
                >
                  <Icon name="server" class="shrink-0 text-v2-icon-icon-muted" />
                  <span class="min-w-0 flex-1 truncate font-[530] text-v2-text-text-base">{label}</span>
                  <Icon
                    name="chevron-right"
                    class="shrink-0 text-v2-icon-icon-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                  />
                </button>
              )}
            </For>
          </div>
        ),
      },
      {
        name: "Paste the redirect URL: focus only underlines the toggle",
        failure: "Inconsistent",
        target: "button[aria-expanded]",
        keys: "Start a browser sign-in, then Tab to the paste toggle under the waiting button.",
        sizing: "The toggle stretches across the step, between its top and bottom borders.",
        source: "app/src/providers/connect/dialog.tsx (OAuth paste)",
        fix: "The underline is gone. The toggle takes a 6px radius and the shared ring inset (-2px), inside the borders.",
        render: () => (
          <div class="flex w-[320px] flex-col self-stretch border-y border-v2-border-border-muted text-13-regular">
            <button
              type="button"
              aria-expanded={false}
              class="flex h-12 items-center gap-1.5 rounded-md text-start font-[440] text-v2-text-text-base focus-visible:-outline-offset-2"
            >
              <Icon name="chevron-right" class="shrink-0 text-v2-icon-icon-muted" />
              Paste the redirect URL instead
            </button>
          </div>
        ),
      },
      {
        name: "Remote server label: focus only changes the text colour",
        failure: "Inconsistent",
        target: '[tabindex="0"]',
        keys: "Connect a provider on a remote server, then Tab to the server label in the dialog header.",
        sizing: "A compact label that opens a tooltip.",
        source: "app/src/providers/connect/dialog.tsx (DialogHeader)",
        fix: "The label uses the shared 2px outset ring with its 4px radius; the text colour no longer changes.",
        render: () => (
          <div data-slot="dialog-header" class="flex w-[320px] items-center justify-end p-4">
            <span
              tabindex="0"
              class="me-3 flex min-w-0 shrink-0 items-center gap-1.5 rounded-sm text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted"
            >
              <Icon name="server" class="shrink-0 text-v2-icon-icon-muted" />
              <span class="max-w-40 truncate">On devbox</span>
            </span>
          </div>
        ),
      },
      {
        name: "Choose a model, no paid provider: rows and cards only change the background",
        failure: "Inconsistent",
        target: "[data-provider-id]",
        keys: "Without a paid provider, open the model picker, then Tab or press ArrowDown.",
        sizing: "Full-width model rows, two-column provider cards and a full-width View more row.",
        source: "app/src/providers/models/unpaid.tsx",
        fix: "All three picked a background on :focus, so a click drew it too. Rows and View more take the shared ring inset (-2px); the cards have room, so they take it outset (2px). Hover keeps the background.",
        render: () => (
          <div class="flex w-[400px] flex-col items-start rounded-lg border-[0.5px] border-v2-border-border-muted bg-v2-background-bg-layer-02 p-2.5">
            <button
              type="button"
              class="flex w-full flex-row items-center gap-1.5 rounded-md px-3 py-2 text-left text-[13px] font-[530] leading-5 text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover focus-visible:-outline-offset-2"
            >
              Big Pickle
            </button>
            <div class="grid w-full grid-cols-2 gap-x-2 gap-y-1.5">
              <For each={["OpenCode Zen", "OpenCode Go"]}>
                {(name) => (
                  <button
                    type="button"
                    data-provider-id={name}
                    class="flex min-h-11 w-full flex-row items-start gap-2 rounded-md border-[0.5px] border-v2-border-border-strong bg-v2-background-bg-base px-3 py-2.5 text-left text-[13px] font-[530] leading-5 text-v2-text-text-base hover:bg-v2-background-bg-layer-01"
                  >
                    {name}
                  </button>
                )}
              </For>
              <button
                type="button"
                class="col-span-full flex h-8 w-full items-center justify-start rounded-md px-3 text-left text-[13px] font-[440] leading-5 text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover focus-visible:-outline-offset-2"
              >
                View more providers
              </button>
            </div>
          </div>
        ),
      },
    ],
    also: [],
  },
  {
    name: "Shared controls",
    cases: [
      ...(["palette-menu-row", "search-list-row"] as const).map(
        (row): Case => ({
          name: `${row === "palette-menu-row" ? "Palette" : "Search list"}: active option loses contrast in forced colours`,
          failure: "Invisible",
          target: "input",
          keys: "Enable forced colours and use the arrow keys while focus stays in the search input.",
          sizing: "Applies to active options rather than independent Tab stops.",
          source: `app/src/shell/${row === "palette-menu-row" ? "palette-menu" : "search-list"}.css`,
          fix: "Use system Highlight and HighlightText colours for the active option.",
          render: () => <SearchHighlightExample kind={row} />,
        }),
      ),
      {
        name: "Focus ring colour: the default did not adapt to the scheme",
        failure: "Inconsistent",
        target: "button",
        keys: "Switch Scheme between Light and Dark. With forced focus off, Tab to the button in each scheme.",
        sizing: "The ring keeps the same width and offset in both schemes.",
        source: "ui/src/styles/tokens/theme.css, ui/src/theme/v2/mapping.ts",
        fix: "Use Blue 500 in light mode and Blue 400 in dark mode. The Settings colour experiment is no longer needed.",
        render: () => <Button variant="neutral">Focus ring</Button>,
      },
      {
        name: "Links: the browser's orange, square ring",
        failure: "Inconsistent",
        target: "a",
        keys: "Tab to any link without its own focus rule, such as Help & feedback.",
        sizing: "Any width. The colour is the system accent, orange with an orange macOS accent.",
        source: "ui/src/styles/base.css",
        fix: "base.css makes the shared ring the default for every :focus-visible element, so nothing falls back to the browser's, and gives links a 4px radius like the other rings.",
        render: () => (
          <a
            href="#review-focus-visibility"
            class="inline-flex items-center gap-1.5 text-13-regular text-v2-text-text-muted underline"
          >
            Help &amp; feedback
            <Icon name="arrow-up-right" size="small" />
          </a>
        ),
      },
      {
        name: "Switch: a black ring flashes as focus arrives",
        failure: "Inconsistent",
        target: '[data-slot="switch-input"]',
        keys: "Tab onto a switch and watch the ring appear.",
        sizing: "Any width. Tab with forced colours enabled to check that the unfocused switch has no ring.",
        source: "ui/src/forms/switch/switch.css",
        fix: "Draw the full ring immediately on keyboard focus, with no outline at rest. In forced colours, a system-colour border keeps the track and thumb visible.",
        render: () => <Switch defaultChecked>Compact switch</Switch>,
      },
      {
        name: "Radio: forced colours show a ring before focus",
        failure: "Inconsistent",
        target: '[data-slot="radio-v2-item-input"]',
        keys: "Tab to the selected radio, then use an arrow key to move to the next radio.",
        sizing:
          "Reproduces in Chromium with forced colours enabled. The regular radio border is separate from its ring.",
        source: "ui/src/forms/radio/radio.css",
        fix: "Remove the transparent rest outline and show the focus ring immediately. A system-colour border and selected dot keep the radio visible in forced colours.",
        render: () => (
          <RadioGroup label="Output format" name="focus-visibility-radio" defaultValue="text">
            <RadioItem value="text" label="Text" />
            <RadioItem value="markdown" label="Markdown" />
          </RadioGroup>
        ),
      },
      {
        name: "Standard checkbox and switch: blue border and soft shadow",
        failure: "Inconsistent",
        target: '[data-slot="checkbox-checkbox-input"]',
        keys: "Tab onto a standard (legacy) checkbox or switch.",
        sizing: "Any width.",
        source: "ui/src/forms/checkbox/checkbox.css, switch/switch.css",
        fix: "Was a blue border with the --shadow-xs-border-focus box-shadow. Now the shared 2px outline at a 2px offset.",
        render: () => <Checkbox defaultChecked>Standard checkbox</Checkbox>,
      },
      {
        name: "Segmented control: ring runs into the next item",
        failure: "Clipped",
        target: '[data-slot="segmented-control-v2-item"]',
        keys: "Tab onto a segmented control.",
        sizing: "Any width. Items sit edge to edge in a 28px track.",
        source: "ui/src/navigation/segmented-control/segmented-control.css",
        fix: "Was 2px at a 1px offset, over the neighbouring item and the track. Now inset (-2px), inside the item.",
        render: () => (
          <SegmentedControl defaultValue="one" aria-label="Segmented">
            <SegmentedControlItem value="one">One</SegmentedControlItem>
            <SegmentedControlItem value="two">Two</SegmentedControlItem>
          </SegmentedControl>
        ),
      },
      {
        name: "Text field clear button: ring runs past the field's edge",
        failure: "Clipped",
        target: '[data-slot="text-input-v2-icon-button"]',
        keys: "Type in a clearable field, press Tab to the clear button.",
        sizing: "Any width. The button sits at the field's end.",
        source: "ui/src/forms/text-input/text-input.css",
        fix: "Was 2px at a 1px offset, over the field's border. Now inset (-2px), inside the button.",
        render: () => (
          <div style={{ width: "240px" }}>
            <TextInput value="Clearable" showClearButton clearLabel="Clear" />
          </div>
        ),
      },
      {
        name: "Busy button: the ring disappears while it works",
        failure: "Invisible",
        target: '[data-component="button-v2"]',
        keys: "Start a provider sign-in that waits for the browser, then Tab to the waiting button.",
        sizing: "Any Button with the loading variant that keeps focus.",
        source: "ui/src/actions/button/button.css, button.tsx, app/src/providers/connect/step-actions.tsx",
        fix: "The loading variant no longer drops the ring. The ring alone can't say whether the button works, so Button also sets aria-busy for it, and the spinner and its text show the wait.",
        render: () => <WaitingButton>Waiting for the browser…</WaitingButton>,
      },
      {
        name: "Accordion rows: the next row covers the bottom of the ring",
        failure: "Clipped",
        target: '[data-slot="accordion-trigger"]',
        keys: "Open the Context tab in the right panel and Tab through Raw messages.",
        sizing: "Rows overlap by 1px so their borders merge, and each sticky header has the same z-index.",
        source: "ui/src/data-display/accordion/accordion.css, ui/src/components/sticky-accordion-header.css",
        fix: "The header holding the focused trigger is raised above its neighbours, so the whole inset ring shows. Sticky headers rise above the other sticky headers.",
        render: () => (
          <div class="w-[420px]">
            <Accordion multiple>
              <For each={["user", "assistant", "idle"]}>
                {(role) => (
                  <Accordion.Item value={role}>
                    <StickyAccordionHeader>
                      <Accordion.Trigger>{role}</Accordion.Trigger>
                    </StickyAccordionHeader>
                    <Accordion.Content>Message</Accordion.Content>
                  </Accordion.Item>
                )}
              </For>
            </Accordion>
          </div>
        ),
      },
      {
        name: "Small controls: 2.5px and 1px offsets",
        failure: "Inconsistent",
        target: '[data-component="button-v2"]',
        keys: "Tab through any form.",
        sizing: "At 1x, a 2.5px offset lands on a half pixel and the ring's edges blur.",
        source: "ui button.css, icon-button.css, checkbox, switch, radio, select, field, and every app rule at 2.5px",
        fix: "One rule: 2px outset by default, -2px inset for rows and controls flush with a clipping or scrolling edge. 2.5px became 2px; compact switch, radio and the field info icon went from 1px to 2px.",
        render: () => (
          <div class="flex items-center gap-4">
            <Button variant="neutral">Button</Button>
            <Switch defaultChecked hideLabel>
              Compact switch
            </Switch>
          </div>
        ),
      },
    ],
    also: [],
  },
]

function FocusVisibility(props: VisibilityArgs) {
  onMount(() => onCleanup(installFocusRescue()))

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
          Where focus was clipped, covered, invisible or inconsistent with the shared ring, and how each was fixed. The
          cases stay here as checks that the fixes hold: each opens with its target focused and the dashed box marks
          where it is. Follow the keys to check it with real focus.
        </p>
      </header>
      <For each={surfaces}>
        {(surface, sectionIndex) => (
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
                {(item, caseIndex) => (
                  <CaseCard
                    case={item}
                    number={
                      surfaces.slice(0, sectionIndex()).reduce((count, section) => count + section.cases.length, 1) +
                      caseIndex()
                    }
                    forced={props.forced}
                    locator={props.locator}
                  />
                )}
              </For>
            </div>
            <Show when={surface.also.length}>
              <div style={{ display: "grid", gap: "4px" }}>
                <span style={{ ...label, color: "var(--v2-text-text-base)" }}>Same audit, not rendered here</span>
                <ul style={{ ...label, margin: "0", "padding-inline-start": "18px" }}>
                  <For each={surface.also}>{(line) => <li>{line}</li>}</For>
                </ul>
              </div>
            </Show>
          </section>
        )}
      </For>
    </main>
  )
}

function CaseCard(props: { case: Case; number: number; forced: boolean; locator: boolean }) {
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
        <span style={{ ...label, color: "var(--v2-text-text-base)", "font-weight": 530 }}>
          {props.number}. {props.case.name}
        </span>
        <span style={{ ...label, color: "var(--v2-state-fg-success)", "flex-shrink": 0 }}>
          Fixed · {props.case.failure}
        </span>
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
        {props.case.render(() => props.forced)}
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
        <dt>Fix</dt>
        <dd style={{ margin: "0", color: "var(--v2-text-text-base)" }}>{props.case.fix}</dd>
      </dl>
    </figure>
  )
}

function SearchHighlightExample(props: { kind: "home-session-search-row" | "palette-menu-row" | "search-list-row" }) {
  const [active, setActive] = createSignal(0)

  const list = createUniqueId()

  return (
    <div class="grid w-64 max-w-full gap-1">
      <input
        role="combobox"
        aria-label="Search results"
        aria-controls={list}
        aria-expanded={true}
        aria-activedescendant={`${list}-${active()}`}
        placeholder="Search results"
        class="rounded-[4px] px-2"
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return

          event.preventDefault()
          setActive((index) => 1 - index)
        }}
      />
      <div id={list} role="listbox">
        <For each={["Active option", "Next option"]}>
          {(label, index) => (
            <button
              id={`${list}-${index()}`}
              type="button"
              role="option"
              tabindex={-1}
              aria-selected={active() === index()}
              data-component={props.kind}
              data-active={active() === index() ? "" : undefined}
              class={
                props.kind === "home-session-search-row"
                  ? "flex h-9 w-full items-center rounded-[4px] px-2"
                  : props.kind
              }
              classList={{
                "bg-v2-overlay-simple-overlay-hover": props.kind === "home-session-search-row" && active() === index(),
              }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setActive(index())}
            >
              <span>{label}</span>
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

function TreeFocusExample() {
  return (
    <div
      data-slot="lab-tree-host"
      role="tree"
      aria-label="Example files"
      tabindex={0}
      class="w-56 outline-none"
      ref={(host) => {
        const root = host.attachShadow({ mode: "open" })

        const style = document.createElement("style")

        style.textContent = `
          ${treeFocusCss}
          ${treeFocusCss.replaceAll(":focus-visible", "[data-lab-focus]")}
          button { display: block; width: 100%; height: 28px; border: 0; border-radius: 4px;
            background: transparent; color: inherit; text-align: start; padding-inline: 8px; font: inherit; }
          button[aria-selected="true"] { background: var(--v2-overlay-simple-overlay-pressed); }
        `
        root.append(style)

        const rows = ["README.md", "index.ts"].map((name, index) => {
          const row = document.createElement("button")

          row.dataset.type = "item"
          row.dataset.itemFocused = String(index === 0)
          row.setAttribute("role", "treeitem")
          row.setAttribute("aria-selected", String(index === 0))
          row.tabIndex = -1
          row.textContent = name
          root.append(row)

          return row
        })

        host.onkeydown = (event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return

          event.preventDefault()
          rows.forEach((row, index) => (row.dataset.itemFocused = String(index === (event.key === "ArrowUp" ? 0 : 1))))
        }
      }}
    />
  )
}

// The Models page, with its header measured the way Settings measures it.
function ModelsPanel() {
  let panel: HTMLDivElement | undefined

  onMount(() => {
    const header = panel?.querySelector<HTMLElement>(".settings-tab-header")

    if (panel && header) onCleanup(trackTabHeader(panel, header))
  })

  return (
    <div ref={panel} class="settings-panel" style={{ width: "560px", height: "340px" }}>
      <div class="settings-tab-header settings-tab-header--stacked">
        <div class="settings-tab-header-row">
          <div class="flex min-w-0 flex-col gap-1">
            <h2 class="settings-tab-title">Models</h2>
            <span class="text-11-regular text-v2-text-text-muted">Choose which models appear in the model picker.</span>
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
          {/* The panel actions slot, here only the space side-region.tsx keeps for the panel toggle. */}
          <div
            data-slot="session-side-panel-actions"
            class="session-review-v2-open-in-app-slot h-[var(--tabs-bar-height)] shrink-0 flex items-center gap-2 pe-[var(--session-header-inset-end,12px)]"
          >
            <div class="size-7 shrink-0" aria-hidden />
          </div>
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

// The popover wiring the Home project picker and the composer pills share.
function OverlayPopover(props: { component: string; label: string; width?: string }) {
  const overlayFocus = createOverlayFocus()

  let trigger: HTMLButtonElement | undefined

  return (
    <Popover onOpenChange={overlayFocus.openChanged} placement="bottom-start" gutter={6}>
      <Popover.Trigger
        ref={trigger}
        data-component={props.component}
        class="flex h-8 items-center gap-2 rounded-[6px] px-2 text-start text-13-regular hover:bg-v2-background-bg-layer-01 focus-visible:-outline-offset-2"
        style={{ width: props.width }}
      >
        {props.label}
        <Icon name="chevron-down" class="shrink-0 text-v2-icon-icon-muted" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          class="z-50 rounded-[10px] bg-v2-background-bg-base p-3 text-13-regular shadow-[var(--v2-elevation-floating)] outline-none"
          onCloseAutoFocus={(event) => overlayFocus.restore(event, trigger)}
        >
          Popover content
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}

function RemovalTabs() {
  const [tabs, setTabs] = createSignal(["Refactor store", "Draft", "Fix tests", "Release notes"])

  return (
    <div class="flex flex-col items-start gap-3">
      <div data-focus-scope class="flex items-center gap-1 rounded-[8px] bg-v2-background-bg-deep p-1">
        <For each={tabs()}>
          {(tab) => (
            <div class="flex h-7 items-center rounded-[6px] bg-v2-background-bg-base ps-2">
              <a href="#" class="rounded-[4px] text-13-regular" onClick={(event) => event.preventDefault()}>
                {tab}
              </a>
              <IconButton
                variant="ghost-muted"
                icon={<Icon name="close-small" />}
                aria-label={`Close ${tab}`}
                onClick={() => setTabs((list) => list.filter((item) => item !== tab))}
              />
            </div>
          )}
        </For>
      </div>
      <Button
        size="small"
        variant="ghost"
        onClick={() => setTabs(["Refactor store", "Draft", "Fix tests", "Release notes"])}
      >
        Restore tabs
      </Button>
    </div>
  )
}

function RemovalSettingsRows() {
  const dialog = useDialog()

  const initial = ["main", "focus-rings", "session-store"]

  const [rows, setRows] = createSignal(initial)

  const confirm = (name: string) =>
    dialog.show(() => (
      <Dialog>
        <DialogHeader>
          <DialogTitle>Delete {name}?</DialogTitle>
        </DialogHeader>
        <DialogBody>The worktree and its changes are removed.</DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              dialog.close()
              // The row goes once the request returns, after the dialog has returned focus to it.
              setTimeout(() => setRows((list) => list.filter((item) => item !== name)), 300)
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </Dialog>
    ))

  return (
    <div class="flex w-[420px] flex-col items-start gap-3">
      <SettingsList>
        <For each={rows()}>
          {(name) => (
            <SettingsRow title={name} description="Worktree">
              <Button size="small" onClick={() => confirm(name)}>
                Delete
              </Button>
            </SettingsRow>
          )}
        </For>
      </SettingsList>
      <Button size="small" variant="ghost" onClick={() => setRows(initial)}>
        Restore rows
      </Button>
    </div>
  )
}

function RemovalChips() {
  const initial = ["notes.md", "store.ts", "plan.md"]

  const [chips, setChips] = createSignal(initial)

  return (
    <div data-focus-scope class="flex w-[420px] flex-col gap-2 rounded-[12px] border border-v2-border-border-base p-2">
      <div data-focus-scope class="flex gap-1.5">
        <For each={chips()}>
          {(chip) => (
            <span class="flex h-6 items-center gap-1 rounded-[6px] bg-v2-background-bg-layer-02 ps-2 text-12-regular">
              {chip}
              <IconButton
                variant="ghost-muted"
                size="small"
                icon={<Icon name="close-small" />}
                aria-label={`Remove ${chip}`}
                onClick={() => setChips((list) => list.filter((item) => item !== chip))}
              />
            </span>
          )}
        </For>
      </div>
      <textarea
        aria-label="Prompt"
        class="h-12 resize-none bg-transparent px-2 text-13-regular"
        placeholder="Ask anything"
      />
      <Button size="small" variant="ghost" class="self-start" onClick={() => setChips(initial)}>
        Restore chips
      </Button>
    </div>
  )
}

function RemovalToast() {
  const [shown, setShown] = createSignal(true)

  return (
    <div class="flex items-start gap-4">
      <Button size="small" onClick={() => setShown(true)}>
        Show toast
      </Button>
      <div data-focus-scope class="w-[280px]">
        <Show when={shown()}>
          <div
            tabindex="0"
            class="flex items-center justify-between gap-2 rounded-[10px] bg-v2-background-bg-base p-3 text-13-regular shadow-[var(--v2-elevation-floating)]"
          >
            Session archived
            <IconButton
              variant="ghost-muted"
              icon={<Icon name="close-small" />}
              aria-label="Dismiss"
              onClick={() => setShown(false)}
            />
          </div>
        </Show>
      </div>
    </div>
  )
}

function RemovalRename() {
  const [editing, setEditing] = createSignal(true)

  return (
    <div data-focus-scope class="flex items-center gap-2">
      <a
        href="#"
        class="flex h-7 items-center rounded-[6px] bg-v2-background-bg-base px-2 text-13-regular"
        onClick={(event) => event.preventDefault()}
      >
        <span
          contenteditable={editing() ? "true" : undefined}
          class="outline-none"
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            setEditing(false)
          }}
        >
          Refactor store
        </span>
      </a>
      <Button size="small" variant="ghost" onClick={() => setEditing(true)}>
        Rename
      </Button>
    </div>
  )
}

function RemovalReset() {
  const [changed, setChanged] = createSignal(true)

  return (
    <div data-focus-scope class="flex items-center gap-2">
      <Button size="small" data-action="reset" disabled={!changed()} onClick={() => setChanged(false)}>
        Reset
      </Button>
      <Button size="small" variant="ghost" onClick={() => setChanged(true)}>
        Change a shortcut
      </Button>
    </div>
  )
}

function RemovalRowMenu() {
  const initial = ["Desktop", "Website", "Docs"]

  const [rows, setRows] = createSignal(initial)

  return (
    <div class="flex w-[320px] flex-col items-start gap-3">
      <div data-focus-scope class="flex w-full flex-col">
        <For each={rows()}>
          {(row) => (
            <div class="flex h-8 items-center justify-between rounded-[6px] ps-2 text-13-regular">
              {row}
              <Menu gutter={4} placement="bottom-end">
                <Menu.Trigger
                  as={IconButton}
                  variant="ghost-muted"
                  icon={<Icon name="outline-dots" />}
                  aria-label={`More for ${row}`}
                />
                <Menu.Portal>
                  <Menu.Content>
                    <Menu.Item>Rename</Menu.Item>
                    <Menu.Item onSelect={() => setRows((list) => list.filter((item) => item !== row))}>
                      Remove
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Portal>
              </Menu>
            </div>
          )}
        </For>
      </div>
      <Button size="small" variant="ghost" onClick={() => setRows(initial)}>
        Restore rows
      </Button>
    </div>
  )
}

// The selected style both card groups in Settings › General share: a 2px neutral border and a check at the corner.
function ModeCards(props: { group: "interface" | "navigation" }) {
  const name = createUniqueId()

  const labels = props.group === "interface" ? ["Top tabs", "Side tabs", "Inbox"] : ["Tabs", "List"]

  return (
    <fieldset data-component={props.group === "interface" ? "interface-mode" : "navigation-mode"}>
      <For each={labels}>
        {(label, index) => (
          <label data-slot={`${props.group}-mode-option`} data-checked={index() === 0 ? "" : undefined}>
            <input type="radio" name={name} checked={index() === 0} />
            <span data-slot={`${props.group}-mode-sketch`} aria-hidden="true" />
            <span data-slot={`${props.group}-mode-name`}>{label}</span>
            <Show when={index() === 0}>
              <span data-slot="mode-option-check" aria-hidden="true">
                <Icon name="check" size="small" />
              </span>
            </Show>
          </label>
        )}
      </For>
    </fieldset>
  )
}
