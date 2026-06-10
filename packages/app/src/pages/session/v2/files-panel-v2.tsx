import { createMemo, type JSX } from "solid-js"
import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"
import { SessionReviewV2Sidebar } from "@opencode-ai/ui/v2/session-review-v2"
import FileTreeV2 from "@/components/file-tree-v2"
import { useFile } from "@/context/file"
import {
  REVIEW_PANEL_V2_SIDEBAR_WIDTH_MAX,
  REVIEW_PANEL_V2_SIDEBAR_WIDTH_MIN,
  type ReviewPanelV2State,
} from "@/pages/session/v2/review-panel-v2-state"
import { filterRenderableDiff, reviewDiffKinds } from "@/pages/session/v2/review-diff-kinds"

type ReviewDiff = SnapshotFileDiff | VcsFileDiff

export type FilesPanelV2SidebarProps = {
  title: string | JSX.Element
  state: ReviewPanelV2State
  diffs: () => ReviewDiff[]
  activeFile?: string
  onOpenFile: (path: string) => void
}

export function FilesPanelV2Sidebar(props: FilesPanelV2SidebarProps) {
  const file = useFile()
  const diffs = createMemo(() => props.diffs().filter(filterRenderableDiff))
  const diffFiles = createMemo(() => diffs().map((diff) => diff.file))
  const kinds = createMemo(() => reviewDiffKinds(diffs()))
  const activeFile = createMemo(() => {
    const active = props.activeFile
    if (!active) return
    return file.pathFromTab(active) ?? active
  })

  return (
    <SessionReviewV2Sidebar
      open={props.state.sidebarOpened()}
      title={props.title}
      filter={props.state.filesFilter()}
      onFilterChange={props.state.setFilesFilter}
      width={props.state.sidebarWidth()}
      onWidthChange={props.state.resizeSidebar}
      minWidth={REVIEW_PANEL_V2_SIDEBAR_WIDTH_MIN}
      maxWidth={REVIEW_PANEL_V2_SIDEBAR_WIDTH_MAX}
    >
      <FileTreeV2
        path=""
        modified={diffFiles()}
        kinds={kinds()}
        showModifiedLabel
        query={props.state.filesFilter()}
        active={activeFile()}
        onFileClick={(node) => props.onOpenFile(node.path)}
      />
    </SessionReviewV2Sidebar>
  )
}
