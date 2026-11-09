import "./design-mode.css"
import { createEffect, createSignal, lazy, onCleanup, onMount, Show, Suspense } from "solid-js"
import { createStore, reconcile, unwrap } from "solid-js/store"
import { z } from "zod"
import { historyGroup, historyKey, historyNotice, historyPointer, recordHistory, type HistoryTarget } from "./history"
import { config } from "~/config"
import { useLanguage } from "~/context/language"
import { announcementCopy, announcements } from "./announcement"
import { designMode, editing, setCopyChooser, setDesignModeState } from "./design-copy"
import { logoLabels, setSiteSetting } from "./settings"

/**
 * Design mode: hover (or tap) a part of the page that has options and cycle through them in
 * place. Elements opt in with `data-design="<setting> <setting>"` (keys of `settingControls`) or
 * `data-design-copy="<id>"` (keys of `copyVariants`). Clicking opted-in copy edits it in place, and
 * new text is kept as another option. The overlay itself is in design-overlay.tsx.
 *
 * A development tool: Site loads this module only on the development server, so production has
 * none of it. Pages read the chosen copy through design-copy.ts.
 */

const modeKey = "opencode-site-design-mode"
const copyKey = "opencode-site-design-copy-v2"
export const selector = "[data-design], [data-design-copy]"

export { designMode, editing, fallbacks, setEditing } from "./design-copy"

export function setDesignMode(on: boolean) {
  setDesignModeState(on)
  localStorage.setItem(modeKey, on ? "1" : "0")
}

