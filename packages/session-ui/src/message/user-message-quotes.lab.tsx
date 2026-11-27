import { For, Show, type JSX } from "solid-js"
import type { PromptAttachment, SessionMessageUser } from "@opencode/client/promise"
import type { SessionUserActions, SessionUserComment } from "../actions"
import { CurrentUserMessageDisplay } from "./message-content"
import { CurrentSessionProviders } from "../storybook/current-session-story"
import { CURRENT_SESSION_ID, STORY_MODEL, STORY_TIME } from "../storybook/current-session-fixtures"

/*
 * A prompt's quotes, file comments and notes, inline in the bubble after the text. Every case renders the shipped
 * CurrentUserMessageDisplay.
 */

type Quote = Extract<SessionUserComment, { type: "quote" }>

type Status = NonNullable<ReturnType<NonNullable<SessionUserActions["pending"]>["status"]>>

type Case = {
  name: string
  description: string
  text?: string
  comments: SessionUserComment[]
  status?: Status
  voice?: boolean
  /** A bubble sent just before, so the two form a run. */
  run?: boolean
  /** Forces Collapse long messages on for this case. */
  fold?: boolean
  files?: PromptAttachment[]
  agents?: SessionMessageUser["agents"]
}

export default {
  title: "App/Quotes/Prompt quotes",
  id: "current-prompt-quotes",
  parameters: { layout: "fullscreen" },
  args: { width: 480, scheme: "lab", direction: "ltr", fold: false, touch: false },
  argTypes: {
    width: { control: { type: "range", min: 320, max: 840, step: 20 } },
    scheme: { options: ["lab", "light", "dark"] },
    direction: { options: ["ltr", "rtl"] },
  },
}

const terminal = { label: "Terminal", icon: "terminal" }

const longQuote =
  "The scrollbar thumb has a 32px minimum height, capped at the track height, so very long sessions still show a grabbable handle. The remaining space is reserved for the timeline content, and the thumb fades out after 800ms without scrolling. On touch devices the thumb is hidden entirely and the native overscroll takes over, which is why the gutter collapses to zero there."

const mentionsText = "Use @review to check @projects.tsx before changing the sidebar spacing"

const quote = (text: string, comment?: string, source?: Quote["source"]): Quote => ({
  type: "quote",
  text,
  comment,
  source,
})

const mention = (text: string, token: string) => ({
  text: token,
  start: text.indexOf(token),
  end: text.indexOf(token) + token.length,
})

const image: PromptAttachment = {
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  mime: "image/png",
  name: "sidebar.png",
  source: { type: "inline" },
}

const notes: PromptAttachment = {
  data: "e30=",
  mime: "application/json",
  name: "spacing.json",
  source: { type: "inline" },
}

