import type {
  JsonValue,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from "@opencode/client/promise"
import { createTwoFilesPatch, diffLines } from "diff"
import type { SessionDocument } from "../../document"
import { CURRENT_SESSION_ID, STORY_MODEL } from "../../storybook/current-session-fixtures"

/**
 * A scripted session is a list of beats. Each beat takes one or more steps of the playhead: a tool call starts and then
 * finishes, a thought starts empty, streams, and then finishes. Dragging the playhead replays the session up to that step
 * with the same message shapes the server streams, so the timeline shows its live and finished states.
 */
export type Beat =
  | { kind: "user"; text: string }
  | { kind: "shell"; command: string; output: string; exit: number }
  | { kind: "goal"; objective: string }
  /** A background subagent or shell reporting back, as the server delivers it. */
  | {
      kind: "report"
      source: "subagent" | "shell"
      state: "completed" | "error" | "cancelled"
      description: string
      agent?: string
      /** The subagent's session or the shell that reports, which the timeline links to. */
      childID?: string
      shellID?: string
    }
  | { kind: "model"; id: string }
  | { kind: "step" }
  | { kind: "think"; text: string }
  | { kind: "say"; text: string }
  | {
      kind: "tool"
      name: string
      input: Record<string, JsonValue>
      output?: string
      metadata?: Record<string, JsonValue>
      error?: string
      /** Still running when the next beat arrives, such as a command the user interrupts. */
      hold?: boolean
    }
  | { kind: "interrupt" }
  | { kind: "idle" }

const steps: Record<Beat["kind"], number> = {
  user: 1,
  shell: 2,
  goal: 1,
  report: 1,
  model: 1,
  step: 0,
  think: 3,
  say: 2,
  tool: 2,
  interrupt: 1,
  idle: 1,
}

export function ticks(beat: Beat) {
  return beat.kind === "tool" && beat.hold ? 1 : steps[beat.kind]
}

// Files the scripted sessions change, before and after, so their diffs read like edits inside real code.
const generalBefore = `import { For, Show, createMemo } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettings } from "@/settings/model"
import { SettingsRow } from "./row"
import { SettingsSection } from "./section"
import { FontPicker } from "./font-picker"
import { LanguagePicker } from "./language-picker"

export function GeneralSettings() {
  const language = useLanguage()
  const settings = useSettings()

  const fonts = createMemo(() => settings.fonts.available())

  return (
    <SettingsSection title={language.t("settings.general.title")}>
      <SettingsRow
        title={language.t("settings.general.language")}
        description={language.t("settings.general.languageDescription")}
      >
        <LanguagePicker value={settings.general.language} onChange={settings.setLanguage} />
      </SettingsRow>
      <SettingsRow title={language.t("settings.general.font")}>
        <FontPicker fonts={fonts()} value={settings.general.font} onChange={settings.setFont} />
      </SettingsRow>
      <Show when={settings.general.advanced}>
        <SettingsRow title={language.t("settings.general.telemetry")}>
          <For each={settings.telemetry.options}>{(option) => <span>{option.label}</span>}</For>
        </SettingsRow>
      </Show>
    </SettingsSection>
  )
}
`

const generalAfter = generalBefore
  .replace(
    `import { LanguagePicker } from "./language-picker"\n`,
    `import { LanguagePicker } from "./language-picker"\nimport { ThemeToggle } from "./theme-toggle"\n`,
  )
  .replace(
    `      <SettingsRow title={language.t("settings.general.font")}>
        <FontPicker fonts={fonts()} value={settings.general.font} onChange={settings.setFont} />
      </SettingsRow>
`,
    `      <SettingsRow title={language.t("settings.general.font")}>
        <FontPicker fonts={fonts()} value={settings.general.font} onChange={settings.setFont} />
      </SettingsRow>
      <SettingsRow
        title={language.t("settings.general.darkMode")}
        description={language.t("settings.general.darkModeDescription")}
      >
        <ThemeToggle />
      </SettingsRow>
`,
  )

const schemeBefore = `import { createSignal } from "solid-js"
import { persisted } from "@/runtime/persist"

export type ColorScheme = "light" | "dark" | "system"

const query = window.matchMedia("(prefers-color-scheme: dark)")

const [stored, setStored] = persisted<ColorScheme>("theme.scheme", "system")
const [system, setSystem] = createSignal<"light" | "dark">(query.matches ? "dark" : "light")

query.addEventListener("change", (event) => setSystem(event.matches ? "dark" : "light"))

/** The scheme the app renders with, after resolving "system" against the OS setting. */
export function resolvedScheme() {
  const value = stored()

  return value === "system" ? system() : value
}

export function storedScheme() {
  return stored()
}

export function applyScheme(root: HTMLElement) {
  root.dataset.scheme = resolvedScheme()
  root.style.colorScheme = resolvedScheme()
}
`

const schemeAfter = schemeBefore
  .replace(
    `export function storedScheme() {
  return stored()
}
`,
    `export function storedScheme() {
  return stored()
}

/** Sets the scheme and applies it straight away, so the page never shows the old one. */
export function setScheme(value: ColorScheme) {
  setStored(value)
  applyScheme(document.documentElement)
}
`,
  )
  .replace(
    `  root.dataset.scheme = resolvedScheme()\n  root.style.colorScheme = resolvedScheme()\n`,
    `  const scheme = resolvedScheme()\n\n  root.dataset.scheme = scheme\n  root.style.colorScheme = scheme\n`,
  )

const themeIndexBefore = `export { applyScheme, resolvedScheme, storedScheme, type ColorScheme } from "./scheme"
export { ThemeProvider, useTheme } from "./provider"
export { tokens } from "./tokens"
`

const themeIndexAfter = themeIndexBefore.replace(
  "applyScheme, resolvedScheme, storedScheme,",
  "applyScheme, resolvedScheme, setScheme, storedScheme,",
)

const toggleFirst = `import { Switch } from "@opencode/ui/switch"
import { useLanguage } from "@/runtime/i18n/language"
import { resolvedScheme, setScheme } from "@/theme"

/** Switches between the light and dark scheme. Turning it off follows the system again. */
export function ThemeToggle() {
  const language = useLanguage()

  return (
    <Switch
      checked={resolvedScheme() === "dark"}
      aria-label={language.t("settings.general.darkMode")}
      onChange={(checked) => setScheme(checked ? "dark" : "system")}
    />
  )
}
`

const toggleFixed = toggleFirst
  .replace(
    `import { useLanguage } from "@/runtime/i18n/language"\n`,
    `import { createEffect } from "solid-js"\nimport { useLanguage } from "@/runtime/i18n/language"\n`,
  )
  .replace(
    `  const language = useLanguage()\n`,
    `  const language = useLanguage()\n\n  // The store subscribes after mount, so read the scheme in an effect rather than once while rendering.\n  createEffect(() => resolvedScheme())\n`,
  )

const docsBefore = `# Settings

Open Settings from the app menu, or press Cmd+, on macOS and Ctrl+, elsewhere.

## General

### Language

Choose the language the app uses. It follows your system language until you pick one.

### Font

Choose the font for the timeline and the editor. Monospaced fonts apply to code only.

## Keyboard shortcuts

Every command lists its shortcut. Click a shortcut to change it.
`

const docsAfter = docsBefore.replace(
  `### Font

Choose the font for the timeline and the editor. Monospaced fonts apply to code only.
`,
  `### Font

Choose the font for the timeline and the editor. Monospaced fonts apply to code only.

### Dark mode

Turn on **Dark mode** to use the dark color scheme everywhere in the app.

- Turning it off follows your system setting again.
- The setting applies straight away, without a restart.
- It is stored on this device, so each computer keeps its own choice.

The terminal and code views follow the same scheme. To give code a different theme,
choose one under **Settings → Editor → Theme**.
`,
)

const changelogBefore = `# Changelog

## Unreleased

### Added

- Search across every open session from the command palette.

### Fixed

- The timeline keeps its scroll position when a long diff loads.

## 1.14.0

### Added

- Pin sessions to the top of the sidebar.
`

const changelogAfter = changelogBefore.replace(
  `- Search across every open session from the command palette.\n`,
  `- Search across every open session from the command palette.\n- A **Dark mode** toggle in Settings → General.\n`,
)

/** A file change as the server records it: a jsdiff patch with its line counts, like core's `fileDiff`. */
function change(file: string, before: string, after: string, status: "modified" | "added" = "modified") {
  const counts = diffLines(before, after).reduce(
    (result, item) => ({
      additions: result.additions + (item.added ? (item.count ?? 0) : 0),
      deletions: result.deletions + (item.removed ? (item.count ?? 0) : 0),
    }),
    { additions: 0, deletions: 0 },
  )

  return { file, status, ...counts, patch: createTwoFilesPatch(file, file, before, after) }
}

const settingsFiles = [
  "src/settings/general.tsx",
  "src/settings/editor.tsx",
  "src/settings/keyboard.tsx",
  "src/settings/row.tsx",
  "src/settings/section.tsx",
  "src/settings/font-picker.tsx",
].join("\n")

const colorSchemeMatches = [
  "src/theme/provider.tsx:12: const scheme = colorScheme()",
  "src/theme/provider.tsx:18: root.style.colorScheme = scheme",
  'src/app.tsx:40: <meta name="color-scheme" content={colorScheme()} />',
  "src/settings/general.tsx:31: // colorScheme lives in the theme store",
].join("\n")

const themeListing = ["index.ts", "provider.tsx", "scheme.ts", "scheme.test.ts", "tokens.ts"].join("\n")

const schemeSearchResults = [
  "Title: prefers-color-scheme - CSS | MDN",
  "URL: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme",
  "",
  "Title: Building a theme switch component | web.dev",
  "URL: https://web.dev/articles/building/a-theme-switch-component",
  "",
  "Title: The best light/dark mode theme toggle in JavaScript",
  "URL: https://whitep4nth3r.com/blog/best-light-dark-mode-theme-toggle-javascript/",
].join("\n")

const safariSearchResults = [
  "Title: Dark Mode Support in WebKit",
  "URL: https://webkit.org/blog/8840/dark-mode-support-in-webkit/",
  "",
  "Title: color-scheme - CSS | MDN",
  "URL: https://developer.mozilla.org/en-US/docs/Web/CSS/color-scheme",
].join("\n")

const mdnPage =
  "# prefers-color-scheme\n\nThe prefers-color-scheme CSS media feature detects whether a user has asked for a light or dark color theme."

const featureWork: Beat[] = [
  { kind: "user", text: "Add a dark mode toggle to the settings page and make sure the tests pass." },
  {
    kind: "think",
    text: "## Finding the settings page\n\nI need to find where the settings rows render and how the theme is stored before adding a toggle.",
  },
  {
    kind: "tool",
    name: "glob",
    input: { pattern: "src/settings/**/*.tsx", path: "/workspace" },
    output: settingsFiles,
    metadata: { count: 6 },
  },
  {
    kind: "tool",
    name: "grep",
    input: { pattern: "colorScheme", path: "/workspace/src", include: "*.tsx" },
    output: colorSchemeMatches,
    metadata: { matches: 4 },
  },
  { kind: "tool", name: "read", input: { path: "/workspace/src/settings/general.tsx" }, output: generalBefore },
  { kind: "tool", name: "read", input: { path: "/workspace/src/theme/scheme.ts" }, output: schemeBefore },
  { kind: "step" },
  {
    kind: "say",
    text: "The settings page renders its rows from `general.tsx`, and the theme keeps the scheme in `scheme.ts`. I'll add a toggle row that writes the scheme.",
  },
  {
    kind: "think",
    text: "## Adding the toggle\n\nA new component keeps the row small. The scheme store needs a setter the row can call.",
  },
  {
    kind: "tool",
    name: "write",
    input: { path: "/workspace/src/settings/theme-toggle.tsx", content: toggleFirst },
    metadata: { files: [change("/workspace/src/settings/theme-toggle.tsx", "", toggleFirst, "added")] },
  },
  {
    kind: "tool",
    name: "edit",
    input: { path: "/workspace/src/settings/general.tsx", oldString: "before", newString: "after" },
    metadata: { files: [change("/workspace/src/settings/general.tsx", generalBefore, generalAfter)] },
  },
  {
    kind: "tool",
    name: "patch",
    input: { patchText: "*** Begin Patch" },
    metadata: {
      files: [
        change("/workspace/src/theme/scheme.ts", schemeBefore, schemeAfter),
        change("/workspace/src/theme/index.ts", themeIndexBefore, themeIndexAfter),
      ],
    },
  },
  { kind: "step" },
  {
    kind: "tool",
    name: "shell",
    input: { command: "bun test src/settings", description: "Run the settings tests" },
    output: 'settings.test.tsx:\n✗ toggles the scheme\n  Expected: "dark"\n  Received: "light"\n\n1 fail, 11 pass',
    metadata: { exit: 1 },
  },
  {
    kind: "think",
    text: "The toggle writes the scheme before the store subscribes. Reading it in an effect fixes it.",
  },
  {
    kind: "tool",
    name: "edit",
    input: { path: "/workspace/src/settings/theme-toggle.tsx", oldString: "before", newString: "after" },
    metadata: { files: [change("/workspace/src/settings/theme-toggle.tsx", toggleFirst, toggleFixed)] },
  },
  {
    kind: "tool",
    name: "shell",
    input: { command: "bun test src/settings", description: "Run the settings tests" },
    output: "12 pass, 0 fail",
    metadata: { exit: 0 },
  },
  { kind: "step" },
  {
    kind: "say",
    text: "Added a **Dark mode** toggle to General settings. It writes the color scheme through the theme store, and the settings tests pass.",
  },
  { kind: "idle" },
  {
    kind: "shell",
    command: "git status --short",
    output: " M src/settings/general.tsx\n M src/theme/scheme.ts\n?? src/settings/theme-toggle.tsx",
    exit: 0,
  },
  { kind: "goal", objective: "Ship dark mode with docs and a changelog entry" },
  {
    kind: "think",
    text: "## Checking conventions\n\nI should match how other apps document a color scheme preference.",
  },
  {
    kind: "tool",
    name: "websearch",
    input: { query: "prefers-color-scheme settings toggle best practices" },
    output: schemeSearchResults,
  },
  {
    kind: "tool",
    name: "webfetch",
    input: { url: "https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme" },
    output: mdnPage,
  },
  { kind: "tool", name: "skill", input: { name: "docs-style" }, metadata: { name: "docs-style" } },
  { kind: "step" },
  {
    kind: "tool",
    name: "write",
    input: { path: "/workspace/docs/settings.md", content: docsAfter },
    metadata: { files: [change("/workspace/docs/settings.md", docsBefore, docsAfter)] },
  },
  {
    kind: "tool",
    name: "execute",
    input: {
      code: 'const issue = await tools.linear.create_issue({ title: "Announce dark mode", team: "Desktop" })\nawait tools.slack.post_message({ channel: "#desktop", text: issue.url })\nreturn issue.id',
    },
    output: "DES-412",
    metadata: {
      toolCalls: [
        { tool: "search", status: "completed", input: { query: "linear" } },
        { tool: "linear.create_issue", status: "completed", input: { title: "Announce dark mode", team: "Desktop" } },
        { tool: "slack.post_message", status: "completed", input: { channel: "#desktop" } },
      ],
    },
  },
  {
    kind: "tool",
    name: "subagent",
    input: { agent: "review", description: "Review the dark mode change", prompt: "Review the diff." },
    output: "Looks good. One nit: name the store setter `setScheme`.",
    metadata: { sessionID: "session_child_review", status: "completed" },
  },
  { kind: "tool", name: "shell", input: { command: "bun run build", description: "Build the app" }, hold: true },
  { kind: "interrupt" },
  { kind: "model", id: "fast-nano" },
  { kind: "user", text: "Skip the build, just add the changelog entry." },
  {
    kind: "think",
    text: "## Writing the changelog\n\nThe entry goes under the next release. I'll keep it to one line that names the setting.",
  },
  {
    kind: "tool",
    name: "edit",
    input: { path: "/workspace/CHANGELOG.md", oldString: "before", newString: "after" },
    metadata: { files: [change("/workspace/CHANGELOG.md", changelogBefore, changelogAfter)] },
  },
  { kind: "step" },
  { kind: "say", text: "Added the changelog entry under the next release." },
  { kind: "idle" },
]

// Every tool the timeline draws, finished and failed, so each row and its expanded view can be checked in one place.
const everyTool: Beat[] = [
  { kind: "user", text: "Audit how the app handles the color scheme, and file anything broken." },
  { kind: "tool", name: "list", input: { path: "/workspace/src/theme" }, output: themeListing },
  {
    kind: "tool",
    name: "glob",
    input: { pattern: "src/**/*.{test,spec}.tsx", path: "/workspace" },
    output: "src/settings/settings.test.tsx\nsrc/theme/scheme.test.ts",
    metadata: { count: 2 },
  },
  {
    kind: "tool",
    name: "glob",
    input: { pattern: "src/**/[*.tsx", path: "/workspace" },
    error: "Invalid glob pattern: unclosed character class in src/**/[*.tsx",
  },
  {
    kind: "tool",
    name: "grep",
    input: { pattern: "matchMedia", path: "/workspace/src", include: "*.ts" },
    output: 'src/theme/scheme.ts:6: const query = window.matchMedia("(prefers-color-scheme: dark)")',
    metadata: { matches: 1 },
  },
  { kind: "tool", name: "read", input: { path: "/workspace/src/theme/scheme.ts" }, output: schemeBefore },
  {
    kind: "tool",
    name: "read",
    input: { path: "/workspace/src/theme/provider.tsx" },
    output: "export function ThemeProvider() {}",
  },
  { kind: "tool", name: "read", input: { path: "/workspace/src/theme/tokens.ts" }, output: "export const tokens = {}" },
  {
    kind: "tool",
    name: "read",
    input: { path: "/workspace/src/theme/legacy.ts" },
    error: "File not found: /workspace/src/theme/legacy.ts",
  },
  { kind: "step" },
  {
    kind: "tool",
    name: "websearch",
    input: { query: "safari color-scheme meta tag flash of light theme" },
    output: safariSearchResults,
  },
  {
    kind: "tool",
    name: "websearch",
    input: { query: '"applyScheme" opencode theme flash' },
    output: "No results found.",
  },
  {
    kind: "tool",
    name: "webfetch",
    input: { url: "https://webkit.org/blog/8840/dark-mode-support-in-webkit/" },
    output: "# Dark Mode Support in WebKit\n\nThe color-scheme meta tag tells WebKit which schemes a page supports.",
  },
  {
    kind: "tool",
    name: "webfetch",
    input: { url: "https://internal.example.com/design/theme-spec" },
    error: "Request failed with status 403 Forbidden",
  },
  { kind: "tool", name: "skill", input: { name: "bug-report" }, metadata: { name: "bug-report" } },
  { kind: "step" },
  {
    kind: "say",
    text: "The scheme applies after the first paint, so Safari flashes the light theme on load. I'll file it and check the fix with a test.",
  },
  {
    kind: "tool",
    name: "linear_create_issue",
    input: { title: "Light theme flashes on load in Safari", team: "Desktop" },
    output: "Created DES-418: https://linear.app/opencode/issue/DES-418",
  },
  {
    kind: "tool",
    name: "slack_post_message",
    input: { channel: "#desktop", text: "Filed DES-418" },
    error: "MCP server slack is not connected",
  },
  {
    kind: "tool",
    name: "execute",
    input: {
      code: 'const issue = await tools.linear.get_issue({ id: "DES-418" })\nawait tools.linear.add_label({ id: issue.id, label: "regression" })\nreturn issue.url',
    },
    output: "linear.add_label: label regression does not exist",
    metadata: {
      error: true,
      toolCalls: [
        { tool: "linear.get_issue", status: "completed", input: { id: "DES-418" } },
        { tool: "linear.add_label", status: "error", input: { id: "DES-418", label: "regression" } },
      ],
    },
  },
  { kind: "step" },
  {
    kind: "tool",
    name: "edit",
    input: { path: "/workspace/src/theme/scheme.ts", oldString: "missing", newString: "after" },
    error: "oldString not found in /workspace/src/theme/scheme.ts",
  },
  {
    kind: "tool",
    name: "edit",
    input: { path: "/workspace/src/theme/scheme.ts", oldString: "before", newString: "after" },
    metadata: { files: [change("/workspace/src/theme/scheme.ts", schemeBefore, schemeAfter)] },
  },
  {
    kind: "tool",
    name: "shell",
    input: { command: "bun test src/theme", description: "Run the theme tests" },
    output:
      "scheme.test.ts:\n✓ resolves the system scheme\n✓ applies the stored scheme\n✓ sets the scheme straight away\n✓ keeps the scheme after a reload\n\n4 pass, 0 fail",
    metadata: { exit: 0 },
  },
  {
    kind: "tool",
    name: "shell",
    input: { command: "bun run lint src/theme", description: "Lint the theme" },
    output:
      "src/theme/scheme.ts\n  14:3  error  Unexpected console statement  no-console\n\n1 problem (1 error, 0 warnings)",
    metadata: { exit: 1 },
  },
  {
    kind: "tool",
    name: "subagent",
    input: { agent: "review", description: "Review the scheme fix", prompt: "Review the diff." },
    error: "The subagent stopped: the model is overloaded",
    metadata: { sessionID: "session_child_review_failed" },
  },
  { kind: "step" },
  {
    kind: "say",
    text: "Filed **DES-418** and fixed the flash: the scheme now applies before the first paint. Tests pass; lint flags one stray `console` call.",
  },
  { kind: "idle" },
]

// Subagents and shells the agent starts in the background, how they report back, and subagents it waits on.
const backgroundWork: Beat[] = [
  { kind: "user", text: "Review the theme code and check the docs while you keep the dev server running." },
  {
    kind: "tool",
    name: "subagent",
    input: { agent: "review", description: "Review the theme store", prompt: "Review it.", background: true },
    output: "The subagent is working in the background.",
    metadata: { sessionID: "session_child_store", status: "running" },
  },
  {
    kind: "tool",
    name: "subagent",
    input: { agent: "explore", description: "Check the theme docs", prompt: "Check them.", background: true },
    output: "The subagent is working in the background.",
    metadata: { sessionID: "session_child_docs", status: "running" },
  },
  {
    kind: "tool",
    name: "shell",
    input: { command: "bun run dev", description: "Start the dev server", background: true },
    output: "Command moved to the background (shell ID: shell_dev).",
    metadata: { shellID: "shell_dev", status: "running" },
  },
  { kind: "tool", name: "read", input: { path: "/workspace/src/theme/scheme.ts" }, output: schemeBefore },
  { kind: "step" },
  {
    kind: "say",
    text: "Two reviews are running in the background, and the dev server is up. I'll pick up their findings when they report back.",
  },
  { kind: "idle" },
  {
    kind: "report",
    source: "subagent",
    state: "completed",
    description: "Review the theme store",
    agent: "review",
    childID: "session_child_store",
  },
  {
    kind: "report",
    source: "subagent",
    state: "error",
    description: "Check the theme docs",
    agent: "explore",
    childID: "session_child_docs",
  },
  {
    kind: "say",
    text: "The store review found nothing to change. The docs check failed, so I'll run both checks again and wait for them.",
  },
  {
    kind: "tool",
    name: "subagent",
    input: { agent: "explore", description: "Check the theme docs", prompt: "Check them." },
    output: "The docs describe the scheme setting correctly.",
    metadata: { sessionID: "session_child_docs_again", status: "completed" },
  },
  {
    kind: "tool",
    name: "subagent",
    input: { agent: "review", description: "Review the toggle", prompt: "Review it." },
    output: "The toggle reads the scheme in an effect, which is right.",
    metadata: { sessionID: "session_child_toggle", status: "completed" },
  },
  { kind: "step" },
  { kind: "say", text: "Both checks pass: the docs are accurate and the toggle reads the scheme correctly." },
  { kind: "idle" },
  { kind: "report", source: "shell", state: "cancelled", description: "bun run dev", shellID: "shell_dev" },
]

const thinkingOnly: Beat[] = [
  { kind: "user", text: "Why does the timeline jump when a turn finishes?" },
  { kind: "think", text: "" },
  {
    kind: "think",
    text: "## Tracing row identity\n\nRows are keyed by group type, so a group that changes type remounts and loses its measured height.",
  },
  { kind: "step" },
  {
    kind: "say",
    text: "Rows are keyed by their group type. When a tool fails, its group changes type and the row remounts, which loses its measured height.",
  },
  { kind: "idle" },
]

// The model thinks after reading, in the same stretch, so the old timeline labels the group by the reads it made.
const thinkingAfterTools: Beat[] = [
  { kind: "user", text: "Is the scheme store safe to read during render?" },
  { kind: "tool", name: "read", input: { path: "/workspace/src/theme/scheme.ts" } },
  {
    kind: "tool",
    name: "grep",
    input: { pattern: "useScheme", path: "/workspace/src", include: "*.tsx" },
    metadata: { matches: 7 },
  },
  {
    kind: "think",
    text: "## Checking reads during render\n\nThe store reads a signal, so a read in render subscribes the component. None of the seven callers write during render.",
  },
  { kind: "step" },
  {
    kind: "say",
    text: "Yes. The store only reads a signal during render, and none of its seven callers write to it there.",
  },
  { kind: "idle" },
]

// Some providers send thinking with no readable text, so the thought never has words to show.
const encryptedThinking: Beat[] = [
  { kind: "user", text: "Plan the dark mode change before touching any code." },
  { kind: "think", text: "" },
  { kind: "think", text: "" },
  { kind: "step" },
  { kind: "say", text: "Plan: add a scheme setter to the theme store, a toggle row in General settings, then a test." },
  { kind: "idle" },
]

export const scenarios = {
  "Feature work": featureWork,
  "Every tool": everyTool,
  "Background work": backgroundWork,
  "Thinking only": thinkingOnly,
  "Thinking after tools": thinkingAfterTools,
  "Encrypted thinking": encryptedThinking,
} as const

export type ScenarioName = keyof typeof scenarios

export function replayScript(script: Beat[], limit: number, start: number) {
  const messages: SessionMessageInfo[] = []
  // SAFETY: no step is open yet; the assertion names the step this holds once one starts.
  const state = { used: 0, busy: false, caption: "Start", assistant: undefined as SessionMessageAssistant | undefined }
  const at = () => start + state.used * 1_500
  const id = (prefix: string) => `${prefix}_${messages.length}_${state.used}`

  const closeStep = () => {
    if (state.assistant) state.assistant.time.completed = at()
    state.assistant = undefined
  }

  const assistant = () => {
    if (state.assistant) return state.assistant

    const message: SessionMessageAssistant = {
      id: id("msg_assistant"),
      type: "assistant",
      agent: "build",
      model: STORY_MODEL,
      content: [],
      time: { created: at() },
    }

    messages.push(message)
    state.assistant = message

    return message
  }

  for (const beat of script) {
    const available = limit - state.used

    if (available <= 0) break
    const progress = Math.min(available, ticks(beat))
    const done = progress === ticks(beat) && !(beat.kind === "tool" && beat.hold)
    state.caption = caption(beat, done)

    if (beat.kind === "user") {
      closeStep()
      messages.push({
        id: id("msg_user"),
        type: "user",
        text: beat.text,
        time: { created: at() },
        metadata: { agent: "build", model: STORY_MODEL },
      })
      state.busy = true
    }

    if (beat.kind === "shell") {
      closeStep()
      messages.push({
        id: id("msg_shell"),
        type: "shell",
        shellID: id("shell"),
        command: beat.command,
        status: done ? "exited" : "running",
        exit: done ? beat.exit : undefined,
        output: done
          ? { output: beat.output, cursor: beat.output.length, size: beat.output.length, truncated: false }
          : undefined,
        time: { created: at(), completed: done ? at() + 800 : undefined },
      })
    }

    if (beat.kind === "goal") {
      closeStep()
      messages.push({
        id: id("msg_goal"),
        type: "synthetic",
        text: `Keep working until this objective is met: ${beat.objective}`,
        description: `Goal: ${beat.objective}`,
        metadata: { source: "goal" },
        time: { created: at() },
      })
      state.busy = true
    }

    if (beat.kind === "report") {
      closeStep()
      messages.push({
        id: id("msg_report"),
        type: "synthetic",
        text: `${beat.source} ${beat.state}: ${beat.description}`,
        description: beat.description,
        metadata: {
          source: beat.source,
          state: beat.state,
          // Only the fields the report carries, as core writes them.
          ...Object.fromEntries(
            [
              ["agent", beat.agent],
              ["childID", beat.childID],
              ["shellID", beat.shellID],
            ].flatMap(([key, value]) => (value ? [[key, value]] : [])),
          ),
        },
        time: { created: at() },
      })
    }

    if (beat.kind === "model") {
      closeStep()
      messages.push({
        id: id("msg_model"),
        type: "model-switched",
        model: { id: beat.id, providerID: "company-gateway" },
        previous: STORY_MODEL,
        time: { created: at() },
      })
    }

    if (beat.kind === "step") closeStep()

    if (beat.kind === "think")
      assistant().content.push({
        type: "reasoning",
        // An empty thought shows that the model is thinking before its first words arrive.
        text: thoughtSoFar(beat.text, progress),
        time: { created: at(), completed: done ? at() + 1_000 : undefined },
      })

    if (beat.kind === "say")
      assistant().content.push({ type: "text", text: done ? beat.text : beat.text.slice(0, beat.text.length / 2) })

    if (beat.kind === "tool") assistant().content.push(tool(id("tool"), beat, done, at()))

    if (beat.kind === "interrupt" && state.assistant) {
      state.assistant.content = state.assistant.content.map((content) =>
        content.type === "tool" && content.state.status === "running"
          ? tool(
              content.id,
              { kind: "tool", name: content.name, input: content.state.input, error: "Tool execution interrupted" },
              true,
              at(),
            )
          : content,
      )
      state.assistant.error = { type: "aborted", message: "The user interrupted the turn" }
      closeStep()
      messages.push({ id: id("msg_idle"), type: "idle", outcome: "interrupted", time: { created: at() } })
      state.busy = false
    }

    if (beat.kind === "idle") {
      closeStep()
      messages.push({ id: id("msg_idle"), type: "idle", outcome: "succeeded", time: { created: at() } })
      state.busy = false
    }

    state.used += progress
  }

  return {
    document: {
      sessionID: CURRENT_SESSION_ID,
      // New arrays and objects on every step, as a streamed update would deliver them.
      messages: structuredClone(messages),
      status: { type: state.busy ? "busy" : "idle" },
      diffs: [],
    } satisfies SessionDocument,
    caption: state.caption,
  }
}

function tool(
  id: string,
  beat: Extract<Beat, { kind: "tool" }>,
  done: boolean,
  time: number,
): SessionMessageAssistantTool {
  if (!done)
    return {
      type: "tool",
      id,
      name: beat.name,
      state: { status: "running", input: beat.input, metadata: running(beat.metadata ?? {}) },
      time: { created: time, ran: time + 100 },
    }

  if (beat.error)
    return {
      type: "tool",
      id,
      name: beat.name,
      state: {
        status: "error",
        input: beat.input,
        error: {
          type: beat.error === "Tool execution interrupted" ? "aborted" : "ToolExecutionError",
          message: beat.error,
        },
        metadata: beat.metadata,
      },
      time: { created: time, ran: time + 100, completed: time + 700 },
    }

  return {
    type: "tool",
    id,
    name: beat.name,
    state: {
      status: "completed",
      input: beat.input,
      content: [{ type: "text", text: beat.output ?? "Done" }],
      metadata: beat.metadata,
    },
    time: { created: time, ran: time + 100, completed: time + 900 },
  }
}

// How much of a thought shows at each step: nothing yet, then half, then all of it.
function thoughtSoFar(text: string, progress: number) {
  if (progress === 1) return ""

  if (progress === 2) return text.slice(0, Math.ceil(text.length / 2))

  return text
}

// A running Code Mode script is still inside its last call.
function running(metadata: Record<string, JsonValue>) {
  const calls = metadata.toolCalls

  if (!Array.isArray(calls) || calls.length === 0) return metadata

  // SAFETY: Code Mode records each call as an object; the spread only copies its fields.
  return { ...metadata, toolCalls: [...calls.slice(0, -1), { ...(calls.at(-1) as object), status: "running" }] }
}

function caption(beat: Beat, done: boolean) {
  if (beat.kind === "user") return "You sent a message"

  if (beat.kind === "shell") return done ? `You ran ${beat.command}` : `Running ${beat.command}`

  if (beat.kind === "goal") return "You set a goal"

  if (beat.kind === "report") return `${beat.source} ${beat.state}`

  if (beat.kind === "model") return "You switched models"

  if (beat.kind === "think") return done ? "Finished thinking" : "Thinking"

  if (beat.kind === "say") return done ? "Answered" : "Writing"

  if (beat.kind === "tool") return done ? `${beat.name} finished` : `${beat.name} running`

  if (beat.kind === "interrupt") return "You interrupted the turn"

  if (beat.kind === "idle") return "Turn finished"

  return "Next step"
}

/** The playhead's steps through an exported session: one per message, and one per part of an assistant message. */
export function sessionSteps(messages: readonly SessionMessageInfo[]) {
  return messages.reduce(
    (sum, message) => sum + (message.type === "assistant" ? Math.max(1, message.content.length) : 1),
    0,
  )
}

/**
 * An exported session up to a step of the playhead. The step's message is live: its assistant message is not finished,
 * the part the step lands on is a thought still streaming or a call still running, and the session is busy.
 */
export function replaySession(sessionID: string, messages: readonly SessionMessageInfo[], limit: number) {
  const out: SessionMessageInfo[] = []
  const state = { used: 0, caption: "Start", live: false }

  for (const message of messages) {
    const available = limit - state.used

    if (available <= 0) break

    if (message.type !== "assistant") {
      out.push(message)
      state.used += 1
      state.caption = message.type
      state.live = message.type === "user" || message.type === "shell"
      continue
    }

    const length = Math.max(1, message.content.length)
    const shown = Math.min(available, length)
    const finished = shown === length && available > length

    const content = message.content
      .slice(0, shown)
      .map((part, index) => (finished || index < shown - 1 ? part : livePart(part)))

    out.push(finished ? message : { ...message, content, error: undefined, time: { created: message.time.created } })
    state.used += shown
    state.live = !finished
    state.caption = finished ? "Step finished" : liveCaption(content.at(-1))
  }

  const last = out.at(-1)

  return {
    document: {
      sessionID,
      messages: structuredClone(out),
      status: { type: state.live || (last?.type !== "idle" && state.used < sessionSteps(messages)) ? "busy" : "idle" },
      diffs: [],
    } satisfies SessionDocument,
    caption: state.caption,
  }
}

function livePart(part: SessionMessageAssistant["content"][number]): SessionMessageAssistant["content"][number] {
  if (part.type === "reasoning") return { ...part, time: part.time ? { created: part.time.created } : undefined }

  if (part.type !== "tool" || part.state.status === "streaming") return part

  return {
    ...part,
    state: {
      status: "running",
      input: part.state.input,
      metadata: "metadata" in part.state ? (part.state.metadata ?? {}) : {},
    },
    time: { created: part.time.created, ran: part.time.ran },
  }
}

function liveCaption(part: SessionMessageAssistant["content"][number] | undefined) {
  if (part?.type === "reasoning") return "Thinking"

  if (part?.type === "tool") return `${part.name} running`

  return "Writing"
}
