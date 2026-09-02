import type { FileContents } from "@pierre/diffs"
import { useTheme } from "@opencode-ai/ui/theme"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { FileEditor } from "./file-editor"

const fixture: FileContents = {
  name: "src/greeting.ts",
  contents: 'export const greeting = "Hello"\nexport const message = "Hello again"\n',
}

function EditorStory(props: { narrow?: boolean; empty?: boolean; large?: boolean }) {
  const theme = useTheme()
  const initial = props.large
    ? {
        name: "src/large.ts",
        contents: `// ${"unchanged ".repeat(7)}\n`.repeat(8_000) + 'export const finalLine = "end"',
      }
    : props.empty
      ? { ...fixture, contents: "" }
      : fixture
  const [mounted, setMounted] = createSignal(true)
  const [contents, setContents] = createSignal(initial.contents)
  const [changes, setChanges] = createSignal(0)
  const [navigation, setNavigation] = createSignal(0)
  const [error, setError] = createSignal("")

  onMount(() => {
    const navigate = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") setNavigation((value) => value + 1)
    }
    document.addEventListener("keydown", navigate)
    onCleanup(() => document.removeEventListener("keydown", navigate))
  })

  return (
    <div class="mx-auto flex min-h-screen w-full max-w-[960px] flex-col gap-4 bg-background-base p-4">
      <div class="flex flex-wrap items-center gap-4">
        <button type="button" onClick={() => setMounted((value) => !value)}>
          {mounted() ? "Unmount editor" : "Mount editor"}
        </button>
        <button type="button" onClick={() => theme.setColorScheme(theme.mode() === "dark" ? "light" : "dark")}>
          Toggle theme
        </button>
        <span data-testid="editor-changes">Changes: {changes()}</span>
        <span data-testid="editor-navigation">Navigation: {navigation()}</span>
        <span>
          Characters: <span data-testid="editor-size">{contents().length}</span>
        </span>
      </div>
      <p>Local fixture only. Type, undo, redo, or use Ctrl/Cmd+F and Ctrl/Cmd+Alt+F to find and replace.</p>
      <div
        class="max-h-[60vh] min-h-40 w-full overflow-auto border border-border-base"
        style={{ "max-width": props.narrow ? "320px" : undefined }}
      >
        <Show when={mounted()}>
          <FileEditor
            file={initial}
            onChange={(value) => {
              setContents(value)
              setChanges((count) => count + 1)
            }}
            onError={(value) => setError(String(value))}
          />
        </Show>
      </div>
      <pre data-testid="editor-contents" dir="ltr" class="whitespace-pre-wrap break-all text-12-regular">
        {props.large ? contents().slice(-200) : contents()}
      </pre>
      <output data-testid="editor-error">{error()}</output>
    </div>
  )
}

export default {
  title: "OpenCode/Review/File editor",
  id: "components-file-editor",
  component: FileEditor,
  parameters: { layout: "fullscreen" },
}

export const Default = {
  args: { narrow: false, empty: false },
  render: (args: { narrow: boolean; empty: boolean }) => <EditorStory {...args} />,
}

export const Dark = {
  globals: { theme: "dark" },
  render: () => <EditorStory />,
}

export const NarrowRtl = {
  globals: { direction: "rtl" },
  render: () => <EditorStory narrow />,
}

export const Large = {
  render: () => <EditorStory large />,
}
