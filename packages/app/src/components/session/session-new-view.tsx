import { For, Show, createMemo, createResource } from "solid-js"
import { DateTime } from "luxon"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { Icon } from "@opencode-ai/ui/icon"
import { Mark } from "@opencode-ai/ui/logo"
import { getDirectory, getFilename } from "@opencode-ai/util/path"

type Stack = "react" | "vue" | "svelte" | "angular" | "next" | "go" | "python" | "rust" | "php" | "java" | "unknown"

const STACK_PROMPTS: Record<Stack, string[]> = {
  next: [
    "Add a loading skeleton to the home page",
    "Create a new API route with validation",
    "Write tests for the authentication flow",
  ],
  react: [
    "Add error boundaries to the main layout",
    "Refactor a component to use custom hooks",
    "Write unit tests for the largest component",
  ],
  vue: [
    "Add a composable for the most-used logic",
    "Convert an options API component to composition API",
    "Add Pinia state for the user session",
  ],
  svelte: [
    "Add a Svelte store for shared state",
    "Convert a component to use reactive declarations",
    "Write tests for the main page component",
  ],
  angular: [
    "Add a new feature module with lazy loading",
    "Create a shared service for API calls",
    "Add form validation to the main form",
  ],
  go: [
    "Write a benchmark for the main HTTP handler",
    "Add structured logging with slog",
    "Write table-driven tests for the core package",
  ],
  python: [
    "Add type hints to the main module",
    "Write pytest tests for the core functions",
    "Refactor to use dataclasses or Pydantic models",
  ],
  rust: [
    "Add error handling with thiserror",
    "Write unit tests for the core module",
    "Refactor to reduce clone() calls",
  ],
  php: [
    "Add input validation to the main controller",
    "Write PHPUnit tests for the service layer",
    "Refactor to use dependency injection",
  ],
  java: [
    "Add unit tests with JUnit 5 for the service layer",
    "Refactor to use the builder pattern",
    "Add input validation to the REST controller",
  ],
  unknown: [
    "Explain the architecture of this codebase",
    "Find and fix any TODO comments",
    "Write tests for the most critical code path",
  ],
}

const MANIFEST_STACK: [string, Stack][] = [
  ["next.config", "next"],
  ["svelte.config", "svelte"],
  ["angular.json", "angular"],
  ["vue.config", "vue"],
  ["go.mod", "go"],
  ["Cargo.toml", "rust"],
  ["pyproject.toml", "python"],
  ["requirements.txt", "python"],
  ["composer.json", "php"],
  ["pom.xml", "java"],
  ["build.gradle", "java"],
  ["package.json", "react"],
]

async function detectStack(sdk: ReturnType<typeof useSDK>): Promise<Stack> {
  try {
    const result = await sdk.client.file.list({ path: sdk.directory })
    const names = (result.data ?? []).map((f) => f.name ?? "")
    for (const [manifest, stack] of MANIFEST_STACK) {
      if (names.some((n) => n.startsWith(manifest))) return stack
    }
  } catch {}
  return "unknown"
}

const MAIN_WORKTREE = "main"
const CREATE_WORKTREE = "create"
const ROOT_CLASS = "size-full flex flex-col"

interface NewSessionViewProps {
  worktree: string
}

export function NewSessionView(props: NewSessionViewProps) {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()

  const [stack] = createResource(() => sdk.directory, () => detectStack(sdk))
  const suggestions = createMemo(() => STACK_PROMPTS[stack() ?? "unknown"])

  const sandboxes = createMemo(() => sync.project?.sandboxes ?? [])
  const options = createMemo(() => [MAIN_WORKTREE, ...sandboxes(), CREATE_WORKTREE])
  const current = createMemo(() => {
    const selection = props.worktree
    if (options().includes(selection)) return selection
    return MAIN_WORKTREE
  })
  const projectRoot = createMemo(() => sync.project?.worktree ?? sdk.directory)
  const isWorktree = createMemo(() => {
    const project = sync.project
    if (!project) return false
    return sdk.directory !== project.worktree
  })

  const label = (value: string) => {
    if (value === MAIN_WORKTREE) {
      if (isWorktree()) return language.t("session.new.worktree.main")
      const branch = sync.data.vcs?.branch
      if (branch) return language.t("session.new.worktree.mainWithBranch", { branch })
      return language.t("session.new.worktree.main")
    }

    if (value === CREATE_WORKTREE) return language.t("session.new.worktree.create")

    return getFilename(value)
  }

  return (
    <div class={ROOT_CLASS}>
      <div class="h-12 shrink-0" aria-hidden />
      <div class="flex-1 px-6 pb-30 flex items-center justify-center text-center">
        <div class="w-full max-w-200 flex flex-col items-center text-center gap-4">
          <div class="flex flex-col items-center gap-6">
            <Mark class="w-10" />
            <div class="text-20-medium text-text-strong">{language.t("session.new.title")}</div>
          </div>
          <div class="w-full flex flex-col gap-4 items-center">
            <div class="flex items-start justify-center gap-3 min-h-5">
              <div class="text-12-medium text-text-weak select-text leading-5 min-w-0 max-w-160 break-words text-center">
                {getDirectory(projectRoot())}
                <span class="text-text-strong">{getFilename(projectRoot())}</span>
              </div>
            </div>
            <div class="flex items-start justify-center gap-1.5 min-h-5">
              <Icon name="branch" size="small" class="mt-0.5 shrink-0" />
              <div class="text-12-medium text-text-weak select-text leading-5 min-w-0 max-w-160 break-words text-center">
                {label(current())}
              </div>
            </div>
            <Show when={sync.project}>
              {(project) => (
                <div class="flex items-start justify-center gap-3 min-h-5">
                  <div class="text-12-medium text-text-weak leading-5 min-w-0 max-w-160 break-words text-center">
                    {language.t("session.new.lastModified")}&nbsp;
                    <span class="text-text-strong">
                      {DateTime.fromMillis(project().time.updated ?? project().time.created)
                        .setLocale(language.intl())
                        .toRelative()}
                    </span>
                  </div>
                </div>
              )}
            </Show>
          </div>
          <Show when={suggestions().length > 0}>
            <div class="flex flex-col items-center gap-2 mt-2">
              <For each={suggestions()}>
                {(prompt) => (
                  <button
                    data-slot="session-new-suggestion"
                    class="text-12-regular text-text-weak hover:text-text-strong border border-border-weak-base rounded-lg px-4 py-2 w-full max-w-xs text-center transition-colors hover:bg-surface-raised-base-hover cursor-pointer"
                    onClick={() => {
                      const el = document.querySelector<HTMLElement>("[data-component='prompt-input'] [contenteditable]")
                      if (!el) return
                      el.focus()
                      document.execCommand("insertText", false, prompt)
                    }}
                  >
                    {prompt}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