const cases = {
  oneCommented: {
    name: "One quote with a comment",
    description: "The simplest case: a short quote and what to do about it.",
    comments: [quote("gap-2 on the Projects section", "drop it to gap 1")],
  },
  severalCommented: {
    name: "Several short quotes, each commented",
    description: "Every quote carries its own instruction, with no composer text.",
    comments: [
      quote("gap-2 on the Projects section", "drop it to gap 1"),
      quote("12px is the gap-3 between the Projects section and the Pinned group header above it", "make this gap2"),
      quote("gap-2 in the Pinned group", "make it gap 1"),
      quote("mb-2 on the heading (8px) plus the tab list's 3px row padding", "change it to gap 1"),
    ],
  },
  shortAndLong: {
    name: "Short and long quotes mixed",
    description: "A long quote clamps to three lines; click it to read the rest.",
    comments: [
      quote("The menu is hovered.", "remove this"),
      quote(longQuote, "can we drop the fade and keep the thumb visible while hovering the timeline?"),
      quote("gap-2 in the Pinned group", "make it gap 1"),
    ],
  },
  quoteOnly: {
    name: "Quote only",
    description: "A quote sent with no comment and no composer text.",
    comments: [quote("gap-2 on the Projects section")],
  },
  quotesOnly: {
    name: "Several quotes, none commented",
    description: "Bare quotes stack with the same rhythm as commented ones.",
    comments: [
      quote("gap-2 on the Projects section"),
      quote("12px is the gap-3 between the Projects section and the Pinned group header above it"),
      quote("mb-2 on the heading (8px) plus the tab list's 3px row padding"),
    ],
  },
  bareQuoteWithText: {
    name: "Quote without a comment, text in the composer",
    description: "The composer text leads; the quote follows as its context.",
    text: "coat with granite solution",
    comments: [quote("Kitchen: oil countertops (guess: oil or sealant?)")],
  },
  bareQuotesWithText: {
    name: "Several bare quotes, text in the composer",
    description: "One instruction about several quoted passages.",
    text: "make both of these gap 1, and check the same spacing on mobile",
    comments: [quote("gap-2 on the Projects section"), quote("gap-2 in the Pinned group")],
  },
  mixed: {
    name: "Commented and bare quotes, text in the composer",
    description: "The composer text first, then each quote with its own comment when it has one.",
    text: "and run the sidebar story at 360px after",
    comments: [
      quote("gap-2 on the Projects section", "drop it to gap 1"),
      quote("gap-2 in the Pinned group"),
      quote("12px is the gap-3 between the Projects section and the Pinned group header above it", "make this gap 2"),
    ],
  },
  longText: {
    name: "Long composer text and a long comment",
    description: "Both wrap; the comment stays tied to its quote.",
    text: "These are all in the sidebar, so please keep the change local to the sidebar CSS and do not touch the shared spacing tokens. After that, run the sidebar story at 360px and 1280px and attach screenshots of both to the PR.",
    comments: [
      quote(
        "gap-2 on the Projects section",
        "drop it to gap 1, but only on desktop. On mobile the rows are already taller because of the 44px touch target, so the extra gap there is what keeps the section from feeling cramped against the pinned group.",
      ),
    ],
  },
  multiline: {
    name: "Multi-line quote with line breaks",
    description: "A quote of code or log output keeps its line breaks and clamps by laid-out lines.",
    comments: [
      quote(
        "$ bun typecheck\nsrc/message/comment-card.tsx:42:7 - error TS2322\nType 'string | undefined' is not assignable to type 'string'.\n\nFound 1 error in 1 file.",
        "fix this one",
      ),
    ],
  },
  unbroken: {
    name: "Unbroken long token",
    description: "A URL or hash with no spaces must wrap instead of widening the bubble.",
    comments: [
      quote(
        "https://github.com/anomalyco/opencode/actions/runs/19283746501/job/55128374650#step:7:1342-the-flaky-upload-test",
        "is this the same failure as yesterday?",
      ),
    ],
  },
  source: {
    name: "Quote from a source",
    description: "A quote from outside the timeline names where it came from.",
    comments: [
      quote(
        "error: Cannot find module '@opencode/ui/tooltip' imported from packages/session-ui/src/message/comment-card.tsx",
        "why does this only fail in the stories build?",
        terminal,
      ),
      quote("$ make\nmake: *** No rule to make target 'stories'.  Stop.", undefined, terminal),
    ],
  },
  overflow: {
    name: "Many quotes",
    description:
      "No item limit. With Collapse long messages on, the whole bubble folds past 12 lines to its first 8, with Read more.",
    text: "spacing pass on the sidebar",
    comments: [
      quote("gap-2 on the Projects section", "drop it to gap 1"),
      quote("12px is the gap-3 between the Projects section and the Pinned group header above it", "make this gap2"),
      quote("gap-2 in the Pinned group"),
      quote("mb-2 on the heading (8px) plus the tab list's 3px row padding", "change it to gap 1"),
      quote("The menu is hovered.", "remove this"),
      quote("The footer has 16px of bottom padding.", "match the header"),
      quote("Section headers use 12px uppercase labels.", "sentence case"),
      quote("The collapse chevron rotates 90 degrees."),
    ],
  },
  withComments: {
    name: "Quotes with file and note comments",
    description:
      "Quotes, file-line and page-element comments share one blockquote style, in the order they were added.",
    text: "tidy the sidebar",
    comments: [
      quote("gap-2 on the Projects section", "drop it to gap 1"),
      {
        path: "packages/app/src/sidebar/projects.tsx",
        comment: "this gap comes from here",
        selection: { startLine: 118, endLine: 124 },
      },
      {
        type: "note",
        label: "nav.sidebar",
        icon: "code",
        title: "nav.sidebar",
        subtitle: "Browser annotation",
        comment: "and this",
      },
    ],
  },
  references: {
    name: "File and note comments only",
    description: "Lines of a file, a whole file, a page element with and without a comment, and a long path.",
    text: "tidy the sidebar spacing",
    comments: [
      {
        path: "packages/app/src/sidebar/projects.tsx",
        comment: "this gap comes from here",
        selection: { startLine: 118, endLine: 124 },
      },
      { path: "packages/app/src/sidebar/pinned.tsx", comment: "same here", selection: { startLine: 42, endLine: 42 } },
      { path: "packages/ui/src/styles/tokens/spacing.css", comment: "don't change anything in this file" },
      {
        type: "note",
        label: "nav.sidebar",
        icon: "code",
        title: "nav.sidebar",
        subtitle: "Browser annotation",
        comment: "and this",
      },
      {
        type: "note",
        label: "button#collapse",
        icon: "code",
        title: "button#collapse",
        subtitle: "Browser annotation",
        comment: "",
      },
      {
        path: "packages/session-ui/src/timeline-next/tools/context-group/very-long-component-name-for-narrow-layouts.tsx",
        comment: "check this at 360px",
        selection: { startLine: 1200, endLine: 1288 },
      },
    ],
  },
  pending: {
    name: "Pending: steering",
    description: "A prompt the server has not delivered yet mutes the whole bubble, quotes included.",
    text: "and run the sidebar story at 360px after",
    comments: [quote("gap-2 in the Pinned group", "make it gap 1")],
    status: "steering",
  },
  rtl: {
    name: "Right-to-left quote and comment",
    description: "The bar follows the reading direction of the message.",
    text: "תבדוק גם במובייל",
    comments: [
      quote("המרווח בין הקטגוריות הוא 12 פיקסלים", "תקטין ל-8"),
      quote("gap-2 on the Projects section", "تصغير إلى gap 1"),
    ],
  },
  mentions: {
    name: "Mentions in the text and in a comment",
    description: "@agent and @file in the composer text keep their highlight; a comment's @path is attached as a file.",
    text: mentionsText,
    files: [
      {
        data: "e30=",
        mime: "text/plain",
        name: "projects.tsx",
        source: { type: "inline" },
        mention: mention(mentionsText, "@projects.tsx"),
      },
    ],
    agents: [{ name: "review", mention: mention(mentionsText, "@review") }],
    comments: [
      quote("gap-2 on the Projects section", "compare with @packages/app/src/sidebar/pinned.tsx first"),
      {
        path: "packages/app/src/sidebar/projects.tsx",
        comment: "the token is defined in @packages/ui/src/styles/tokens/spacing.css",
        selection: { startLine: 118, endLine: 124 },
      },
    ],
  },
  chevron: {
    name: "Quote first, under the actions chevron",
    description: "Hover the bubble: with no composer text, the chevron sits over the end of the first quote line.",
    comments: [
      quote("gap-2 on the Projects section and the Pinned group header above it", "make both gap 1"),
      quote("mb-2 on the heading"),
    ],
  },
  attachments: {
    name: "Attachments with quotes",
    description: "Images and files sit above the bubble, as today.",
    text: "match the screenshot",
    files: [image, notes],
    comments: [quote("gap-2 on the Projects section", "drop it to gap 1"), quote("gap-2 in the Pinned group")],
  },
  run: {
    name: "Bubbles in a run",
    description: "A message right after another tightens the corners where they meet; hover shows the meta line.",
    text: "and these too",
    run: true,
    comments: [quote("gap-2 in the Pinned group", "make it gap 1")],
  },
  voice: {
    name: "Voice message with a quote",
    description: "The voice badge sits on the bubble's top leading corner, above the first line.",
    text: "can you make this smaller",
    voice: true,
    comments: [quote("gap-2 on the Projects section")],
  },
  voiceQuoteFirst: {
    name: "Voice message, quote only",
    description: "With no text, the badge meets the quote's bar.",
    voice: true,
    comments: [quote("gap-2 on the Projects section", "smaller")],
  },
  sending: {
    name: "Pending: sending",
    description: "Not yet admitted by the server: no actions chevron.",
    text: "and run the sidebar story at 360px after",
    status: "sending",
    comments: [quote("gap-2 in the Pinned group", "make it gap 1")],
  },
  starting: {
    name: "Pending: starting",
    description: "Admitted, about to run.",
    text: "and run the sidebar story at 360px after",
    status: "starting",
    comments: [quote("gap-2 in the Pinned group", "make it gap 1")],
  },
  queued: {
    name: "Pending: queued",
    description: "Waiting in the queue.",
    text: "and run the sidebar story at 360px after",
    status: "queued",
    comments: [quote("gap-2 in the Pinned group", "make it gap 1")],
  },
  stranded: {
    name: "Pending: stranded",
    description: "A steer the run ended before delivering.",
    text: "and run the sidebar story at 360px after",
    status: "stranded",
    comments: [quote("gap-2 in the Pinned group", "make it gap 1")],
  },
  foldAndExpand: {
    name: "Collapsed bubble with a cut-off quote",
    description:
      "Collapse long messages is on. Read more, then click the long quote: opening it grows the bubble past the fold again.",
    text: "two things on the scrollbar",
    fold: true,
    comments: [
      quote(longQuote, "drop the fade"),
      quote("The thumb uses the border-strong token.", "use border-base"),
      quote(longQuote, "and check touch"),
    ],
  },
  nested: {
    name: "Quote of a message that had quotes",
    description: "Selecting across a quote and its comment in an earlier bubble quotes both as plain lines.",
    comments: [quote("gap-2 on the Projects section\ndrop it to gap 1", "did this land?")],
  },
  whitespace: {
    name: "Blank lines and whitespace",
    description:
      "Blank lines around a quote are trimmed, a whitespace-only quote shows only its comment, and a whitespace-only comment is dropped.",
    comments: [
      quote("\n\n  gap-2 on the Projects section  \n\n", "trailing lines above"),
      quote("   \n  ", "the quote above is only whitespace"),
      quote("gap-2 in the Pinned group", "   "),
    ],
  },
  markdown: {
    name: "Code and markdown in a quote",
    description: "Fences, backticks and headings show as plain text.",
    comments: [quote("# Spacing\n```ts\nconst gap = 8\n```\nUse `gap-2` in the **sidebar**.", "is this right?")],
  },
  legacyNotes: {
    name: "Old-style and right-to-left notes",
    description: "A note with only a label, and one with a right-to-left subtitle.",
    comments: [
      { type: "note", label: "Legacy element", icon: "code", comment: "fix this" },
      {
        type: "note",
        label: "زر الحفظ",
        icon: "code",
        title: "button#save",
        subtitle: "تعليق المتصفح",
        comment: "تحقق من هذا",
      },
    ],
  },
  oddFiles: {
    name: "File without an extension, and a folder",
    description: "Each gets its own icon.",
    comments: [
      { path: "Makefile", comment: "add a stories target" },
      { path: "packages/app/src/sidebar/", comment: "everything in here" },
    ],
  },
} satisfies Record<string, Case>

