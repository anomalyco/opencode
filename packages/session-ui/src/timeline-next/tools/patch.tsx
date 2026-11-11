import { useFileComponent } from "@opencode/ui/context/file"
import { useI18n } from "@opencode/ui/context/i18n"
import { DiffChanges } from "@opencode/ui/diff-changes"
import { FileIcon } from "@opencode/ui/file-icon"
import { Icon } from "@opencode/ui/icon"
import { getFilename } from "@opencode/util/path"
import { batch, createMemo, createUniqueId, For, Index, Match, Show, Switch, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import { patchFileGroups } from "../../components/apply-patch-file"
import { createDisclosure } from "../../components/disclosure"
import { displayDirectory, FileAccordionGroup, FileTool, type ToolProps } from "../../tools/tool-renderer"

// One unchanged line around each change places it without a wall of context.
const context = 1

/**
 * A file change: each file says what happened to it beside its name, in the change colors, and opens to its whole diff.
 * A diff here is read, not acted on line by line, so its lines stay still.
 */
export function PatchTool(props: ToolProps) {
  const i18n = useI18n()
  const fileComponent = useFileComponent()

  const files = createMemo(
    () =>
      props.pendingFiles?.map((path) => ({
        path,
        type: "update" as const,
        additions: 0,
        deletions: 0,
        views: [],
      })) ?? patchFileGroups(props.metadata.files, context),
  )

  const title = createMemo(() => {
    if (props.tool === "edit") return i18n.t("ui.messagePart.title.edit")

    if (props.tool === "write") return i18n.t("ui.messagePart.title.write")

    return i18n.t("ui.tool.patch")
  })

  return (
    <div data-component="apply-patch-tool">
      <Show when={files().length > 0} fallback={<FileTool {...props} title={title()} count={0} />}>
        <FileAccordionGroup>
          <Index each={files()}>
            {(file) => {
              // Each file opens on its own: the owner's `fileOpen` controls it, otherwise it keeps its own state.
              const disclosure = createDisclosure({
                open: () => (props.fileOpen ? props.fileOpen(file().path) === true : undefined),
                defer: () => props.deferContent !== false,
                onOpenChange: (open) => props.onFileOpenChange?.(file().path, open),
              })

              const views = () => (
                <For each={file().views}>
                  {(view) => (
                    <div data-component="apply-patch-file-diff">
                      <Dynamic
                        component={fileComponent}
                        mode="diff"
                        virtualize={props.virtualizeDiff}
                        fileDiff={view.fileDiff}
                        hunkSeparators={view.fileDiff.isPartial ? "simple" : "line-info-basic"}
                        onRendered={props.onContentRendered}
                        lineHoverHighlight="disabled"
                      />
                    </div>
                  )}
                </For>
              )

              return (
                <FileAccordionItem
                  open={disclosure.open()}
                  onOpenChange={disclosure.setOpen}
                  type={file().type}
                  header={
                    <div data-slot="apply-patch-trigger-content">
                      <div data-slot="apply-patch-file-info">
                        <FileIcon node={{ path: file().path, type: "file" }} />
                        <div data-slot="apply-patch-file-name-container">
                          <Show when={file().path.includes("/")}>
                            <span data-slot="apply-patch-directory">{`\u202A${displayDirectory(file().path)}\u202C`}</span>
                          </Show>
                          <span data-slot="apply-patch-filename">{getFilename(file().path)}</span>
                        </div>
                        <Switch>
                          <Match when={file().type === "add"}>
                            <span data-component="diff-changes" data-appearance="standard">
                              <span data-slot="diff-changes-additions">{i18n.t("ui.patch.action.created")}</span>
                            </span>
                          </Match>
                          <Match when={file().type === "delete"}>
                            <span data-component="diff-changes" data-appearance="standard">
                              <span data-slot="diff-changes-deletions">{i18n.t("ui.patch.action.deleted")}</span>
                            </span>
                          </Match>
                          <Match when={true}>
                            <DiffChanges
                              appearance="standard"
                              markEmpty
                              changes={{ additions: file().additions, deletions: file().deletions }}
                            />
                          </Match>
                        </Switch>
                      </div>
                      <div data-slot="apply-patch-trigger-actions">
                        <Icon name="chevron-grabber-vertical" size="small" />
                      </div>
                    </div>
                  }
                >
                  <Show when={disclosure.mounted()}>{views()}</Show>
                </FileAccordionItem>
              )
            }}
          </Index>
        </FileAccordionGroup>
      </Show>
    </div>
  )
}

function FileAccordionItem(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  type?: string
  header: JSX.Element
  children: JSX.Element
}) {
  const id = createUniqueId()

  return (
    <div
      data-slot="accordion-item"
      data-type={props.type}
      data-expanded={props.open ? "" : undefined}
      data-closed={!props.open ? "" : undefined}
    >
      <h3
        data-slot="accordion-header"
        data-component="sticky-accordion-header"
        data-expanded={props.open ? "" : undefined}
        data-closed={!props.open ? "" : undefined}
      >
        <button
          type="button"
          id={`${id}-trigger`}
          data-slot="accordion-trigger"
          data-expanded={props.open ? "" : undefined}
          data-closed={!props.open ? "" : undefined}
          aria-expanded={props.open}
          aria-controls={props.open ? `${id}-content` : undefined}
          onClick={() => batch(() => props.onOpenChange(!props.open))}
        >
          {props.header}
        </button>
      </h3>
      <Show when={props.open}>
        <div
          id={`${id}-content`}
          role="region"
          aria-labelledby={`${id}-trigger`}
          data-slot="accordion-content"
          data-expanded=""
        >
          {props.children}
        </div>
      </Show>
    </div>
  )
}
