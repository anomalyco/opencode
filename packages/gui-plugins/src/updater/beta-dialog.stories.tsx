import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Option } from "effect"
import { createSignal, onMount, Show } from "solid-js"
import { SettingsPanel } from "../../../stories/mocks/gui-plugins/settings-page"
import { DialogBetaNotes } from "./beta-dialog"
import { BetaNotesView } from "./beta-page"
import { sliceBetaNotes, type EmbeddedNotes } from "./beta-notes"

type Author = { name: string; login?: string; avatar?: string }

// Fictional people with drawn avatars, so the stories show no real names or photos.
const avatar = (hue: number) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="hsl(${hue} 45% 62%)"/><circle cx="24" cy="19" r="9" fill="hsl(${hue} 40% 88%)"/><rect x="9" y="32" width="30" height="20" rx="10" fill="hsl(${hue} 40% 88%)"/></svg>`,
  )}`

const people = {
  mira: { name: "Mira Okafor", login: "mira", avatar: avatar(18) },
  theo: { name: "Theo Lindqvist", login: "theo", avatar: avatar(205) },
  juno: { name: "Juno Park", login: "juno", avatar: avatar(140) },
  ravi: { name: "ravi-c", login: "ravi-c" },
  wren: { name: "Wren Abernathy", login: "wren", avatar: avatar(265) },
} satisfies Record<string, Author>