const heMentions = "תשתמש ב-@review כדי לבדוק את @projects.tsx לפני שמשנים את המרווחים"

const heLongQuote =
  "לפס הגלילה יש גובה מינימלי של 32 פיקסלים, מוגבל לגובה המסילה, כך שגם בשיחות ארוכות מאוד נשארת ידית שאפשר לתפוס. שאר המקום שמור לתוכן ציר הזמן, והפס נעלם אחרי 800 מילישניות בלי גלילה. במכשירי מגע הפס מוסתר לגמרי והגלילה המקורית לוקחת פיקוד, ולכן המרווח מתכווץ לאפס."

/** English content keeps its own direction inside an RTL timeline, so the RTL stories need right-to-left content. */
const rtlCases = {
  oneCommented: {
    name: "RTL: one quote with a comment",
    description: "Hebrew quote and comment: the bar sits on the right, at the start of the line.",
    comments: [quote("המרווח בקטע הפרויקטים הוא gap-2", "תקטין ל-gap-1")],
  },
  severalCommented: {
    name: "RTL: several short quotes, each commented",
    description: "Every quote carries its own instruction.",
    comments: [
      quote("המרווח בקטע הפרויקטים הוא gap-2", "תקטין ל-gap-1"),
      quote("יש 12 פיקסלים בין קטע הפרויקטים לכותרת הקבוצה המוצמדת שמעליו", "תעשה את זה gap-2"),
      quote("gap-2 בקבוצה המוצמדת", "תעשה gap-1"),
    ],
  },
  shortAndLong: {
    name: "RTL: short and long quotes mixed",
    description: "The long quote clamps to three lines; click it to read the rest.",
    comments: [quote("התפריט במצב ריחוף.", "תסיר את זה"), quote(heLongQuote, "אפשר לוותר על ההיעלמות?")],
  },
  quotesOnly: {
    name: "RTL: quotes only",
    description: "No comment and no composer text.",
    comments: [quote("המרווח בקטע הפרויקטים הוא gap-2"), quote("gap-2 בקבוצה המוצמדת")],
  },
  mixed: {
    name: "RTL: commented and bare quotes, text in the composer",
    description: "The composer text first, then each quote with its comment.",
    text: "ואחר כך תריץ את הסטורי של סרגל הצד ב-360 פיקסלים",
    comments: [
      quote("המרווח בקטע הפרויקטים הוא gap-2", "תקטין ל-gap-1"),
      quote("gap-2 בקבוצה המוצמדת"),
      quote("יש 12 פיקסלים בין קטע הפרויקטים לכותרת שמעליו", "תעשה gap-2"),
    ],
  },
  mixedLanguage: {
    name: "RTL: English quotes in a Hebrew message",
    description:
      "Each quote reads in its own direction, but lines up with the bubble: bar on the right, text from the right.",
    text: "תבדוק את שניהם",
    comments: [
      quote("gap-2 on the Projects section", "תקטין ל-gap-1"),
      quote("12px is the gap-3 between the Projects section and the Pinned group header above it"),
    ],
  },
  source: {
    name: "RTL: terminal quote with a Hebrew comment",
    description: "Terminal output stays left-to-right inside a right-to-left bubble.",
    comments: [
      quote(
        "error: Cannot find module '@opencode/ui/tooltip' imported from packages/session-ui/src/message/comment-card.tsx",
        "למה זה נכשל רק בבנייה של הסטוריז?",
        terminal,
      ),
    ],
  },
  references: {
    name: "RTL: file and note comments",
    description: "File names and selectors stay left-to-right; the comments read right-to-left.",
    text: "תסדר את המרווחים בסרגל הצד",
    comments: [
      {
        path: "packages/app/src/sidebar/projects.tsx",
        comment: "המרווח מגיע מכאן",
        selection: { startLine: 118, endLine: 124 },
      },
      {
        type: "note",
        label: "nav.sidebar",
        icon: "code",
        title: "nav.sidebar",
        subtitle: "הערת דפדפן",
        comment: "וגם זה",
      },
    ],
  },
  mentions: {
    name: "RTL: mentions",
    description: "@agent and @file inside Hebrew text.",
    text: heMentions,
    files: [
      {
        data: "e30=",
        mime: "text/plain",
        name: "projects.tsx",
        source: { type: "inline" },
        mention: mention(heMentions, "@projects.tsx"),
      },
    ],
    agents: [{ name: "review", mention: mention(heMentions, "@review") }],
    comments: [quote("gap-2 בקבוצה המוצמדת", "תשווה ל-@packages/app/src/sidebar/pinned.tsx")],
  },
  arabic: {
    name: "RTL: Arabic",
    description: "The same layout in Arabic.",
    text: "تحقق من هذه أيضاً على الجوال",
    comments: [quote("المسافة بين الأقسام هي 12 بكسل", "صغّرها إلى 8"), quote("العنوان يستخدم حروفاً كبيرة")],
  },
  pending: {
    name: "RTL: pending steer",
    description: "Muted while it waits.",
    text: "ואחר כך תריץ את הסטורי",
    status: "steering",
    comments: [quote("gap-2 בקבוצה המוצמדת", "תעשה gap-1")],
  },
  fold: {
    name: "RTL: collapsed bubble",
    description: "Collapse long messages on: Read more sits at the start of the line.",
    text: "שני דברים על פס הגלילה",
    fold: true,
    comments: [
      quote(heLongQuote, "בלי היעלמות"),
      quote("הפס משתמש בצבע border-strong.", "תעבור ל-border-base"),
      quote(heLongQuote, "ותבדוק מגע"),
    ],
  },
} satisfies Record<string, Case>