// Alternatives to the page's own (translated) copy, reworded from earlier and live site copy.
// Variants are English only. Two-line copy keeps its lines apart with "\n"; when edited, each
// child element of the copy is one line.
export const copyVariants = {
  "home.hero.title": {
    label: "Hero title",
    lines: 1,
    options: [
      "The open source coding agent",
      "The coding agent built for the terminal",
      // From the coding-agents review (positioningRec); "for any model" is its recommendation.
      "The open source coding agent for any model",
      "Any model. Every device. Your machine.",
      "One open source agent, on every device",
      "Use the coding plan you already pay for",
      "The coding agent that runs on your machine",
    ],
  },
  "home.hero.subtitle": {
    label: "Hero subtitle",
    lines: 2,
    options: [
      "Connect any model from any provider,\nincluding Claude, GPT, Gemini and more.",
      "An open source agent that helps you write code\non your desktop, in your terminal or in your IDE.",
      // Subscriptions OpenCode signs in with (core plugin/provider: chatgpt.ts, github-copilot.ts).
      // Claude Pro/Max is not one of them; Anthropic prohibits it (docs: providers#anthropic).
      "Sign in with your ChatGPT or GitHub Copilot plan,\nor use free models, any API key or a local model.",
      "Use the ChatGPT or GitHub Copilot plan you already pay for,\nor connect any model from any provider.",
      "Free models included. Sign in with ChatGPT or GitHub Copilot,\nor bring any API key or local model.",
      "Already pay for ChatGPT or GitHub Copilot? Sign in and use it,\nor connect any other provider.",
      "Works with your ChatGPT Plus/Pro or GitHub Copilot subscription,\nany API key and local models.",
      // The default before "Start with free models…" (now the page's own copy, option 0).
      "Free models included or connect any model from any provider,\nincluding Claude, GPT, Gemini and more.",
      // From the coding-agents review (positioningRec), adjusted to the site copy rules: no "no
      // account", no plan names, "OpenCode" rather than "It", products in the site's order.
      "Start with free models or bring any of 200+ providers.\nOpenCode runs on your machine, and you can control it from the desktop, your phone, the terminal or your own code.",
      "OpenCode is an open source coding agent. Use the free models or any of 200+ providers,\nand steer your sessions from the desktop, your phone or the terminal.",
      "Start a session in the desktop app, approve it from your phone and pick it up in the terminal.\nUse any model, including the free models.",
      "Use the plan you already pay for, any of 200+ providers or the free models.\nOpenCode is open source and runs on your machine.",
      "Open source, any model, and sessions that stay on your computer.\nControl OpenCode from the desktop, your phone, the terminal or the SDK.",
    ],
  },
  // The button above the product carousel that copies an install prompt. Short labels; its
  // accessible name always says what it copies.
  "home.install.agent": {
    label: "Agent install button",
    lines: 1,
    options: [
      "Install via agent",
      "For your agent",
      "Agent prompt",
      "Ask your agent",
      "Agent setup",
      "Prompt for agent",
      "Copy for agent",
    ],
  },
  // The "fork it" block's heading (Settings › Open source variant "fork").
  "home.fork.title": {
    label: "Fork heading",
    lines: 1,
    options: ["Every line is yours to change.", "Fork it, change it, ship it."],
  },
  "home.what.lead": {
    label: "What is OpenCode? intro",
    lines: 3,
    options: [
      "OpenCode is an open source coding agent that works with any model. Run it as a desktop app, from your phone, in the terminal or inside your own tools with the SDK.",
      "OpenCode is an open source coding agent. Use it in the desktop app, on your phone, in your terminal, or from your own code with the SDK.",
      "OpenCode writes, edits and explains code with the model of your choice. It's open source, and runs on your desktop, your phone, your terminal and your own code.",
      "One open source coding agent for every place you work: a desktop app, a phone app, a terminal interface and an SDK.",
      // From the coding-agents review (positioningRec), adjusted to the site copy rules.
      "OpenCode is an open source coding agent. It runs on your computer, and the desktop app, phone, terminal and SDK all connect to the same sessions.",
    ],
  },
  "home.logos.label": {
    label: "Logo row label",
    lines: 1,
    options: [
      "Trusted by 22M+ developers",
      "Trusted worldwide",
      "Trusted by",
      "Used and trusted by developers",
      "Trusted by developers worldwide",
      // From the coding-agents review (positioningRec), adjusted to the site copy rules.
      "Used by developers at",
    ],
  },
  // Home sections and FAQ answers without copy of their own in Design mode until the coding-agents
  // review (positioningRec). One line each: editing reads the whole text, links included. Links in
  // an option come from homeContent's copyLinks phrases.
  "home.feature.anyModel.body": {
    label: "Any model feature",
    lines: 1,
    options: ["200+ providers through models.dev, plus local models with Ollama, LM Studio or vLLM"],
  },
  "home.feature.anyDevice.title": { label: "Any device feature title", lines: 1, options: ["Every surface"] },
  "home.feature.anyDevice.body": {
    label: "Any device feature",
    lines: 1,
    options: ["Desktop, phone, terminal and web, all connected to one OpenCode server"],
  },
  "home.tools.lead": {
    label: "Bring your own tools intro",
    lines: 1,
    options: [
      "Connect the services you already use with MCP servers, hook into OpenCode with plugins, teach agents your workflows with skills, and use it from Zed and other editors through ACP.",
    ],
  },
  "home.openSource.lead": {
    label: "Open source intro",
    lines: 1,
    options: [
      `OpenCode is MIT licensed. ${config.stats.contributors} contributors have made ${config.stats.commits}+ commits, and ${config.stats.monthlyUsers} developers use it every month.`,
    ],
  },
  "home.privacy.title": { label: "Privacy title", lines: 1, options: ["Your code stays yours"] },
  "home.privacy.body": {
    label: "Privacy",
    lines: 1,
    options: [
      "OpenCode runs on your computer and keeps your sessions there. Your code goes only to the model provider you choose. If you choose a model hosted by OpenCode, its training and retention terms are listed in the docs.",
    ],
  },
  "home.faq.a3": {
    label: "FAQ: extra subscriptions",
    lines: 1,
    options: [
      "No. OpenCode includes free models that need no account. You can also connect any of 200+ providers, sign in with ChatGPT or Copilot, or run local models.",
    ],
  },
  "home.faq.a4": {
    label: "FAQ: existing subscriptions",
    lines: 1,
    options: ["Yes. Sign in with ChatGPT (Plus or Pro) or GitHub Copilot, including GitHub Enterprise."],
  },
  "home.faq.a6": {
    label: "FAQ: cost",
    lines: 1,
    options: [
      "OpenCode is free and MIT licensed. The free models cost nothing. With another provider, you pay that provider. OpenCode Go is from $10/month, and OpenCode Models are pay as you go.",
    ],
  },
  "home.faq.a7": {
    label: "FAQ: data and privacy",
    lines: 1,
    options: [
      "OpenCode runs on your computer and keeps your sessions there. Your code goes only to the model provider you choose. If you choose a model hosted by OpenCode, its training and retention terms are listed in the docs.",
    ],
  },
  // The home email sign-up (signup.tsx); its own copy is the first option.
  "home.signup.title": {
    label: "Sign-up title",
    lines: 1,
    options: ["Stay in the loop", "Release notes", "Get the updates"],
  },
  "home.signup.body": {
    label: "Sign-up intro",
    lines: 1,
    options: [
      "Release notes and new products by email, when they ship. No spam, and you can unsubscribe at any time.",
      "One email when something ships: new releases and new products. Nothing else.",
      "Be the first to hear about new releases and products. Every email has an unsubscribe link.",
    ],
  },
  // Sign-up style "sentence": the button that shows once the address is valid.
  "home.signup.button": { label: "Sign-up button", lines: 1, options: ["Get early access", "Let me know", "Join"] },
  // The home page's "New" bar (announcement.ts): each option keeps its own link.
  "home.announcement": { label: "Announcement", lines: 1, options: announcements.map(announcementCopy) },
  // "Get started" (lib/get-started.ts); the first option is the page's own copy.
  "home.getStarted.lead": {
    label: "Get started lead",
    lines: 2,
    options: [
      "The easiest way to start is to download OpenCode and use the free models. No account needed. For more, bring your own subscription or use OpenCode Go.",
      "Download OpenCode and start with free models, no account needed. Later, log in with a subscription you already have, or get OpenCode Go from $10/month.",
      "Start free. Download OpenCode and pick a free model. When you need more, bring your own subscription or use OpenCode Go.",
    ],
  },
  // "Bring your own subs" (lib/byos.ts), worded like the live opencode.ai; the first option is the
  // page's own copy.
  "home.byos.headline": {
    label: "Own subs headline",
    lines: 1,
    options: ["Use the subscriptions you already have.", "Already pay for a model? Log in.", "Your plan, or ours."],
  },
  "home.byos.line": {
    label: "Own subs line",
    lines: 1,
    options: [
      "Log in with ChatGPT Plus or Pro, GitHub Copilot or Claude Code. Or use an OpenCode subscription.",
      "Log in with OpenAI to use your ChatGPT Plus or Pro account, or with GitHub to use your Copilot account.",
      "Log in with ChatGPT or GitHub Copilot, add any API key, or subscribe to OpenCode Go.",
    ],
  },
  "footer.status.ok": {
    label: "Status label",
    lines: 1,
    // "Normal" is also the page's own label now; it keeps its place so saved choices still match.
    options: ["All systems normal", "All good", "Online", "Normal", "Up", "Operational"],
  },
  // Product page intros; the page's own text (product-data.ts) is the first option.
  "product.desktop.intro": {
    label: "Desktop intro",
    lines: 1,
    options: [
      "Every session in its own tab, on macOS, Windows and Linux. Keep several agents working at once, read each change as a diff, and see the result in the browser beside it.",
      "The OpenCode app for your desktop. Run sessions side by side, comment on any line of a diff to send it back to the agent, and preview the work as it lands.",
      "Keep every project and session in one window. Tabs for parallel agents, a diff for every edit, and a built-in browser to check what the agent built.",
      "A desktop home for your agents. Start a session per task, review and comment on each change, and use the free models included or connect any provider.",
    ],
  },
  "product.mobile.intro": {
    label: "Mobile intro",
    lines: 1,
    options: [
      "Your sessions in your pocket. Call a session to talk to the agent, follow its timeline as it works, and approve each request from your phone.",
      "Keep work moving when you're away from your desk. Start a session by voice, review the diff the agent proposes, and allow it once or always.",
      "Steer the agent from anywhere. Open any session on your computer, send a follow-up to change direction, and answer permission requests as they come in.",
      "Start, steer and approve sessions from your phone. It connects to OpenCode on your own machine, so your code and projects stay where they are.",
    ],
  },
  "product.terminal.intro": {
    label: "Terminal intro",
    lines: 1,
    options: [
      "OpenCode in your terminal. Ask in plain words, watch the plan and each diff appear in the timeline, and approve commands before they run.",
      "Works in any shell, editor or remote server. Switch agents with shift+tab, open every command with ctrl+p, and pick a theme that suits your setup.",
      "The full-screen terminal interface for OpenCode. Describe the task, follow every read, edit and test run, and keep control of what runs on its own.",
      "A fast TUI for working with agents over SSH or locally. Edits arrive as diffs, permissions ask first, and themes and keybinds are yours to change.",
    ],
  },
  "product.sdk.intro": {
    label: "SDK intro",
    lines: 1,
    options: [
      "OpenCode as a library. Create sessions, send prompts and subscribe to events from TypeScript, then run the same agent in scripts, bots and pipelines.",
      "Automate OpenCode from code. A short script can ask the agent to fix failing tests in CI and stream each tool call as it happens.",
      "A typed client for the OpenCode server. Start sessions from any script, follow every event live, and build your own tools on the same agent as the apps.",
      "Bring the agent into your workflows. Call OpenCode from CI jobs, dashboards and chat bots, with the same models and settings as your local setup.",
    ],
  },
  // Home carousel card descriptions; the card's own text (product-data.ts) is the first option.
  "card.desktop.body": {
    label: "Desktop card",
    lines: 1,
    options: [
      "Run several agents at once, each session in its own tab.",
      "Review every change as a diff, with a browser built in.",
      "All your projects and sessions in one desktop app.",
      "Every session in its own tab, on macOS, Windows and Linux.",
      // From the coding-agents review (positioningRec), adjusted to the site copy rules.
      "Run sessions side by side in tabs and review every diff. macOS, Windows and Linux.",
    ],
  },
  "card.mobile.body": {
    label: "Mobile card",
    lines: 1,
    options: [
      "Start, steer and approve sessions from your phone, by text or a live voice call.",
      "Call your agent and talk it through. It talks back, live.",
      "Talk to the agent in a live call, then approve its changes from your phone.",
      "Steer sessions out loud, in a real conversation, wherever you are.",
      "Call a session, talk to the agent and approve its changes.",
      "Keep work moving from your phone while you're away.",
      "Follow every session and answer requests on the go.",
      "Voice, approvals and follow-ups, connected to your computer.",
      // From the coding-agents review (positioningRec), adjusted to the site copy rules.
      "Steer and approve the sessions on your computer from your phone.",
    ],
  },
  "card.terminal.body": {
    label: "Terminal card",
    lines: 1,
    options: [
      "Ask in plain words and watch each edit land as a diff.",
      "The full-screen terminal interface, over SSH or locally.",
      "Switch agents with shift+tab and run any command with ctrl+p.",
      "Approve what runs, and make it yours with themes.",
      // From the coding-agents review (positioningRec), adjusted to the site copy rules.
      "The full agent in any terminal, editor or SSH session.",
    ],
  },
  "card.sdk.body": {
    label: "SDK card",
    lines: 1,
    options: [
      "Create sessions and stream every event from TypeScript.",
      "Fix failing tests in CI with a few lines of code.",
      "Build bots, dashboards and tools on the same agent.",
      "A typed client for the OpenCode server and its models.",
      // From the coding-agents review (positioningRec), adjusted to the site copy rules.
      "Run the same agent from your own scripts, CI jobs and tools.",
    ],
  },
  // The Brand and Press button that copies the brand rules as Markdown; its own label is "Rules for agent".
  // The /font film plate's lead. The page's own copy doesn't name a length, so it outlives recuts.
  // The /font universe story, one sentence a line. Each version names 10⁸⁰ and 10²⁸⁰⁰ (the
  // level counter keys on them); 34 levels = 10²⁷²⁰ is short and 35 = 10²⁸⁰⁰ passes 6³⁵⁹¹ ≈ 10²⁷⁹⁴·³.
  "font.universe.story": {
    label: "Universe story",
    lines: 2,
    options: [
      "Each visit draws one font out of 6³⁵⁹¹.\nThat number is 2,795 digits long.\nThe universe has about 10⁸⁰ atoms.\nMake every atom a universe. Then do it again.\n34 times gets you 10²⁷²⁰. Not enough.\n35 times gets you 10²⁸⁰⁰. Past it.\nOne of them is yours.",
      "3,591 characters, six letters, a new mapping every visit.\nThat's 6³⁵⁹¹ fonts, a number 2,795 digits long.\nThe universe holds about 10⁸⁰ atoms.\nNot close. Give every atom its own universe.\nThen every atom in those. 34 levels down, 10²⁷²⁰ is still short.\nAt level 35, 10²⁸⁰⁰, we finally pass it.\nYours is one of them.",
    ],
  },
  "font.film.lead": {
    label: "Film lead",
    lines: 1,
    options: [
      "Ninety seconds on the greatest six letters ever drawn.",
      "The greatest six letters ever drawn, on film.",
    ],
  },
  "brand.agentButton": {
    label: "Agent rules button",
    lines: 1,
    options: [
      "Agent rules",
      "Rules for agents",
      "For your agent",
      "Copy for agent",
      "Agent prompt",
      "Brand rules",
      "Copy rules for your agent",
    ],
  },
  "card.extensions.body": {
    label: "Extensions card",
    lines: 1,
    options: [
      "Bring OpenCode into VS Code and other editors.",
      "The same agent inside your editor, through ACP.",
      "Work with OpenCode without leaving VS Code or Zed.",
      "Install the extension and start a session in your editor.",
    ],
  },
  // The /product hero subtitle. The apps talk to the same OpenCode server (the background service
  // the terminal and desktop app share) and `opencode pair` connects the phone; the SDK runs its own
  // OpenCode inside your process, with your config and models.
  "products.hero.body": {
    label: "Product subtitle",
    lines: 1,
    options: [
      "One agent, every surface. Start a session on your desktop, steer it from your phone, pick it up in the terminal or drive it from your own code.",
      "OpenCode runs on desktop, mobile and the terminal, and from your own code. Every app shares the same sessions, so you start on one and carry on in another.",
      "Desktop, mobile and terminal on one OpenCode server, and the SDK inside your own code. A session started in one app is already there in the others.",
      "Use OpenCode wherever you work. The apps share one server and the same sessions: start at your desk, approve from your phone, finish in the terminal.",
      "The same agent on desktop, mobile, the terminal and the SDK, with the same sessions across the apps. Switch surfaces without losing your place.",
    ],
  },
  // The products after the carousel's four, on /product and their own pages.
  "card.ide.body": {
    label: "IDE extensions card",
    lines: 1,
    options: [
      "OpenCode in VS Code and its forks, and in any ACP editor.",
      "Run opencode in your editor's terminal and the extension installs itself.",
    ],
  },
  "card.mini.body": {
    label: "Mini card",
    lines: 1,
    options: [
      "Run opencode mini: replies land in your terminal's own scrollback.",
      "The agent in your terminal, with only a prompt and a status line.",
    ],
  },
  "product.ide.intro": {
    label: "IDE extensions intro",
    lines: 1,
    options: [
      "OpenCode beside your code. Open it in a split terminal with Cmd+Esc, share your selection, and insert file references, in VS Code and its forks or any editor that speaks ACP.",
    ],
  },
  "product.mini.intro": {
    label: "Mini intro",
    lines: 1,
    options: [
      "OpenCode with nothing in the way. Replies print into your terminal's scrollback like any command's output, and a single prompt with a status line waits at the bottom.",
    ],
  },
} satisfies Record<string, { label: string; lines: number; options: readonly string[] }>

