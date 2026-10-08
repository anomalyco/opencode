import { createMemo, createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createTwoFilesPatch } from "diff"
import { CurrentSessionProviders } from "../storybook/current-session-story"
import { storyDocument, storyTool } from "../storybook/current-session-scenarios"
import { type ContextGroupPart, CurrentContextToolGroup } from "./tool-renderer"

export default {
  title: "OpenCode/Work/Tool group",
  id: "current-tool-group",
  component: CurrentContextToolGroup,
}

export const MixedTools = {
  render: () => {
    const [open, setOpen] = createSignal(true)

    const tools = [
      storyTool(
        "group_shell",
        "shell",
        "completed",
        { command: "printf 'group geometry'" },
        { output: "group geometry" },
      ),
      storyTool("group_read", "read", "completed", { path: "src/group.ts" }),
      storyTool("group_general", "subagent", "completed", { agent: "general", description: "Inspect grouped tools" }),
      storyTool("group_explore", "subagent", "completed", { agent: "explore", description: "Check card geometry" }),
    ]

    return (
      <section style={{ width: "100%", "max-width": "720px", padding: "24px" }}>
        <CurrentSessionProviders document={storyDocument(tools)}>
          <CurrentContextToolGroup parts={tools} busy={false} open={open()} onOpenChange={setOpen} />
        </CurrentSessionProviders>
      </section>
    )
  },
}

export const NoticesOnly = {
  render: () => {
    const [open, setOpen] = createStore({ tools: false, notices: false })
    const tools = [storyTool("notice_read", "read", "completed", { path: "AGENTS.md" })]

    return (
      <section class="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-6">
        <CurrentSessionProviders document={storyDocument(tools)}>
          <CurrentContextToolGroup
            parts={tools}
            busy={false}
            open={open.tools}
            onOpenChange={(value) => setOpen("tools", value)}
          />
          <CurrentContextToolGroup
            parts={[
              { type: "notice", id: "notice_instructions", render: () => <p>Instructions updated: AGENTS.md</p> },
            ]}
            busy={false}
            open={open.notices}
            onOpenChange={(value) => setOpen("notices", value)}
          />
        </CurrentSessionProviders>
      </section>
    )
  },
}

export const MixedReasoning = {
  args: { reasoningDefaultOpen: false },
  render: (args: { reasoningDefaultOpen: boolean }) => {
    const [open, setOpen] = createSignal(true)
    const [appended, setAppended] = createSignal(false)

    const parts = createMemo<ContextGroupPart[]>(() => [
      storyTool("reasoning_read", "read", "completed", { path: "src/group.ts" }),
      {
        type: "reasoning",
        id: "reasoning_first",
        text: "The renderer groups adjacent tools. Check the relevant skills before changing it.",
      },
      storyTool("reasoning_skill_first", "skill", "completed", { id: "opencode" }),
      storyTool("reasoning_skill_second", "skill", "completed", { id: "frontend-design" }),
      {
        type: "reasoning",
        id: "reasoning_second",
        text: "Keep these skill groups separate so the reasoning stays in chronological order.",
      },
      storyTool("reasoning_skill_third", "skill", "completed", { id: "rtl-aware-development" }),
      ...(appended() ? [storyTool("reasoning_read_next", "read", "completed", { path: "src/group.test.ts" })] : []),
    ])

    return (
      <section class="mx-auto flex w-full max-w-[860px] flex-col gap-4 p-6">
        <button type="button" onClick={() => setAppended((value) => !value)}>
          {appended() ? "Remove follow-up read" : "Append follow-up read"}
        </button>
        <CurrentSessionProviders document={storyDocument(parts())}>
          <CurrentContextToolGroup
            parts={parts()}
            busy={false}
            open={open()}
            onOpenChange={setOpen}
            reasoningDefaultOpen={args.reasoningDefaultOpen}
          />
        </CurrentSessionProviders>
      </section>
    )
  },
}

// Mirrors a long exploration turn in a timeline viewport with the session title header above it.
const stickyCommands = [
  "git log --oneline 09c318094c..upstream/v2 -- packages/tui/src/plugin/structure.ts packages/tui/src/plugin/render.tsx",
  "git log --oneline 09c318094c..upstream/v2 -- packages/tui/src/plugin/structure.ts; git diff --stat upstream/v2",
  'git log --format="%h %s" 09c318094c..upstream/v2 -- packages/app/src/runtime/persistence',
  'git log --format="%h %s" 09c318094c..upstream/v2 -- packages/app/src/session/review packages/app/src/session/files',
  'git show 09c318094c:packages/app/src/session/review/model.ts | Select-String "ChangeMode ="',
  "git show 09c318094c:packages/app/src/session/review/model.ts | Select-String -Pattern 'turn' -Context 0,0",
]

const stickySource = (lines: number, changed: boolean) =>
  Array.from(
    { length: lines },
    (_, index) => `export const value${index} = ${changed && index % 3 === 0 ? index + 1 : index}\n`,
  ).join("")