type Args = {
  width: number
  /** The lab sets one scheme for every story, so a story forces its own here; "lab" follows the lab's toggle. */
  scheme: "lab" | "light" | "dark"
  direction: "ltr" | "rtl"
  fold: boolean
  touch: boolean
}

export const AllCases = {
  render: (args: Args) => (
    <Page args={args}>
      <For each={Object.values(cases)}>{(item) => <Example case={item} args={args} />}</For>
    </Page>
  ),
}

export const AllCasesLight = { ...AllCases, args: { scheme: "light" } }

export const AllCasesDark = { ...AllCases, args: { scheme: "dark" } }

export const AllCasesNarrow = { ...AllCases, args: { width: 360 } }

/** A phone: 320px and no hover, so the actions chevron always shows and keeps room on the first line. */
export const AllCasesPhone = { ...AllCases, args: { width: 320, touch: true } }

export const AllCasesRtl = {
  args: { direction: "rtl" },
  render: (args: Args) => (
    <Page args={args}>
      <For each={Object.values(rtlCases)}>{(item) => <Example case={item} args={args} />}</For>
    </Page>
  ),
}

export const AllCasesCollapsed = { ...AllCases, args: { fold: true } }

const single = (item: Case) => ({
  render: (args: Args) => (
    <Page args={args}>
      <Example case={item} args={args} />
    </Page>
  ),
})