export type CopyId = keyof typeof copyVariants

// Saved as { choice: { [id]: index }, custom: { [id]: [text, ...] } }. Index 0 is the page's own
// copy, then the built-in options, then the ones added by editing.
const copySchema = z.object({
  choice: z.record(z.string(), z.number().int().min(0)).catch({}),
  custom: z.record(z.string(), z.array(z.string())).catch({}),
})
export const [copy, setCopy] = createStore<z.infer<typeof copySchema>>({ choice: {}, custom: {} })

// The copy as of the last save, load or undo, so a save can record what it changed.
let recordedCopy: z.infer<typeof copySchema> = { choice: {}, custom: {} }

/** Saves the copy choices and edits, and records what changed for undo. */
export function saveCopy() {
  const ids = [
    ...new Set([copy, recordedCopy].flatMap((item) => [...Object.keys(item.choice), ...Object.keys(item.custom)])),
  ]
  const changes = (["choice", "custom"] as const)
    .flatMap((part) =>
      ids.map((id) => ({
        key: `${part} ${id}`,
        label: `${isCopyId(id) ? copyVariants[id].label : id}${part === "custom" ? " options" : ""}`,
        before: structuredClone(recordedCopy[part][id]),
        after: structuredClone(unwrap(copy[part][id])),
      })),
    )
    .filter((change) => JSON.stringify(change.before) !== JSON.stringify(change.after))
  recordHistory(copyHistory, changes, { group: changes.map((change) => change.key).join(",") })
  writeCopy()
}

