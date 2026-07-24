import { createMemo, For, type JSX } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { WordmarkV2 } from "@opencode-ai/ui/v2/wordmark-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { usePrompt } from "@/context/prompt"
import { useSync } from "@/context/sync"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { getFilename } from "@opencode-ai/core/util/path"
import { sessionTitle } from "@/utils/session-title"
import { legacySessionHref } from "@/utils/session-route"

const ALL_PROMPT_CARDS = [
  {
    title: "Build Feature",
    desc: "Generate new components or logic",
    icon: "sparkles",
    prompt: "Help me design and implement a new feature for this project.",
  },
  {
    title: "Explain Codebase",
    desc: "Understand architecture & flow",
    icon: "magnifying-glass",
    prompt: "Can you give me an overview of how this codebase is structured?",
  },
  {
    title: "Debug & Fix",
    desc: "Identify errors and stack traces",
    icon: "help",
    prompt: "Review the workspace for potential bugs or code smells.",
  },
  {
    title: "Refactor Code",
    desc: "Optimize speed and readability",
    icon: "edit",
    prompt: "Suggest performance optimizations and code quality refactoring.",
  },
  {
    title: "Write Tests",
    desc: "Create comprehensive test suites",
    icon: "check",
    prompt: "Write unit and integration tests for the primary modules.",
  },
  {
    title: "Add Features",
    desc: "Expand functionality & UI",
    icon: "plus",
    prompt: "Add new interactive controls and expand application capabilities.",
  },
  {
    title: "Review Security",
    desc: "Check for vulnerabilities & leaks",
    icon: "settings-gear",
    prompt: "Audit the codebase for security flaws and credential exposure.",
  },
  {
    title: "Optimize Performance",
    desc: "Reduce latency & bundle size",
    icon: "grid-plus",
    prompt: "Analyze performance bottlenecks and suggest optimizations.",
  },
  {
    title: "Clean Up Code",
    desc: "Tidy up structure & types",
    icon: "folder",
    prompt: "Clean up unused code, dead imports, and refine file organization.",
  },
  {
    title: "Branch Workflow",
    desc: "Manage VCS & git changes",
    icon: "branch",
    prompt: "Help me manage git branches and prepare changes for review.",
  },
] as const

type HybridCard = {
  id: string
  title: string
  desc: string
  icon: string
  kind: "prompt" | "project" | "session"
  payload: string
}

function getDynamicGreeting() {
  const hour = new Date().getHours()
  let timeGreeting = "Good day"
  if (hour >= 5 && hour < 12) timeGreeting = "Good morning"
  else if (hour >= 12 && hour < 17) timeGreeting = "Good afternoon"
  else if (hour >= 17 && hour < 22) timeGreeting = "Good evening"
  else timeGreeting = "Working late tonight"

  const options = [
    `${timeGreeting}! What's on your mind today?`,
    `${timeGreeting}! What are we building next?`,
    "What's the plan in your mind?",
    "What would you like to build?",
    "Where shall we start today?",
    "Ready to craft something great?",
    "What are we working on next?",
    "Let's turn your ideas into code.",
    "How can I help with your project?",
  ]

  const index = Math.floor(Math.random() * options.length)
  return options[index]!
}