export const OneCommented = single(cases.oneCommented)

export const SeveralCommented = single(cases.severalCommented)

export const ShortAndLong = single(cases.shortAndLong)

export const QuoteOnly = single(cases.quoteOnly)

export const QuotesOnly = single(cases.quotesOnly)

export const BareQuoteWithText = single(cases.bareQuoteWithText)

export const BareQuotesWithText = single(cases.bareQuotesWithText)

export const Mixed = single(cases.mixed)

export const LongText = single(cases.longText)

export const Multiline = single(cases.multiline)

export const Unbroken = single(cases.unbroken)

export const Source = single(cases.source)

export const Overflow = { ...single(cases.overflow), args: { fold: true } }

export const WithComments = single(cases.withComments)

export const References = single(cases.references)

export const Mentions = single(cases.mentions)

export const Chevron = single(cases.chevron)

export const Attachments = single(cases.attachments)

export const Run = single(cases.run)

export const Voice = single(cases.voice)

export const VoiceQuoteFirst = single(cases.voiceQuoteFirst)

export const Steering = single(cases.pending)

export const Sending = single(cases.sending)

export const Starting = single(cases.starting)

export const Queued = single(cases.queued)

export const Stranded = single(cases.stranded)

export const FoldAndExpand = single(cases.foldAndExpand)

