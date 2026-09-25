import { ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { Show, Switch, Match, createResource, createSignal, onCleanup } from "solid-js"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useProject } from "../context/project"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useBindings } from "../keymap"
import { filetype } from "../util/filetype"

type PreviewContent = { kind: "text"; text: string } | { kind: "binary" } | { kind: "error" } | { kind: "large" }

const MAX_PREVIEW_CHARS = 512 * 1024

export function DialogPreview() {
  const sdk = useSDK()
  const dialog = useDialog()
  const project = useProject()
  const [query, setQuery] = createSignal("")

  const [files] = createResource(
    () => ({ query: query() }),
    async (input) => {
      const result = await sdk.client.find.files({
        query: input.query,
        type: "file",
        limit: 50,
        workspace: project.workspace.current(),
      })
      if (result.error) return []
      return result.data ?? []
    },
  )

  return (
    <DialogSelect
      title="Preview file"
      placeholder="Search files"
      skipFilter
      options={(files.latest ?? []).map((value) => ({ title: value, value }))}
      onFilter={setQuery}
      onSelect={(option) => {
        dialog.replace(() => <DialogPreviewFile path={option.value} />)
      }}
    />
  )
}

export function DialogPreviewFile(props: { path: string }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const project = useProject()
  const { theme, syntax } = useTheme()
  const dimensions = useTerminalDimensions()

  dialog.setSize("xlarge")
  onCleanup(() => dialog.setSize("medium"))

  const [content] = createResource(
    () => ({ path: props.path, workspace: project.workspace.current() }),
    async (input): Promise<PreviewContent> => {
      const result = await sdk.client.file.read({ path: input.path, workspace: input.workspace })
      if (result.error) return { kind: "error" }
      if (result.data.type === "binary") return { kind: "binary" }
      if (result.data.content.length > MAX_PREVIEW_CHARS) return { kind: "large" }
      return { kind: "text", text: result.data.content }
    },
  )

  let scroll: ScrollBoxRenderable | undefined
  useBindings(() => ({
    bindings: [
      { key: "j,down", desc: "Scroll down", group: "Preview", cmd: () => scroll?.scrollBy(1) },
      { key: "k,up", desc: "Scroll up", group: "Preview", cmd: () => scroll?.scrollBy(-1) },
      { key: "pagedown", desc: "Page down", group: "Preview", cmd: () => scroll?.scrollBy(10) },
      { key: "pageup", desc: "Page up", group: "Preview", cmd: () => scroll?.scrollBy(-10) },
      { key: "g", desc: "Scroll to top", group: "Preview", cmd: () => scroll?.scrollTo(0) },
      {
        key: "shift+g",
        desc: "Scroll to bottom",
        group: "Preview",
        cmd: () => scroll?.scrollTo(Number.MAX_SAFE_INTEGER),
      },
    ],
  }))

  const isMarkdown = () => filetype(props.path) === "markdown"
  const text = () => {
    const item = content()
    return item?.kind === "text" ? item.text : undefined
  }

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4} flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {props.path}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Switch>
        <Match when={content.loading}>
          <box paddingLeft={4} paddingTop={1}>
            <text fg={theme.textMuted}>Loading...</text>
          </box>
        </Match>
        <Match when={content()?.kind === "error"}>
          <box paddingLeft={4} paddingTop={1}>
            <text fg={theme.textMuted}>Failed to load file</text>
          </box>
        </Match>
        <Match when={content()?.kind === "binary"}>
          <box paddingLeft={4} paddingTop={1}>
            <text fg={theme.textMuted}>Binary file — text preview not available</text>
          </box>
        </Match>
        <Match when={content()?.kind === "large"}>
          <box paddingLeft={4} paddingTop={1}>
            <text fg={theme.textMuted}>File too large to preview</text>
          </box>
        </Match>
        <Match when={text() !== undefined}>
          <scrollbox
            paddingLeft={1}
            paddingRight={3}
            scrollbarOptions={{ visible: false }}
            ref={(r: ScrollBoxRenderable) => (scroll = r)}
            maxHeight={Math.floor(dimensions().height * 0.55)}
          >
            <Show when={text()?.trim() === ""}>
              <box paddingLeft={3} paddingTop={1}>
                <text fg={theme.textMuted}>Empty file</text>
              </box>
            </Show>
            <Show
              when={isMarkdown()}
              fallback={
                <line_number fg={theme.textMuted} minWidth={4} paddingRight={1}>
                  <code
                    conceal={false}
                    fg={theme.text}
                    filetype={filetype(props.path)}
                    syntaxStyle={syntax()}
                    content={text() ?? ""}
                  />
                </line_number>
              }
            >
              <box paddingLeft={2}>
                <markdown
                  syntaxStyle={syntax()}
                  streaming={false}
                  internalBlockMode="top-level"
                  content={text() ?? ""}
                  tableOptions={{ style: "grid" }}
                  fg={theme.markdownText}
                  bg={theme.background}
                />
              </box>
            </Show>
          </scrollbox>
        </Match>
      </Switch>
    </box>
  )
}
