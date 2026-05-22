/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import { useBindings, useCommandShortcut } from "@tui/keymap"
import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import path from "path"
import { createEffect, createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { DiffViewerFileTree } from "./diff-viewer-file-tree"
import { Panel, PanelGroup, Separator } from "./diff-viewer-ui"
import { DialogSelect } from "@tui/ui/dialog-select"
import {
  allExpandedFileTreeDirectories,
  buildFileTree,
  fileTreeFileSelection,
  flattenFileTree,
  moveFileTreeSelection,
  moveFileTreeSelectionToFirstChild,
  moveFileTreeSelectionToFile,
  moveFileTreeSelectionToParent,
  movePatchFileIndex,
  orderedPatchFileIndexes,
  relativePatchFileIndexFromViewport,
  setFileTreeDirectoryExpanded,
  singlePatchFileIndex,
  toggleFileTreeDirectory,
} from "./diff-viewer-file-tree-utils"

const ROUTE = "diff"
const MIN_SPLIT_WIDTH = 100
const FILE_TREE_WIDTH = 32
const PLAIN_TEXT_FILETYPE = "opencode-plain-text"
type DiffMode = "git" | "last-turn"
type DiffViewerFocus = "patches" | "files"

type DiffFile = {
  readonly file: string
  readonly patch?: string
  readonly additions: number
  readonly deletions: number
  readonly status: "added" | "deleted" | "modified"
}

const normalizeDiffs = (diffs: readonly (VcsFileDiff | SnapshotFileDiff)[]): DiffFile[] =>
  diffs.flatMap((item) =>
    item.file
      ? [
          {
            file: item.file,
            patch: item.patch,
            additions: item.additions,
            deletions: item.deletions,
            status: item.status ?? "modified",
          } satisfies DiffFile,
        ]
      : [],
  )

function filetype(input?: string) {
  if (!input) return "none"
  const language = LANGUAGE_EXTENSIONS[path.extname(input)]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}

function DiffViewer(props: { api: TuiPluginApi }) {
  const dimensions = useTerminalDimensions()
  const themeState = useTheme()
  const theme = () => props.api.theme.current
  const params = () =>
    ("params" in props.api.route.current ? props.api.route.current.params : undefined) as
      | { mode?: DiffMode; sessionID?: string; messageID?: string }
      | undefined
  const mode = () => params()?.mode ?? "git"
  const diffInput = createMemo(() => ({
    mode: mode(),
    sessionID: params()?.sessionID,
    messageID: params()?.messageID,
  }))
  const [diff] = createResource(diffInput, async (input) => {
    if (input.mode === "last-turn") {
      const sessionID = input.sessionID
      if (!sessionID) return []
      const result = await props.api.client.session.diff(
        { sessionID, messageID: input.messageID },
        { throwOnError: true },
      )
      return normalizeDiffs(result.data ?? [])
    }

    const result = await props.api.client.vcs.diff({ mode: "git" }, { throwOnError: true })
    return normalizeDiffs(result.data ?? [])
  })
  const files = createMemo(() => diff() ?? [])
  const [focus, setFocus] = createSignal<DiffViewerFocus>("patches")
  const [showFileTree, setShowFileTree] = createSignal(true)
  const [singlePatch, setSinglePatch] = createSignal(false)
  const patchPaneWidth = createMemo(() => dimensions().width - (showFileTree() ? 33 : 0) - 4)
  const splitAvailable = createMemo(() => patchPaneWidth() >= MIN_SPLIT_WIDTH)
  const defaultView = createMemo(() => {
    if (props.api.tuiConfig.diff_style === "stacked") return "unified"
    return splitAvailable() ? "split" : "unified"
  })
  const [viewOverride, setViewOverride] = createSignal<"split" | "unified">()
  const view = createMemo(() => (splitAvailable() ? (viewOverride() ?? defaultView()) : "unified"))
  const fileTree = createMemo(() => buildFileTree(files()))
  const [expandedFileNodes, setExpandedFileNodes] = createSignal<ReadonlySet<number>>(new Set())
  const [highlightedFileNode, setHighlightedFileNode] = createSignal<number | undefined>()
  const [lastHighlightedFileNode, setLastHighlightedFileNode] = createSignal<number | undefined>()
  const [activePatchFileIndex, setActivePatchFileIndex] = createSignal<number | undefined>()
  const [selectedFileIndex, setSelectedFileIndex] = createSignal<number | undefined>()
  const [reviewedFileNames, setReviewedFileNames] = createSignal<ReadonlySet<string>>(new Set())
  const fileRows = createMemo(() => flattenFileTree(fileTree(), expandedFileNodes()))
  const patchFileIndexes = createMemo(() => orderedPatchFileIndexes(flattenFileTree(fileTree())))
  const focusRunner = (input: Record<DiffViewerFocus, () => void>) => () => input[focus()]()
  const switchFocusShortcut = useCommandShortcut("diff.switch_focus")
  const nextFileShortcut = useCommandShortcut("diff.next_file")
  const previousFileShortcut = useCommandShortcut("diff.previous_file")
  const toggleFileTreeShortcut = useCommandShortcut("diff.toggle_file_tree")
  const singlePatchShortcut = useCommandShortcut("diff.single_patch")
  const switchDiffShortcut = useCommandShortcut("diff.switch_diff")
  const toggleViewShortcut = useCommandShortcut("diff.toggle_view")
  const markReviewedShortcut = useCommandShortcut("diff.mark_reviewed")
  let scroll: ScrollBoxRenderable | undefined
  const patchNodeByFileIndex = new Map<number, BoxRenderable>()
  const [pendingPatchScrollFileIndex, setPendingPatchScrollFileIndex] = createSignal<number | undefined>()

  createEffect(() => {
    setExpandedFileNodes(allExpandedFileTreeDirectories(fileTree()))
    setHighlightedFileNode(undefined)
    setLastHighlightedFileNode(undefined)
    setActivePatchFileIndex(undefined)
    setSelectedFileIndex(undefined)
    setReviewedFileNames(new Set<string>())
  })

  const ensureHighlightedFileNode = () => {
    const highlighted = highlightedFileNode()
    if (highlighted !== undefined && fileRows().some((row) => row.id === highlighted)) return
    const lastHighlighted = lastHighlightedFileNode()
    const next =
      lastHighlighted !== undefined && fileRows().some((row) => row.id === lastHighlighted)
        ? lastHighlighted
        : fileRows().find((row) => row.fileIndex !== undefined)?.id
    setHighlightedFileNode(next)
  }

  const setHighlighted = (node: number | undefined) => {
    setHighlightedFileNode(node)
    if (node !== undefined) setLastHighlightedFileNode(node)
  }

  const moveFileSelection = (offset: number) =>
    setHighlighted(moveFileTreeSelection(fileRows(), highlightedFileNode(), offset))

  const clearFileTreePatchState = () => {
    setHighlightedFileNode(undefined)
    setActivePatchFileIndex(undefined)
  }

  const scrollPatchNodeToTop = (patchNode: BoxRenderable) => {
    requestAnimationFrame(() => {
      if (!scroll) return
      const scrollDelta = patchNode.y - scroll.viewport.y
      const contentY = scroll.scrollTop + scrollDelta
      const offset = contentY === 0 ? 0 : 1
      scroll.scrollBy(scrollDelta + offset)
    })
  }

  const revealFileTreeFile = (fileIndex: number) => {
    const selection = fileTreeFileSelection(fileTree(), fileIndex)
    if (!selection) return
    setExpandedFileNodes((expanded) => {
      const next = new Set(expanded)
      selection.expandedNodes.forEach((node) => next.add(node))
      return next
    })
    setHighlighted(selection.highlightedNode)
  }

  const selectPatchFile = (fileIndex: number) => {
    revealFileTreeFile(fileIndex)
    setActivePatchFileIndex(fileIndex)
    setSelectedFileIndex(fileIndex)
  }

  const scrollToFileIndex = (fileIndex: number | undefined) => {
    if (fileIndex === undefined) return
    selectPatchFile(fileIndex)
    const patchNode = patchNodeByFileIndex.get(fileIndex)
    if (patchNode) scrollPatchNodeToTop(patchNode)
  }

  const jumpToFileIndex = (fileIndex: number | undefined) => {
    if (fileIndex === undefined) return
    scrollToFileIndex(fileIndex)
  }

  const currentPatchFileIndex = () => {
    if (!scroll) return undefined
    const viewportContentY = scroll.scrollTop + 1
    const entries = patchFileIndexes()
      .map((fileIndex) => ({
        fileIndex,
        node: patchNodeByFileIndex.get(fileIndex),
      }))
      .filter((entry): entry is { fileIndex: number; node: BoxRenderable } => Boolean(entry.node))
      .map((entry) => ({
        ...entry,
        contentY: scroll!.scrollTop + entry.node.y - scroll!.viewport.y,
      }))
      .sort((left, right) => left.contentY - right.contentY)
    return entries.findLast((entry) => entry.contentY <= viewportContentY)?.fileIndex ?? entries[0]?.fileIndex
  }

  const nextPatchFileIndexFromViewport = (offset: number) => {
    if (!scroll) return undefined
    return relativePatchFileIndexFromViewport(
      patchFileIndexes()
        .map((fileIndex) => ({ fileIndex, node: patchNodeByFileIndex.get(fileIndex) }))
        .filter((entry): entry is { fileIndex: number; node: BoxRenderable } => Boolean(entry.node))
        .map((entry) => {
          const contentY = scroll!.scrollTop + entry.node.y - scroll!.viewport.y
          return {
            fileIndex: entry.fileIndex,
            titleContentY: contentY + (contentY === 0 ? 0 : 1),
          }
        }),
      scroll.scrollTop,
      offset,
    )
  }

  const jumpRelativePatchFile = (offset: number) => {
    if (singlePatch()) {
      const next = movePatchFileIndex(
        patchFileIndexes(),
        visiblePatchFiles()[0]?.fileIndex ?? selectedFileIndex() ?? activePatchFileIndex() ?? firstPatchFileIndex(),
        offset,
      )
      if (next === undefined) return
      selectPatchFile(next)
      scrollSinglePatchToTop()
      return
    }

    const current = focus() === "files" ? highlightedFileNode() : undefined
    const nextFromSelection =
      current === undefined ? undefined : moveFileTreeSelectionToFile(fileRows(), current, offset)
    if (nextFromSelection !== undefined) {
      jumpToFileIndex(fileRows().find((row) => row.id === nextFromSelection)?.fileIndex)
      return
    }
    scrollToFileIndex(
      nextPatchFileIndexFromViewport(offset) ??
        movePatchFileIndex(patchFileIndexes(), currentPatchFileIndex() ?? activePatchFileIndex(), offset),
    )
  }

  const highlightedPatchFileIndex = () => fileRows().find((row) => row.id === highlightedFileNode())?.fileIndex
  const firstPatchFileIndex = () => fileRows().find((row) => row.fileIndex !== undefined)?.fileIndex
  const visiblePatchFiles = createMemo(() => {
    if (!singlePatch()) {
      return patchFileIndexes().flatMap((fileIndex) => {
        const file = files()[fileIndex]
        return file ? [{ file, fileIndex }] : []
      })
    }
    const fileIndex = singlePatchFileIndex(
      selectedFileIndex(),
      activePatchFileIndex(),
      currentPatchFileIndex(),
      firstPatchFileIndex(),
    )
    const file = fileIndex === undefined ? undefined : files()[fileIndex]
    return file && fileIndex !== undefined ? [{ file, fileIndex }] : []
  })

  const ensureHighlightedPatchFile = () => {
    const fileIndex = currentPatchFileIndex() ?? activePatchFileIndex() ?? firstPatchFileIndex()
    if (fileIndex === undefined) return
    selectPatchFile(fileIndex)
  }

  const scrollToPatchFileIndexAfterRender = (fileIndex: number) => {
    setPendingPatchScrollFileIndex(fileIndex)
    requestAnimationFrame(() => {
      const patchNode = patchNodeByFileIndex.get(fileIndex)
      if (patchNode) scrollPatchNodeToTop(patchNode)
      requestAnimationFrame(() => {
        const patchNode = patchNodeByFileIndex.get(fileIndex)
        if (patchNode) scrollPatchNodeToTop(patchNode)
        setPendingPatchScrollFileIndex(undefined)
      })
    })
  }

  const scrollSinglePatchToTop = () => {
    requestAnimationFrame(() => {
      scroll?.scrollTo(0)
      requestAnimationFrame(() => scroll?.scrollTo(0))
    })
  }

  const registerPatchNode = (fileIndex: number, element: BoxRenderable) => {
    patchNodeByFileIndex.set(fileIndex, element)
    if (pendingPatchScrollFileIndex() !== fileIndex) return
    requestAnimationFrame(() => {
      scrollPatchNodeToTop(element)
      requestAnimationFrame(() => {
        scrollPatchNodeToTop(element)
        setPendingPatchScrollFileIndex(undefined)
      })
    })
  }

  const toggleSelectedFileTreeRow = () => {
    const highlighted = fileRows().find((row) => row.id === highlightedFileNode())
    if (highlighted?.fileIndex !== undefined) {
      jumpToFileIndex(highlighted.fileIndex)
      return
    }
    setExpandedFileNodes((expanded) => toggleFileTreeDirectory(fileTree(), expanded, highlightedFileNode()))
  }

  const toggleSelectedFileReviewed = () => {
    const fileIndex =
      focus() === "files"
        ? fileRows().find((row) => row.id === highlightedFileNode())?.fileIndex
        : (selectedFileIndex() ?? activePatchFileIndex() ?? currentPatchFileIndex())
    const file = fileIndex === undefined ? undefined : files()[fileIndex]?.file
    if (!file) return
    setReviewedFileNames((reviewed) => {
      const next = new Set(reviewed)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }

  const commands = [
    {
      name: "diff.close",
      title: "Close diff viewer",
      category: "VCS",
      run() {
        props.api.route.navigate("home")
      },
    },
    {
      name: "diff.down",
      title: "Move diff viewer down",
      category: "VCS",
      run: focusRunner({
        files() {
          moveFileSelection(1)
        },
        patches() {
          clearFileTreePatchState()
          scroll?.scrollBy(1)
        },
      }),
    },
    {
      name: "diff.up",
      title: "Move diff viewer up",
      category: "VCS",
      run: focusRunner({
        files() {
          moveFileSelection(-1)
        },
        patches() {
          clearFileTreePatchState()
          scroll?.scrollBy(-1)
        },
      }),
    },
    {
      name: "diff.page.down",
      title: "Page diff viewer down",
      category: "VCS",
      run: focusRunner({
        files() {
          moveFileSelection(8)
        },
        patches() {
          clearFileTreePatchState()
          if (scroll) scroll.scrollBy(scroll.height)
        },
      }),
    },
    {
      name: "diff.page.up",
      title: "Page diff viewer up",
      category: "VCS",
      run: focusRunner({
        files() {
          moveFileSelection(-8)
        },
        patches() {
          clearFileTreePatchState()
          if (scroll) scroll.scrollBy(-scroll.height)
        },
      }),
    },
    {
      name: "diff.toggle",
      title: "Toggle diff viewer item",
      category: "VCS",
      run: focusRunner({
        files() {
          toggleSelectedFileTreeRow()
        },
        patches() {},
      }),
    },
    {
      name: "diff.expand",
      title: "Expand diff viewer item",
      category: "VCS",
      run: focusRunner({
        files() {
          const highlighted = highlightedFileNode()
          if (highlighted !== undefined && expandedFileNodes().has(highlighted)) {
            setHighlighted(moveFileTreeSelectionToFirstChild(fileRows(), highlighted))
            return
          }
          setExpandedFileNodes((expanded) =>
            setFileTreeDirectoryExpanded(fileTree(), expanded, highlightedFileNode(), true),
          )
        },
        patches() {},
      }),
    },
    {
      name: "diff.collapse",
      title: "Collapse diff viewer item",
      category: "VCS",
      run: focusRunner({
        files() {
          const highlighted = highlightedFileNode()
          const node = highlighted === undefined ? undefined : fileTree().nodes[highlighted]
          if (node?.kind !== "directory" || !expandedFileNodes().has(node.id)) {
            setHighlighted(moveFileTreeSelectionToParent(fileRows(), highlighted))
            return
          }
          setExpandedFileNodes((expanded) =>
            setFileTreeDirectoryExpanded(fileTree(), expanded, highlightedFileNode(), false),
          )
        },
        patches() {},
      }),
    },
    {
      name: "diff.next_file",
      title: "Jump to next diff file",
      category: "VCS",
      run() {
        jumpRelativePatchFile(1)
      },
    },
    {
      name: "diff.previous_file",
      title: "Jump to previous diff file",
      category: "VCS",
      run() {
        jumpRelativePatchFile(-1)
      },
    },
    {
      name: "diff.mark_reviewed",
      title: "Toggle selected diff file reviewed",
      category: "VCS",
      run() {
        toggleSelectedFileReviewed()
      },
    },
    {
      name: "diff.switch_focus",
      title: "Switch diff viewer focus",
      category: "VCS",
      run() {
        if (!showFileTree()) return
        setFocus((current) => {
          if (current === "files") return "patches"
          ensureHighlightedFileNode()
          return "files"
        })
      },
    },
    {
      name: "diff.toggle_file_tree",
      title: "Toggle diff viewer file tree",
      category: "VCS",
      run() {
        setShowFileTree((value) => {
          if (value) setFocus("patches")
          return !value
        })
      },
    },
    {
      name: "diff.single_patch",
      title: "Toggle single patch view",
      category: "VCS",
      run() {
        if (!singlePatch()) {
          ensureHighlightedPatchFile()
          setSinglePatch(true)
          scrollSinglePatchToTop()
          return
        }
        const fileIndex =
          visiblePatchFiles()[0]?.fileIndex ??
          singlePatchFileIndex(
            selectedFileIndex(),
            activePatchFileIndex(),
            currentPatchFileIndex(),
            firstPatchFileIndex(),
          )
        if (fileIndex !== undefined) selectPatchFile(fileIndex)
        setSinglePatch(false)
        if (fileIndex !== undefined) scrollToPatchFileIndexAfterRender(fileIndex)
      },
    },
    {
      name: "diff.switch_diff",
      title: "Switch diff viewer source",
      category: "VCS",
      run() {
        openSwitchDiffDialog()
      },
    },
    {
      name: "diff.toggle_view",
      title: "Toggle diff viewer split or unified view",
      category: "VCS",
      run() {
        if (!splitAvailable()) return
        setViewOverride(view() === "split" ? "unified" : "split")
      },
    },
  ]

  const switchDiffOptions = createMemo(() => [
    {
      title: "Working tree",
      value: "git" as const,
      description: "Show current git changes",
    },
    {
      title: "Last turn",
      value: "last-turn" as const,
      description: "Show changes from the last assistant turn",
    },
  ])

  const openSwitchDiffDialog = () => {
    props.api.ui.dialog.replace(() => (
      <DialogSelect
        title="Switch diff"
        skipFilter={true}
        renderFilter={false}
        current={mode()}
        options={switchDiffOptions().map((option) => ({
          ...option,
          onSelect(dialog) {
            dialog.clear()
            props.api.route.navigate(ROUTE, {
              mode: option.value,
              sessionID: params()?.sessionID,
              messageID: params()?.messageID,
            })
          },
        }))}
      />
    ))
  }

  useBindings(() => ({
    commands,
    bindings: [
      { key: "j,down", cmd: "diff.down", desc: "Move diff viewer down" },
      { key: "k,up", cmd: "diff.up", desc: "Move diff viewer up" },
      { key: "pagedown,ctrl+f", cmd: "diff.page.down", desc: "Page diff viewer down" },
      { key: "pageup,ctrl+b", cmd: "diff.page.up", desc: "Page diff viewer up" },
      { key: "m", cmd: "diff.mark_reviewed", desc: "Mark selected file reviewed" },
      ...props.api.tuiConfig.keybinds.gather(
        "diff",
        commands.map((command) => command.name),
      ),
    ],
  }))

  return (
    <box position="absolute" zIndex={2500} left={0} top={0} width={dimensions().width} height={dimensions().height}>
      <PanelGroup axis="y" width="100%" height="100%">
        <Panel border="none" flexShrink={0} padding={0} paddingLeft={1}>
          <text fg={theme().text}>Diff </text>
          <text fg={theme().textMuted}>{mode() === "last-turn" ? "last turn" : "working tree"}</text>
          <box flexGrow={1} />
          <text fg={theme().textMuted}>
            {files().length} {files().length === 1 ? "file" : "files"}
          </text>
        </Panel>

        <box flexGrow={1} minHeight={0}>
          <Switch>
            <Match when={diff.loading}>
              <box flexGrow={1} alignItems="center" justifyContent="center">
                <text fg={theme().textMuted}>Loading diff...</text>
              </box>
            </Match>
            <Match when={!diff.loading}>
              <PanelGroup axis="x">
                <Show when={showFileTree()}>
                  <DiffViewerFileTree
                    files={files()}
                    loading={diff.loading}
                    error={diff.error}
                    theme={theme()}
                    focused={focus() === "files"}
                    width={FILE_TREE_WIDTH}
                    highlightedNode={highlightedFileNode()}
                    selectedFileIndex={selectedFileIndex()}
                    reviewedFileNames={reviewedFileNames()}
                    expandedNodes={expandedFileNodes()}
                  />
                </Show>

                <Panel flexGrow={1} minHeight={0} border="none">
                  <Separator axis="x" start="edge-out" />
                  <Switch>
                    <Match when={diff.error}>
                      <box paddingTop={1}>
                        <text fg={theme().error}>Failed to load diff</text>
                      </box>
                    </Match>
                    <Match when={files().length === 0}>
                      <box paddingTop={1}>
                        <text fg={theme().textMuted}>No diff to show</text>
                      </box>
                    </Match>
                    <Match when={files().length > 0}>
                      <scrollbox
                        ref={(element: ScrollBoxRenderable) => (scroll = element)}
                        flexGrow={1}
                        minHeight={0}
                        verticalScrollbarOptions={{ visible: false }}
                        horizontalScrollbarOptions={{ visible: false }}
                      >
                        <For each={visiblePatchFiles()}>
                          {(entry, index) => {
                            const reviewed = () => reviewedFileNames().has(entry.file.file)
                            return (
                              <box ref={(element: BoxRenderable) => registerPatchNode(entry.fileIndex, element)}>
                                {index() !== 0 ? <Separator axis="x" start="edge" /> : null}
                                <box
                                  flexDirection="row"
                                  gap={1}
                                  flexShrink={0}
                                  paddingLeft={1}
                                  paddingRight={1}
                                  border={["left"]}
                                  borderColor={theme().border}
                                >
                                  <text fg={reviewed() ? theme().textMuted : theme().text}>{entry.file.file}</text>
                                  <box flexGrow={1} />
                                  <text fg={reviewed() ? theme().textMuted : theme().diffAdded}>
                                    +{entry.file.additions}
                                  </text>
                                  <text fg={reviewed() ? theme().textMuted : theme().diffRemoved}>
                                    -{entry.file.deletions}
                                  </text>
                                </box>
                                <Separator axis="x" start="edge" />
                                <Show
                                  when={entry.file.patch}
                                  fallback={<text fg={theme().textMuted}>No patch available for this file.</text>}
                                >
                                  {(patch) => (
                                    <box border={["left"]} borderColor={theme().border}>
                                      <diff
                                        diff={patch()}
                                        view={view()}
                                        filetype={reviewed() ? PLAIN_TEXT_FILETYPE : filetype(entry.file.file)}
                                        syntaxStyle={themeState.syntax()}
                                        showLineNumbers={true}
                                        width="100%"
                                        wrapMode="char"
                                        fg={reviewed() ? theme().textMuted : theme().text}
                                        addedBg={reviewed() ? theme().backgroundElement : theme().diffAddedBg}
                                        removedBg={reviewed() ? theme().backgroundElement : theme().diffRemovedBg}
                                        addedSignColor={reviewed() ? theme().textMuted : theme().diffHighlightAdded}
                                        removedSignColor={reviewed() ? theme().textMuted : theme().diffHighlightRemoved}
                                        lineNumberFg={theme().diffLineNumber}
                                        addedLineNumberBg={
                                          reviewed() ? theme().backgroundElement : theme().diffAddedLineNumberBg
                                        }
                                        removedLineNumberBg={
                                          reviewed() ? theme().backgroundElement : theme().diffRemovedLineNumberBg
                                        }
                                      />
                                    </box>
                                  )}
                                </Show>
                              </box>
                            )
                          }}
                        </For>
                      </scrollbox>
                    </Match>
                  </Switch>
                  <Separator axis="x" start="edge-in" />
                </Panel>
              </PanelGroup>
            </Match>
          </Switch>
        </box>

        <Panel flexShrink={0} gap={2} paddingLeft={1} border="none">
          <Show when={switchFocusShortcut()}>
            {(shortcut) => (
              <text fg={theme().text}>
                {shortcut()} <span style={{ fg: theme().textMuted }}>focus file tree</span>
              </text>
            )}
          </Show>
          <Show when={nextFileShortcut()}>
            {(shortcut) => (
              <text fg={theme().text}>
                {shortcut()} <span style={{ fg: theme().textMuted }}>next file</span>
              </text>
            )}
          </Show>
          <Show when={previousFileShortcut()}>
            {(shortcut) => (
              <text fg={theme().text}>
                {shortcut()} <span style={{ fg: theme().textMuted }}>previous file</span>
              </text>
            )}
          </Show>
          <Show when={toggleFileTreeShortcut()}>
            {(shortcut) => (
              <text fg={theme().text}>
                {shortcut()}{" "}
                <span style={{ fg: theme().textMuted }}>{showFileTree() ? "hide file tree" : "show file tree"}</span>
              </text>
            )}
          </Show>
          <Show when={singlePatchShortcut()}>
            {(shortcut) => (
              <text fg={theme().text}>
                {shortcut()}{" "}
                <span style={{ fg: theme().textMuted }}>{singlePatch() ? "all patches" : "single patch"}</span>
              </text>
            )}
          </Show>
          <Show when={switchDiffShortcut()}>
            {(shortcut) => (
              <text fg={theme().text}>
                {shortcut()} <span style={{ fg: theme().textMuted }}>switch diff</span>
              </text>
            )}
          </Show>
          <Show when={toggleViewShortcut()}>
            {(shortcut) => (
              <text fg={theme().text}>
                {shortcut()}{" "}
                <span style={{ fg: theme().textMuted }}>{view() === "split" ? "unified view" : "split view"}</span>
              </text>
            )}
          </Show>
          <Show when={markReviewedShortcut()}>
            {(shortcut) => (
              <text fg={theme().text}>
                {shortcut()} <span style={{ fg: theme().textMuted }}>mark reviewed</span>
              </text>
            )}
          </Show>
        </Panel>
      </PanelGroup>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.route.register([
    {
      name: ROUTE,
      render: () => <DiffViewer api={api} />,
    },
  ])

  api.keymap.registerLayer({
    commands: [
      {
        name: "diff.open",
        title: "Open diff viewer",
        slashName: "diff",
        category: "VCS",
        namespace: "palette",
        run() {
          api.route.navigate(ROUTE, {
            mode: "git",
            sessionID: "params" in api.route.current ? api.route.current.params?.sessionID : undefined,
          })
          api.ui.dialog.clear()
        },
      },
    ],
  })
}

export default {
  id: "diff-viewer",
  tui,
}