function writeCopy() {
  recordedCopy = structuredClone(unwrap(copy))
  localStorage.setItem(copyKey, JSON.stringify(copy))
}

const copyHistory: HistoryTarget = {
  apply: (values) => {
    values.forEach((item) => {
      const [part, id] = item.key.split(" ")
      if (part !== "choice" && part !== "custom") return
      setCopy(part, id, (item.value === undefined ? undefined : reconcile(structuredClone(item.value))) as never)
    })
    writeCopy()
  },
  describe: (change, value) => {
    const [part, id] = change.key.split(" ")
    if (part !== "choice" || !isCopyId(id)) return ""
    const index = typeof value === "number" ? value : 0
    const builtIn = copyVariants[id].options.length
    if (index === 0) return "original"
    return index > builtIn ? `custom ${index - builtIn}` : `alt ${index}`
  },
}
export const copyOptions = (id: CopyId) => [...copyVariants[id].options, ...(copy.custom[id] ?? [])]

/** The chosen and edited copy variants, for Settings › Export. */
export const exportDesignCopy = () => structuredClone(unwrap(copy))

/** Applies and saves copy variants from an export. */
export function importDesignCopy(raw: unknown) {
  const parsed = copySchema.safeParse(raw)
  if (!parsed.success) return false
  setCopy(reconcile(parsed.data))
  saveCopy()
  return true
}

