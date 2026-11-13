import { createEffect, createSignal, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createComposerEditor } from "@/composer/editor/interaction"
import type { ComposerPersistedState } from "@/composer/types"
import {
  DialogStoryRuntime,
  STORY_DIRECTORY,
  STORY_PROJECTS,
  STORY_SERVER,
} from "@/components-lab/dialog-story-runtime"
import { useLocal } from "@/providers/models/selection"
import { useLanguage } from "@/runtime/i18n/language"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { LocationProvider } from "@/workspaces/location"
import { useNewSessionLocationDialog } from "./location/dialog"
import { createPromptProjectController, type PromptProject } from "./project/selector"
import { NewSessionView } from "./view"
import { createNewSessionWorkspaceController } from "./workspace/controller"

const locations = ["main", "existing worktree", "checkout loading", "detached HEAD", "no project"] as const

type DraftArgs = { location: (typeof locations)[number]; prompt: string }

const projects = STORY_PROJECTS.map((project) => ({
  ...project,
  used: true,
  worktrees: project.sandboxes.map((directory) => ({ directory, strategy: "git" })),
}))

function DraftStory(props: DraftArgs) {
  const [directory, setDirectory] = createSignal(STORY_DIRECTORY)

  return (
    <LocationProvider directory={directory()}>
      <DraftLanding {...props} directory={directory()} setDirectory={setDirectory} />
    </LocationProvider>
  )
}

function DraftLanding(props: DraftArgs & { directory: string; setDirectory: (directory: string) => void }) {
  const language = useLanguage()

  const local = useLocal()

  const pickDirectory = useDirectoryPicker()

  const [state, setState] = createStore<{
    available: PromptProject[]
    worktree?: string
    branch?: string
    location: DraftArgs["location"]
    activity: string
    agent: string
  }>({ available: projects, location: props.location, activity: "", agent: "build" })

  const select = (directory: string, _server?: string, workspace = "main") => {
    props.setDirectory(directory)
    setState({ worktree: workspace, branch: undefined, location: "main" })
  }

  createEffect(
    on(
      () => props.location,
      (value) => {
        props.setDirectory(STORY_DIRECTORY)
        setState({
          location: value,
          available: value === "no project" ? [] : projects,
          worktree: value === "existing worktree" ? STORY_PROJECTS[0].sandboxes[0] : "main",
          branch: undefined,
          activity: "",
        })
      },
    ),
  )

  const project = createPromptProjectController({
    controls: () => ({
      available: state.available,
      directory: props.directory,
      select,
      add: (title) =>
        pickDirectory({
          server: STORY_SERVER,
          location: { directory: STORY_DIRECTORY },
          title,
          onSelect: (result) => {
            const directory = Array.isArray(result) ? result[0] : result

            if (!directory) return

            if (!state.available.some((item) => item.worktree === directory)) {
              setState("available", (items) => [
                ...items,
                projects.find((item) => item.worktree === directory) ?? { worktree: directory, used: true },
              ])
            }

            select(directory)
          },
        }),
    }),
  })

  const checkout = createNewSessionWorkspaceController({
    selectedWorktree: () => state.worktree,
    selectedBranch: () => state.branch,
    setSelectedWorktree: (next) => setState({ worktree: next, location: "main" }),
    setSelectedBranch: (branch) => setState("branch", branch),
  })

  const workspace = {
    ...checkout,
    project: { ...checkout.project, root: () => project.selected()?.worktree ?? props.directory },
    bar: {
      ...checkout.bar,
      branch: () =>
        state.location === "checkout loading" || state.location === "detached HEAD" ? undefined : checkout.bar.branch(),
      checkout: () => {
        if (state.location === "checkout loading") return

        if (state.location === "detached HEAD") return { branch: undefined }

        return checkout.bar.checkout()
      },
    },
  }

  const draft = createStore<ComposerPersistedState>({
    prompt: [],
    cursor: 0,
    context: { items: [] },
  })

  const setPrompt = (text: string) =>
    draft[1]({ prompt: [{ type: "text", content: text, start: 0, end: text.length }], cursor: text.length })

  createEffect(on(() => props.prompt, setPrompt))

  const editor = createComposerEditor({
    store: draft,
    commands: () => [],
    context: () => [],
    searchContextFiles: () => [],
    view: {
      placeholder: () => language.t("ui.promptInput.placeholder.normal", { slash: "/", at: "@" }),
      agent: {
        options: () => local.agent.list().map((agent) => ({ id: agent.name, label: agent.name })),
        current: () => state.agent,
        onSelect: (agent) => setState("agent", agent),
      },
      variant: {
        options: () => local.model.variant.list().map((id) => ({ id, label: id })),
        current: () => local.model.variant.current() ?? "default",
        onSelect: local.model.variant.set,
      },
      submit: {
        stopping: () => false,
        onStop() {},
        onSubmit: () => {
          setState("activity", `Submitted locally: ${editor.value()}`)
          setPrompt("")
        },
      },
    },
  })

  const composer = { ...editor, model: { selection: local.model, paid: true, loading: false } }

  const openLocation = useNewSessionLocationDialog({ project, workspace, onDone: editor.restoreFocus })

  return (
    <div class="relative flex h-dvh w-full flex-col bg-v2-background-bg-deep p-2">
      <NewSessionView composer={composer} project={project} workspace={workspace} location={openLocation} />
      <Show when={state.activity}>
        <output class="absolute inset-x-4 bottom-4 text-center text-12-regular text-text-weak">{state.activity}</output>
      </Show>
    </div>
  )
}

export default {
  title: "App/New Session/Draft landing",
  id: "app-new-session-draft",
  parameters: { layout: "fullscreen" },
  args: { location: "main", prompt: "" },
  argTypes: { location: { control: "select", options: locations }, prompt: { control: "text" } },
  render: (args: DraftArgs) => (
    <DialogStoryRuntime>
      <DraftStory {...args} />
    </DialogStoryRuntime>
  ),
}

export const MainCheckout = {}

export const PreparedPrompt = { args: { prompt: "Review the recent changes to session search." } }

export const ExistingWorktree = { args: { location: "existing worktree" } }

export const CheckoutLoading = { args: { location: "checkout loading" } }

export const DetachedHead = { args: { location: "detached HEAD" } }

export const NoProject = { args: { location: "no project" } }
