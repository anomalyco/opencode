import { For, type JSX } from "solid-js"
import { WordmarkV2 } from "@opencode-ai/ui/v2/wordmark-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { usePrompt } from "@/context/prompt"

const QUICK_ACTIONS = [
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
] as const

export function NewSessionDesignView(props: { children: JSX.Element }) {
  const prompt = usePrompt()

  function applyAction(text: string) {
    if (!prompt || !prompt.ready()) return
    prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
  }

  return (
    <div
      data-component="session-new-design"
      class="relative size-full overflow-y-auto overflow-x-hidden bg-v2-background-bg-deep text-v2-text-text-base flex flex-col items-center justify-center p-6 select-none"
    >
      {/* Ambient Radial Accent Glow */}
      <div class="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        <div class="size-[550px] rounded-full bg-v2-icon-icon-accent/8 blur-[130px]" />
        <div class="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_45%,transparent_20%,var(--v2-background-bg-deep)_100%)]" />
      </div>

      {/* Main Hero Container */}
      <div class="relative z-10 flex w-full max-w-[720px] flex-col items-center gap-7 py-6">
        {/* Brand Header */}
        <div class="flex flex-col items-center text-center">
          <div class="mb-3.5 flex items-center justify-center">
            <WordmarkV2 opacity={0.8} class="h-8 w-auto text-v2-text-text-base opacity-90 transition-opacity hover:opacity-100" />
          </div>
          <h1 class="text-xl font-semibold tracking-tight text-v2-text-text-base sm:text-2xl">
            What would you like to build?
          </h1>
          <p class="mt-1 text-xs text-v2-text-text-muted sm:text-sm">
            Ask anything, reference files with <code class="rounded bg-v2-background-bg-layer-02 px-1.5 py-0.5 font-mono text-[11px] text-v2-text-text-base border border-v2-border-border-muted/40">@</code>, or type <code class="rounded bg-v2-background-bg-layer-02 px-1.5 py-0.5 font-mono text-[11px] text-v2-text-text-base border border-v2-border-border-muted/40">/</code> for commands
          </p>
        </div>

        {/* Prompt Input Box */}
        <div class="w-full">
          {props.children}
        </div>

        {/* Quick Action Suggestion Cards */}
        <div class="grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
          <For each={QUICK_ACTIONS}>
            {(action) => (
              <button
                type="button"
                class="group flex items-start gap-3 rounded-xl border border-v2-border-border-muted/50 bg-v2-background-bg-layer-01/60 p-3 text-left backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:border-v2-icon-icon-accent/40 hover:bg-v2-background-bg-layer-01 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-icon-icon-accent/50"
                onClick={() => applyAction(action.prompt)}
              >
                <div class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-v2-background-bg-layer-02 text-v2-icon-icon-accent transition-colors group-hover:bg-v2-icon-icon-accent/15">
                  <IconV2 name={action.icon as any} size="small" />
                </div>
                <div class="flex flex-col gap-0.5 min-w-0">
                  <span class="text-xs font-semibold text-v2-text-text-base group-hover:text-v2-text-text-accent transition-colors">
                    {action.title}
                  </span>
                  <span class="text-[11px] leading-tight text-v2-text-text-muted truncate">
                    {action.desc}
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