export function NewSessionDesignView(props: { children: JSX.Element }) {
  const prompt = usePrompt()
  const sync = useSync()
  const navigate = useNavigate()

  const greeting = createMemo(() => getDynamicGreeting())

  // Hybrid Action Cards: Combines Recent Projects/Sessions (if available) with Dynamic Prompt Cards
  const hybridCards = createMemo<HybridCard[]>(() => {
    const cards: HybridCard[] = []
    const seen = new Set<string>()

    // 1. Collect Recent Projects
    const rawProjects = Array.isArray(sync().data.project) ? (sync().data.project as unknown as any[]) : []
    const projects = rawProjects
      .slice()
      .sort((a: any, b: any) => (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0))
    for (const project of projects) {
      if (cards.length >= 2) break
      const name = getFilename(project.worktree) || project.name || "Project"
      if (!seen.has(`project:${name}`)) {
        seen.add(`project:${name}`)
        cards.push({
          id: `proj-${project.id}`,
          title: name,
          desc: "Recent Project",
          icon: "folder",
          kind: "project",
          payload: `/${base64Encode(project.worktree)}`,
        })
      }
    }

    // 2. Collect Recent Sessions
    const rawSessions = Array.isArray(sync().data.session) ? (sync().data.session as unknown as any[]) : []
    const sessions = rawSessions
      .slice()
      .sort((a: any, b: any) => (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0))
    for (const sess of sessions) {
      if (cards.length >= 4) break
      const title = sessionTitle(sess.title) || "Recent Session"
      if (!seen.has(`session:${sess.id}`)) {
        seen.add(`session:${sess.id}`)
        cards.push({
          id: `sess-${sess.id}`,
          title,
          desc: "Resume Session",
          icon: "status",
          kind: "session",
          payload: legacySessionHref(sess.directory, sess.id),
        })
      }
    }

    // 3. Fill remaining slots up to 4 with Dynamic Prompt Cards
    const shuffledPrompts = [...ALL_PROMPT_CARDS].sort(() => 0.5 - Math.random())
    for (const p of shuffledPrompts) {
      if (cards.length >= 4) break
      if (!seen.has(`prompt:${p.title}`)) {
        seen.add(`prompt:${p.title}`)
        cards.push({
          id: `prompt-${p.title}`,
          title: p.title,
          desc: p.desc,
          icon: p.icon,
          kind: "prompt",
          payload: p.prompt,
        })
      }
    }

    return cards
  })

  function handleCardClick(card: HybridCard) {
    if (card.kind === "prompt") {
      if (!prompt || !prompt.ready()) return
      prompt.set([{ type: "text", content: card.payload, start: 0, end: card.payload.length }], card.payload.length)
    } else {
      navigate(card.payload)
    }
  }

  return (
    <div
      data-component="session-new-design"
      class="relative size-full overflow-y-auto overflow-x-hidden bg-v2-background-bg-deep text-v2-text-text-base flex flex-col items-center justify-center p-6 select-none transition-colors duration-300"
    >
      {/* Dynamic Ambient Background: Soft Black Shadow on Light Mode, Soft White Glow on Dark Mode */}
      <div class="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        {/* Soft Radial Ambient Spotlight & Vignette */}
        <div class="ambient-glow-orb size-[600px] rounded-full blur-[130px] transition-colors duration-300" />
        <div class="ambient-glow-vignette absolute inset-0 transition-opacity duration-300" />
      </div>

      {/* Embedded Theme Styles for Ambient Center Background */}
      <style>{`
        @keyframes mascot-bob {
          0%, 100% {
            transform: translateY(0px) rotate(0deg);
          }
          50% {
            transform: translateY(-6px) rotate(1.5deg);
          }
        }
        .mascot-float {
          animation: mascot-bob 3.5s ease-in-out infinite;
          mix-blend-mode: screen;
        }
        .ambient-glow-orb {
          background-color: rgba(0, 0, 0, 0.15);
        }
        .ambient-glow-vignette {
          background: radial-gradient(ellipse 80% 70% at 50% 45%, rgba(0, 0, 0, 0.12) 0%, transparent 75%);
        }
        @media (prefers-color-scheme: dark) {
          .ambient-glow-orb {
            background-color: rgba(255, 255, 255, 0.03);
          }
          .ambient-glow-vignette {
            background: radial-gradient(ellipse 75% 65% at 50% 45%, rgba(255, 255, 255, 0.02) 0%, transparent 70%);
          }
        }
        :root[data-color-scheme="dark"] .ambient-glow-orb,
        html[data-color-scheme="dark"] .ambient-glow-orb {
          background-color: rgba(255, 255, 255, 0.03) !important;
        }
        :root[data-color-scheme="dark"] .ambient-glow-vignette,
        html[data-color-scheme="dark"] .ambient-glow-vignette {
          background: radial-gradient(ellipse 75% 65% at 50% 45%, rgba(255, 255, 255, 0.02) 0%, transparent 70%) !important;
        }
        :root[data-color-scheme="light"] .ambient-glow-orb,
        html[data-color-scheme="light"] .ambient-glow-orb {
          background-color: rgba(0, 0, 0, 0.15) !important;
        }
        :root[data-color-scheme="light"] .ambient-glow-vignette,
        html[data-color-scheme="light"] .ambient-glow-vignette {
          background: radial-gradient(ellipse 80% 70% at 50% 45%, rgba(0, 0, 0, 0.12) 0%, transparent 75%) !important;
        }
      `}</style>

      {/* Main Hero Container */}
      <div class="relative z-10 flex w-full max-w-[720px] flex-col items-center gap-7 py-6">
        {/* Brand Header */}
        <div class="flex flex-col items-center text-center">
          <div class="mb-3.5 flex items-center justify-center">
            <WordmarkV2 animated opacity={0.85} class="h-8 w-auto text-v2-text-text-base opacity-90 transition-opacity hover:opacity-100" />
          </div>
          <h1 class="text-xl font-semibold tracking-tight text-v2-text-text-base sm:text-2xl">
            {greeting()}
          </h1>
        </div>

        {/* Prompt Input Box */}
        <div class="relative w-full">
          {/* Mascot sitting/peeking at the selected location top-right of prompt input box */}
          <div class="absolute -top-16 right-1 sm:-top-20 sm:right-2 md:-top-24 md:right-4 z-20 select-none flex flex-col items-center group pointer-events-none">
            <img
              src="/mascort.gif"
              alt="OpenCode Mascot"
              class="h-16 sm:h-20 md:h-24 w-auto object-contain transition-transform duration-300 group-hover:scale-110 mascot-float"
            />
          </div>
          {props.children}
        </div>

        {/* Dynamic Hybrid Action Cards (Recent Projects / Sessions + Prompt Suggestions) */}
        <div class="grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
          <For each={hybridCards()}>
            {(card) => (
              <button
                type="button"
                class="group flex items-start gap-3 rounded-xl border border-v2-border-border-muted/50 bg-v2-background-bg-layer-01/80 p-3 text-left backdrop-blur-md shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-v2-icon-icon-accent/40 hover:bg-v2-background-bg-layer-01 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-icon-icon-accent/50"
                onClick={() => handleCardClick(card)}
              >
                <div class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-v2-background-bg-layer-02 text-v2-icon-icon-accent transition-colors group-hover:bg-v2-icon-icon-accent/15">
                  <IconV2 name={card.icon as any} size="small" />
                </div>
                <div class="flex flex-col gap-0.5 min-w-0">
                  <span class="text-xs font-semibold text-v2-text-text-base group-hover:text-v2-text-text-accent transition-colors truncate">
                    {card.title}
                  </span>
                  <span class="text-[11px] leading-tight text-v2-text-text-muted truncate">
                    {card.desc}
                  </span>
                </div>
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