/** Sets Settings › Logo label and drops any Design mode copy choice over it, so it shows at once. */
export function selectLogoLabel(index: number) {
  historyGroup(() => {
    setSiteSetting("logoLabel", logoLabels[index])
    setCopy("choice", "home.logos.label", 0)
    saveCopy()
  })
}

// The page's locale, which DesignMode keeps in step: copy options and custom edits are English, so
// they apply on English pages only and every other locale shows its translation.
const [copyLocale, setCopyLocale] = createSignal("en")

/** The chosen copy variant for `id`, or `fallback` (the page's own copy) by default. */
function chooseCopy(id: CopyId, fallback: string) {
  if (copyLocale() !== "en") return fallback
  const index = copy.choice[id] ?? 0
  if (index === 0) return fallback
  return copyOptions(id)[index - 1] ?? fallback
}

export function isCopyId(id: string): id is CopyId {
  return id in copyVariants
}

const DesignOverlay = lazy(() => import("./design-overlay"))

/**
 * Design mode's shortcuts (Shift+D, and Shift+S for Settings where `onSettings` is given) and its
 * undo toast; there are no buttons. The overlay with the option controls loads only once Design
 * mode is on, so normal visits don't download it.
 */
export default function DesignMode(props: { onSettings?: () => void }) {
  const language = useLanguage()
  createEffect(() => setCopyLocale(language.locale()))
  onMount(() => {
    // Read after hydration, so the server markup and the first client render agree.
    // The page inside the device preview shows the site as visitors see it.
    if (localStorage.getItem(modeKey) === "1" && !window.frameElement?.hasAttribute("data-device-preview-frame"))
      setDesignModeState(true)
    // The old "tucked" choice for the corner buttons, which are gone.
    localStorage.removeItem("opencode-site-dev-tools")
    const saved = copySchema.safeParse(readJson(localStorage.getItem(copyKey)))
    if (saved.success) setCopy(reconcile(saved.data))
    recordedCopy = structuredClone(unwrap(copy))
    setCopyChooser(() => chooseCopy)

    const key = (event: KeyboardEvent) => {
      if (editing()) return
      if (event.key === "Escape" && designMode()) return setDesignMode(false)
      if (!["D", "S"].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
      if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return
      if (event.key === "D") return setDesignMode(!designMode())
      props.onSettings?.()
    }
    document.addEventListener("keydown", key)
    document.addEventListener("keydown", historyKey)
    document.addEventListener("pointerdown", historyPointer, true)
    document.addEventListener("pointerup", historyPointer, true)
    document.addEventListener("pointercancel", historyPointer, true)
    onCleanup(() => {
      document.removeEventListener("keydown", key)
      document.removeEventListener("keydown", historyKey)
      document.removeEventListener("pointerdown", historyPointer, true)
      document.removeEventListener("pointerup", historyPointer, true)
      document.removeEventListener("pointercancel", historyPointer, true)
    })
  })

  // The undo toast: shown for 1.5s after each undo or redo.
  const [notice, setNotice] = createSignal<string>()
  createEffect(() => {
    const current = historyNotice()
    if (!current) return
    setNotice(current.text)
    const timer = setTimeout(() => setNotice(undefined), 1500)
    onCleanup(() => clearTimeout(timer))
  })

  return (
    <>
      <div data-component="history-toast" role="status" aria-live="polite">
        <Show when={notice()}>{(text) => <span>{text()}</span>}</Show>
      </div>

      {/* Its own boundary, so loading the overlay never suspends the page. */}
      <Suspense>
        <Show when={designMode()}>
          <DesignOverlay />
        </Show>
      </Suspense>
    </>
  )
}

// localStorage can hold anything, including invalid JSON from an older build.
function readJson(raw: string | null): unknown {
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}