export const Nested = single(cases.nested)

export const Whitespace = single(cases.whitespace)

export const Markdown = single(cases.markdown)

export const LegacyNotes = single(cases.legacyNotes)

export const OddFiles = single(cases.oddFiles)

export const Rtl = { ...single(cases.rtl), args: { direction: "rtl" } }

export const Touch = { ...single(cases.chevron), args: { width: 320, touch: true } }

function Page(props: { args: Args; children: JSX.Element }) {
  return (
    <CurrentSessionProviders
      document={{ sessionID: CURRENT_SESSION_ID, messages: [], status: { type: "idle" }, diffs: [] }}
    >
      <style>{STORY_CSS}</style>
      <section
        class="flex min-h-full w-max min-w-full flex-col gap-10 p-6"
        data-story-page
        data-story-touch={props.args.touch ? "" : undefined}
        data-color-scheme={props.args.scheme === "lab" ? undefined : props.args.scheme}
      >
        {props.children}
      </section>
    </CurrentSessionProviders>
  )
}

function Example(props: { case: Case; args: Args }) {
  const fold = () => props.case.fold ?? props.args.fold

  return (
    <article class="flex flex-col gap-3">
      <header class="flex flex-col gap-0.5">
        <h2 class="text-[14px] leading-5 [font-weight:530]">{props.case.name}</h2>
        <p class="text-[13px] leading-5" data-story-muted>
          {props.case.description}
        </p>
      </header>
      {/* Only the timeline area takes the direction; the story's headings stay put. */}
      <div
        class="flex shrink-0 flex-col gap-1 rounded-[8px] px-4 py-4"
        style={{ width: `${props.args.width}px` }}
        data-story-surface
        dir={props.args.direction}
      >
        {/* The timeline puts 4px between the bubbles of a run. */}
        <Show when={props.case.run}>
          <CurrentUserMessageDisplay
            sessionID={CURRENT_SESSION_ID}
            message={{
              id: "msg_quotes_run_start",
              type: "user",
              text: "",
              time: { created: STORY_TIME },
              files: [],
            }}
            text="tidy the sidebar spacing"
            agent="build"
            model={STORY_MODEL}
            run={{ above: false, below: true }}
          />
        </Show>
        <Message case={props.case} fold={fold()} />
      </div>
    </article>
  )
}