const stickyParts: ContextGroupPart[] = [
  storyTool("sticky_write", "write", "completed", { path: "graph.js", content: stickySource(137, false) }),
  ...Array.from({ length: 36 }, (_, index): ContextGroupPart[] => [
    {
      type: "reasoning",
      id: `sticky_thought_${index}`,
      text: "Check which commits touched the review model before rebasing the stack.",
      time: { created: 0, completed: ((index * 7) % 5) * 1000 + 1000 },
    },
    index === 18
      ? storyTool(
          "sticky_edit",
          "edit",
          "completed",
          {
            path: "src/session/review/model.ts",
            oldString: stickySource(24, false),
            newString: stickySource(24, true),
          },
          {},
        )
      : index % 6 === 5
        ? storyTool(
            `sticky_grep_${index}`,
            "grep",
            "completed",
            { path: "C:/tmp/opencode/stack/packages/plugin-review-desktop/", pattern: 'turn"|lastTurn|session\\.diff' },
            { metadata: { matches: 4 } },
          )
        : storyTool(
            `sticky_shell_${index}`,
            "shell",
            "completed",
            { command: stickyCommands[index % stickyCommands.length]! },
            { output: "ok" },
          ),
  ]).flat(),
]

export const StickyHeader = {
  args: { height: 720 },
  argTypes: { height: { control: { type: "range", min: 320, max: 1200, step: 20 } } },
  render: (args: { height: number }) => {
    const [state, setState] = createStore({ open: true, files: {} as Record<string, boolean> })

    return (
      <section
        data-story="sticky-header-scroll"
        class="relative w-full max-w-[1030px] overflow-y-auto bg-v2-background-bg-base"
        style={{ height: `${args.height}px`, "--sticky-accordion-top": "48px" }}
      >
        <div class="pointer-events-none sticky top-0 z-30 w-full pb-4">
          <div class="pointer-events-auto bg-v2-background-bg-base pe-3 ps-2.5">
            <div class="flex h-12 items-center px-1 text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base">
              Trace stacked review history
            </div>
          </div>
        </div>
        <div class="pointer-events-none sticky top-12 z-[5] -mt-4 h-4 w-full bg-[linear-gradient(to_bottom,var(--v2-background-bg-base),transparent)]" />
        <div class="px-6" style={{ "padding-bottom": `${args.height}px` }}>
          <CurrentSessionProviders document={storyDocument(stickyParts.filter((part) => part.type === "tool"))}>
            <CurrentContextToolGroup
              parts={stickyParts}
              busy={false}
              open={state.open}
              onOpenChange={(open) => setState("open", open)}
              fileOpen={(path) => state.files[path] ?? path.endsWith("model.ts")}
              onFileOpenChange={(path, open) => setState("files", path, open)}
            />
          </CurrentSessionProviders>
        </div>
      </section>
    )
  },
}

export const PatchFollowUps = {
  args: { separator: "none" },
  argTypes: { separator: { control: "select", options: ["none", "shell", "error", "reasoning"] } },
  render: (args: { separator: string }) => {
    const [state, setState] = createStore({ phase: "initial", open: true, reasoning: true })

    const file = (path: string, before: number, after: number) => ({
      file: path,
      status: "modified",
      additions: 1,
      deletions: 1,
      patch: createTwoFilesPatch(
        path,
        path,
        `export const value = ${before}\n`,
        `export const value = ${after}\n`,
        "",
        "",
        { context: Infinity },
      ),
    })

    const parts = createMemo<ContextGroupPart[]>(() => [
      storyTool("patch_shell", "shell", "completed", { command: "printf checked" }, { output: "checked" }),
      storyTool(
        "patch_first",
        "patch",
        "completed",
        {},
        {
          metadata: { files: [file("src/a.ts", 0, 1), file("src/b.ts", 0, 1)] },
        },
      ),
      ...(state.phase === "initial"
        ? []
        : [
            ...(args.separator === "shell"
              ? [storyTool("patch_separator", "shell", "completed", { command: "printf checked" })]
              : []),
            ...(args.separator === "error"
              ? [storyTool("patch_error", "patch", "error", {}, { error: "Patch failed" })]
              : []),
            ...(args.separator === "reasoning" && state.reasoning
              ? [
                  {
                    type: "reasoning" as const,
                    id: "patch_reasoning",
                    text: "The first patch is ready. Now update the remaining files.",
                  },
                ]
              : []),
            storyTool(
              "patch_next",
              "patch",
              state.phase === "running" ? "running" : "completed",
              {},
              {
                metadata: state.phase === "running" ? {} : { files: [file("src/a.ts", 1, 2), file("src/c.ts", 0, 1)] },
              },
            ),
          ]),
    ])

    return (
      <section class="mx-auto flex w-full max-w-[860px] flex-col gap-4 p-6">
        <div class="flex flex-wrap gap-3">
          <button type="button" onClick={() => setState("phase", "running")}>
            Start follow-up patch
          </button>
          <button type="button" onClick={() => setState("phase", "completed")}>
            Finish follow-up patch
          </button>
          <Show when={args.separator === "reasoning"}>
            <button type="button" onClick={() => setState("reasoning", (value) => !value)}>
              {state.reasoning ? "Hide thoughts" : "Show thoughts"}
            </button>
          </Show>
        </div>
        <CurrentSessionProviders document={storyDocument(parts())}>
          <CurrentContextToolGroup
            parts={parts()}
            busy={state.phase === "running"}
            open={state.open}
            onOpenChange={(open) => setState("open", open)}
          />
        </CurrentSessionProviders>
      </section>
    )
  },
}