// Example visuals as a build embeds them from a pull request's "### Visual": animated, and the still for reduced motion.
const visuals = {
  dock: {
    animated:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 72" fill="none"><style>.d{transform-box:fill-box;transform-origin:50% 100%;animation:g 4s cubic-bezier(.2,.8,.2,1) infinite}.c{animation:f 4s ease-out infinite}@keyframes g{0%,12%{transform:scaleY(.3);opacity:0}28%,72%{transform:none;opacity:1}88%,100%{transform:scaleY(.3);opacity:0}}@keyframes f{0%,26%{opacity:0}36%,70%{opacity:1}80%,100%{opacity:0}}</style><g class="d"><rect x="56" y="10" width="128" height="30" rx="6" fill="currentColor" fill-opacity=".08" stroke="currentColor" stroke-opacity=".35"/><g class="c" fill="currentColor"><rect x="64" y="17" width="64" height="4" rx="2" fill-opacity=".55"/><rect x="64" y="25" width="40" height="4" rx="2" fill-opacity=".25"/><rect x="140" y="27" width="18" height="8" rx="4" fill-opacity=".25"/><rect x="161" y="27" width="16" height="8" rx="4" fill-opacity=".6"/></g></g><rect x="48" y="40" width="144" height="24" rx="8" fill="currentColor" fill-opacity=".06" stroke="currentColor" stroke-opacity=".5"/><rect x="58" y="50" width="52" height="4" rx="2" fill="currentColor" fill-opacity=".35"/><circle cx="180" cy="52" r="6" fill="currentColor" fill-opacity=".7"/></svg>',
    still:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 72" fill="none"><style>.d{transform-box:fill-box;transform-origin:50% 100%}.c{}</style><g class="d"><rect x="56" y="10" width="128" height="30" rx="6" fill="currentColor" fill-opacity=".08" stroke="currentColor" stroke-opacity=".35"/><g class="c" fill="currentColor"><rect x="64" y="17" width="64" height="4" rx="2" fill-opacity=".55"/><rect x="64" y="25" width="40" height="4" rx="2" fill-opacity=".25"/><rect x="140" y="27" width="18" height="8" rx="4" fill-opacity=".25"/><rect x="161" y="27" width="16" height="8" rx="4" fill-opacity=".6"/></g></g><rect x="48" y="40" width="144" height="24" rx="8" fill="currentColor" fill-opacity=".06" stroke="currentColor" stroke-opacity=".5"/><rect x="58" y="50" width="52" height="4" rx="2" fill="currentColor" fill-opacity=".35"/><circle cx="180" cy="52" r="6" fill="currentColor" fill-opacity=".7"/></svg>',
  },
  spinners: {
    animated:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 72" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><style>.s{transform-box:view-box;animation:r 1.6s linear infinite}.p{animation:p 1.6s ease-in-out infinite}@keyframes r{to{transform:rotate(360deg)}}@keyframes p{0%,100%{opacity:.08}50%{opacity:.3}}</style><path class="p" d="M44 36h152" stroke-width="1" stroke-dasharray="2 4"/><g stroke-opacity=".15"><circle cx="60" cy="36" r="11"/><circle cx="120" cy="36" r="11"/><circle cx="180" cy="36" r="11"/></g><g stroke-opacity=".8"><path class="s" style="transform-origin:60px 36px" d="M60 25a11 11 0 0 1 11 11"/><path class="s" style="transform-origin:120px 36px" d="M120 25a11 11 0 0 1 11 11"/><path class="s" style="transform-origin:180px 36px" d="M180 25a11 11 0 0 1 11 11"/></g></svg>',
    still:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 72" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><style>.s{transform-box:view-box}.p{}</style><path class="p" d="M44 36h152" stroke-width="1" stroke-dasharray="2 4"/><g stroke-opacity=".15"><circle cx="60" cy="36" r="11"/><circle cx="120" cy="36" r="11"/><circle cx="180" cy="36" r="11"/></g><g stroke-opacity=".8"><path class="s" style="transform-origin:60px 36px" d="M60 25a11 11 0 0 1 11 11"/><path class="s" style="transform-origin:120px 36px" d="M120 25a11 11 0 0 1 11 11"/><path class="s" style="transform-origin:180px 36px" d="M180 25a11 11 0 0 1 11 11"/></g></svg>',
  },
  palette: {
    animated:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 72" fill="currentColor"><style>.t{transform-box:fill-box;transform-origin:0 50%;animation:t 4s steps(6,end) infinite}.h{animation:h 4s ease-out infinite}.o{animation:o 4s ease-out infinite}@keyframes t{0%,8%{transform:scaleX(0)}38%,84%{transform:none}96%,100%{transform:scaleX(0)}}@keyframes h{0%,40%{opacity:0}50%,84%{opacity:1}94%,100%{opacity:0}}@keyframes o{0%,40%{opacity:.45}50%,84%{opacity:1}94%,100%{opacity:.45}}</style><rect x="52" y="4" width="136" height="64" rx="7" fill-opacity=".06" stroke="currentColor" stroke-opacity=".35"/><rect class="t" x="62" y="13" width="44" height="5" rx="2.5" fill-opacity=".6"/><rect x="52" y="24" width="136" height="1" fill-opacity=".15"/><rect x="62" y="31" width="22" height="3" rx="1.5" fill-opacity=".25"/><rect class="h" x="56" y="38" width="128" height="12" rx="4" fill-opacity=".12"/><circle class="o" cx="66" cy="44" r="3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-opacity=".55"/><rect class="o" x="74" y="42" width="52" height="4" rx="2" fill-opacity=".55"/><rect x="62" y="56" width="8" height="4" rx="2" fill-opacity=".2"/><rect x="74" y="56" width="70" height="4" rx="2" fill-opacity=".2"/></svg>',
    still:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 72" fill="currentColor"><style>.t{transform-box:fill-box;transform-origin:0 50%}.h{}.o{}</style><rect x="52" y="4" width="136" height="64" rx="7" fill-opacity=".06" stroke="currentColor" stroke-opacity=".35"/><rect class="t" x="62" y="13" width="44" height="5" rx="2.5" fill-opacity=".6"/><rect x="52" y="24" width="136" height="1" fill-opacity=".15"/><rect x="62" y="31" width="22" height="3" rx="1.5" fill-opacity=".25"/><rect class="h" x="56" y="38" width="128" height="12" rx="4" fill-opacity=".12"/><circle class="o" cx="66" cy="44" r="3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-opacity=".55"/><rect class="o" x="74" y="42" width="52" height="4" rx="2" fill-opacity=".55"/><rect x="62" y="56" width="8" height="4" rx="2" fill-opacity=".2"/><rect x="74" y="56" width="70" height="4" rx="2" fill-opacity=".2"/></svg>',
  },
  sidebar: {
    animated:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 72" fill="currentColor"><style>.b{animation:b 4.5s cubic-bezier(.45,0,.2,1) infinite}.m{animation:m 4.5s cubic-bezier(.45,0,.2,1) infinite}@keyframes b{0%,15%{transform:translateX(-44px)}40%,70%{transform:none}95%,100%{transform:translateX(-44px)}}@keyframes m{0%,15%{transform:translateX(-44px)}40%,70%{transform:none}95%,100%{transform:translateX(-44px)}}</style><defs><clipPath id="w"><rect x="44" y="6" width="152" height="60" rx="6"/></clipPath></defs><rect x="44" y="6" width="152" height="60" rx="6" fill-opacity=".05" stroke="currentColor" stroke-opacity=".35"/><g clip-path="url(#w)"><g class="b"><rect x="44" y="6" width="44" height="60" fill-opacity=".1"/><rect x="52" y="16" width="26" height="4" rx="2" fill-opacity=".5"/><rect x="52" y="26" width="20" height="4" rx="2" fill-opacity=".25"/><rect x="52" y="36" width="24" height="4" rx="2" fill-opacity=".25"/></g><g class="m"><rect x="88" y="6" width="1" height="60" fill-opacity=".25"/><rect x="100" y="16" width="64" height="5" rx="2.5" fill-opacity=".55"/><rect x="100" y="27" width="84" height="4" rx="2" fill-opacity=".25"/><rect x="100" y="36" width="72" height="4" rx="2" fill-opacity=".25"/><rect x="100" y="45" width="80" height="4" rx="2" fill-opacity=".25"/></g></g></svg>',
    still:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 72" fill="currentColor"><style>.b{}.m{}</style><defs><clipPath id="w"><rect x="44" y="6" width="152" height="60" rx="6"/></clipPath></defs><rect x="44" y="6" width="152" height="60" rx="6" fill-opacity=".05" stroke="currentColor" stroke-opacity=".35"/><g clip-path="url(#w)"><g class="b"><rect x="44" y="6" width="44" height="60" fill-opacity=".1"/><rect x="52" y="16" width="26" height="4" rx="2" fill-opacity=".5"/><rect x="52" y="26" width="20" height="4" rx="2" fill-opacity=".25"/><rect x="52" y="36" width="24" height="4" rx="2" fill-opacity=".25"/></g><g class="m"><rect x="88" y="6" width="1" height="60" fill-opacity=".25"/><rect x="100" y="16" width="64" height="5" rx="2.5" fill-opacity=".55"/><rect x="100" y="27" width="84" height="4" rx="2" fill-opacity=".25"/><rect x="100" y="36" width="72" height="4" rx="2" fill-opacity=".25"/><rect x="100" y="45" width="80" height="4" rx="2" fill-opacity=".25"/></g></g></svg>',
  },
}

const commits: [
  type: "feat" | "fix" | "perf",
  summary: string,
  pr: number | undefined,
  author: Author,
  description?: string,
  visual?: { animated: string; still: string },
][] = [
  [
    "feat",
    "grow questions and permissions out of the composer",
    57103,
    people.mira,
    "Questions and permission requests grow out of the top of the composer, and fold back into it once answered.",
    visuals.dock,
  ],
  [
    "fix",
    "keep activity spinners in step",
    57101,
    people.theo,
    "Every busy spinner on screen turns in step, wherever it appeared.",
    visuals.spinners,
  ],
  [
    "feat",
    "find settings from the command palette",
    57094,
    people.juno,
    "Typing in the command palette also finds settings, in their own group.",
    visuals.palette,
  ],
  ["fix", "open activity panel above the capsule", 57088, people.ravi],
  [
    "feat",
    "glide the sidebar open and closed",
    57090,
    people.wren,
    "The sidebar slides in and out, and the content beside it moves with its edge.",
    visuals.sidebar,
  ],
  ["fix", "disable animated wheel scrolling on linux", 57080, people.wren],
  ["perf", "cache the model list between sessions", 57050, people.juno],
  ["feat", "merge projects across servers in the location dialog", 55838, people.theo],
  ["fix", "fit connect dialog steps to their content under a fixed top edge", 57006, people.wren],
  ["feat", "add an experimental session inbox to the sidebar", 55647, people.ravi],
  ["fix", "debounce compatibility skill reloads", 56260, people.theo],
  ["fix", "restore blue user bubbles with grey pending steers", 57001, people.mira],
  ["feat", "open images from their place in the message", 56896, people.juno],
  ["fix", "install each Windows channel into its own directory", 56904, people.wren],
  ["feat", "show MCP errors from a failed status link", undefined, people.ravi],
  ["fix", "open dialogs with their input focused", undefined, people.theo],
  ["fix", "default agent notifications to off", 56990, people.juno],
  ["feat", "add Focus and Pro interface picker to preferences", 56898, people.mira],
]

const sha = (n: number) => n.toString(16).padStart(4, "0").padEnd(40, "a")

// A build's embedded history: one commit per entry, newest first, with a chore between the notes.
const embedded = (picked: typeof commits): EmbeddedNotes => ({
  sha: sha(1000),
  commits: [sha(1000), ...picked.flatMap((_, i) => [sha(i * 2 + 1), sha(i * 2 + 2)]), sha(999)].map((value) =>
    value.slice(0, 12),
  ),
  notes: picked.map(([type, summary, pr, author, description, visual], i) => ({
    type,
    summary,
    pr,
    sha: sha(i * 2 + 1).slice(0, 12),
    author,
    description,
    visual,
  })),
})

// What a build without GitHub access embeds: commit authors without avatars, and no visuals.
const offline = (picked: typeof commits): typeof commits =>
  picked.map(([type, summary, pr, author]) => [type, summary, pr, { name: author.name }])

// View all opens the What's new page in place of the story, as the app opens it in Settings.
function Fixture(props: { picked: typeof commits; previous?: string; previousCommit?: string }) {
  const dialog = useDialog()
  const [page, setPage] = createSignal(false)
  const notes = Option.getOrThrow(sliceBetaNotes(embedded(props.picked), props.previousCommit ?? sha(999)))

  const open = () =>
    dialog.show(() => (
      <DialogBetaNotes
        notes={notes}
        previous={props.previous ?? "0.0.0-beta-21180"}
        dialog={{ close: () => dialog.close() }}
        open={(href) => window.open(href, "_blank")}
        viewAll={() => {
          dialog.close()
          setPage(true)
        }}
      />
    ))

  onMount(open)

  return (
    <Show when={page()} fallback={<Button onClick={open}>Open What's new in beta</Button>}>
      <SettingsPanel>
        <BetaNotesView embedded={embedded(props.picked)} open={(href) => window.open(href, "_blank")} />
      </SettingsPanel>
    </Show>
  )
}

export default {
  title: "Plugins/Updater/What's new in beta",
  id: "plugins-updater-beta-notes",
  parameters: {
    docs: {
      description: {
        component:
          "The dialog a beta desktop build shows after an update: the features and fixes since the build the user last saw.",
      },
    },
  },
}

/** A typical update: a few features and fixes. */
export const Typical = { render: () => <Fixture picked={commits.slice(0, 8)} /> }

/** More than ten changes: View all opens the What's new page. */
export const Many = {
  render: () => <Fixture picked={commits} previous="0.0.0-beta-21012" />,
}

/** Built without GitHub: commit authors as initials, and kind icons where the visuals would be. */
export const Offline = { render: () => <Fixture picked={offline(commits.slice(0, 8))} /> }

/** Only fixes, so the New section is not shown. */
export const FixesOnly = {
  render: () => <Fixture picked={commits.filter(([type]) => type === "fix").slice(0, 4)} />,
}

/** The previous build is older than the embedded history: the newest changes stand in, and View all shows the rest. */
export const PreviousBuildUnknown = {
  render: () => <Fixture picked={commits} previous="0.0.0-beta-20500" previousCommit={sha(5000)} />,
}

/** Settings > What's new in beta: every change the build carries, from Settings or the dialog's View all. */
export const Page = {
  render: () => (
    <SettingsPanel>
      <BetaNotesView embedded={embedded(commits)} open={(href) => window.open(href, "_blank")} />
    </SettingsPanel>
  ),
}