function Message(props: { case: Case; fold: boolean }) {
  const status = props.case.status

  return (
    <CurrentUserMessageDisplay
      sessionID={CURRENT_SESSION_ID}
      message={message(props.case)}
      text={props.case.text ?? ""}
      agent="build"
      model={STORY_MODEL}
      comments={props.case.comments}
      fold={props.fold}
      voice={props.case.voice}
      run={props.case.run ? { above: true, below: false } : undefined}
      actions={{
        revert: () => {},
        fork: () => {},
        pending: status ? { status: () => status, queue: async () => {}, remove: async () => {} } : undefined,
      }}
    />
  )
}

function message(item: Case): SessionMessageUser {
  return {
    id: `msg_quotes_${item.name.toLowerCase().replaceAll(/\W+/g, "_")}`,
    type: "user",
    text: item.text ?? "",
    time: { created: STORY_TIME },
    files: item.files ?? [],
    agents: item.agents,
  }
}

const STORY_CSS = `
/* Tailwind's color utilities resolve the theme at the root, so a forced scheme on the story would miss them. The
   story's own chrome reads the theme variables directly instead. */
[data-story-page] {
  background: var(--v2-background-bg-layer-01);
  color: var(--v2-text-text-base);
}

[data-story-muted] {
  color: var(--v2-text-text-muted);
}

[data-story-surface] {
  background: var(--v2-background-bg-base);
  box-shadow: inset 0 0 0 0.5px var(--v2-border-border-base);
}

/* Hover-less screens, which the lab can't emulate: the chevron always shows and keeps room on the first line. */
[data-story-touch] [data-component="user-message"] [data-slot="user-message-text"] > [data-slot="user-message-menu"] {
  opacity: 1;
  pointer-events: auto;
  padding: 0;
  background: none;
}

[data-story-touch] [data-component="user-message"] [data-slot="user-message-text"]:has(> [data-slot="user-message-menu"])::before {
  content: "";
  float: inline-end;
  width: 20px;
  height: 1lh;
}
`
