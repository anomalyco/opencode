import { DiagramCanvas } from "../core/canvas.js"
import { diagramTextWidth } from "../core/text.js"
import type { GitGraphGrid } from "./render-grid.js"
import type { GitGraphCellStyle, GitGraphCommit, GitGraphDiagram, GitGraphDiagramRenderOptions } from "./types.js"

interface BranchSpan {
  first: number
  last: number
}

interface Connections {
  up?: boolean
  down?: boolean
  left?: boolean
  right?: boolean
  style: GitGraphCellStyle
}

const LANE_WIDTH = 2
const LABEL_GAP = 2

export function drawGitGraphDiagramGrid(
  diagram: GitGraphDiagram,
  _options: GitGraphDiagramRenderOptions = {},
): GitGraphGrid {
  if (diagram.commits.length === 0) return new DiagramCanvas(0, 0)
  const laneByBranch = new Map(diagram.branches.map((branch, index) => [branch.name, index]))
  const commitById = new Map(diagram.commits.map((commit) => [commit.id, commit]))
  const spans = branchSpans(diagram, commitById)
  const heads = branchHeads(diagram)
  const graphWidth = (diagram.branches.length - 1) * LANE_WIDTH + 1
  let labelWidth = 0
  for (const commit of diagram.commits) labelWidth = Math.max(labelWidth, diagramTextWidth(commitLabel(commit, heads)))
  const forks = diagram.commits.map((commit) => isFork(commit, laneByBranch, commitById))
  const height = diagram.commits.length + forks.filter(Boolean).length
  const grid: GitGraphGrid = new DiagramCanvas(graphWidth + LABEL_GAP + labelWidth, height)

  let row = 0
  diagram.commits.forEach((commit, index) => {
    if (forks[index]) {
      drawTransitionRow(grid, spans, laneByBranch, commitById, commit, index, row)
      row += 1
    }
    drawCommitRow(grid, diagram, spans, laneByBranch, commitById, commit, index, row)
    grid.setText(graphWidth + LABEL_GAP, row, commitLabel(commit, heads), "label")
    row += 1
  })
  return grid
}

function drawTransitionRow(
  grid: GitGraphGrid,
  spans: Map<string, BranchSpan>,
  laneByBranch: Map<string, number>,
  commitById: Map<string, GitGraphCommit>,
  commit: GitGraphCommit,
  index: number,
  y: number,
): void {
  const cells = new Map<number, Connections>()
  for (const [branch, span] of spans) {
    if (span.first >= index || span.last < index) continue
    const lane = laneByBranch.get(branch)!
    connect(cells, lane * LANE_WIDTH, { up: true, down: true }, branchStyle(lane))
  }

  const lane = laneByBranch.get(commit.branch)!
  const firstParent = commit.parents[0] === undefined ? undefined : commitById.get(commit.parents[0])
  if (firstParent && firstParent.branch !== commit.branch) {
    const parentLane = laneByBranch.get(firstParent.branch)!
    connectHorizontal(
      cells,
      parentLane,
      lane,
      { sourceUp: true, sourceDown: true, targetDown: true },
      branchStyle(lane),
    )
  }
  paintConnections(grid, cells, y)
}

function drawCommitRow(
  grid: GitGraphGrid,
  diagram: GitGraphDiagram,
  spans: Map<string, BranchSpan>,
  laneByBranch: Map<string, number>,
  commitById: Map<string, GitGraphCommit>,
  commit: GitGraphCommit,
  index: number,
  y: number,
): void {
  const cells = new Map<number, Connections>()
  for (const branch of diagram.branches) {
    const span = spans.get(branch.name)
    if (!span || span.first > index || (span.last <= index && branch.name !== commit.branch)) continue
    const lane = laneByBranch.get(branch.name)!
    connect(cells, lane * LANE_WIDTH, { up: index > 0, down: span.last > index }, branchStyle(lane))
  }

  const lane = laneByBranch.get(commit.branch)!
  const secondParent = commit.parents[1] === undefined ? undefined : commitById.get(commit.parents[1])
  if (secondParent) {
    const parentLane = laneByBranch.get(secondParent.branch)!
    connectHorizontal(cells, lane, parentLane, { sourceUp: true, targetUp: true }, branchStyle(parentLane))
  }
  paintConnections(grid, cells, y)
  grid.setCell(lane * LANE_WIDTH, y, commitGlyph(commit), commitStyle(commit))
}

function connectHorizontal(
  cells: Map<number, Connections>,
  sourceLane: number,
  targetLane: number,
  vertical: { sourceUp?: boolean; sourceDown?: boolean; targetUp?: boolean; targetDown?: boolean },
  style: GitGraphCellStyle,
): void {
  if (sourceLane === targetLane) return
  const source = sourceLane * LANE_WIDTH
  const target = targetLane * LANE_WIDTH
  const direction = Math.sign(target - source)
  connect(
    cells,
    source,
    { ...verticalAt(vertical.sourceUp, vertical.sourceDown), ...(direction > 0 ? { right: true } : { left: true }) },
    style,
  )
  for (let x = source + direction; x !== target; x += direction) {
    connect(cells, x, { left: true, right: true }, style)
  }
  connect(
    cells,
    target,
    { ...verticalAt(vertical.targetUp, vertical.targetDown), ...(direction > 0 ? { left: true } : { right: true }) },
    style,
  )
}

function verticalAt(up: boolean | undefined, down: boolean | undefined): Pick<Connections, "up" | "down"> {
  return { ...(up ? { up: true } : {}), ...(down ? { down: true } : {}) }
}

function connect(
  cells: Map<number, Connections>,
  x: number,
  additions: Omit<Connections, "style">,
  style: GitGraphCellStyle,
): void {
  const current = cells.get(x)
  cells.set(x, { ...current, ...additions, style: current?.style ?? style })
}

function paintConnections(grid: GitGraphGrid, cells: Map<number, Connections>, y: number): void {
  for (const [x, connections] of cells) grid.setCell(x, y, connectionGlyph(connections), connections.style)
}

function connectionGlyph({ up, down, left, right }: Connections): string {
  const mask = `${up ? 1 : 0}${down ? 1 : 0}${left ? 1 : 0}${right ? 1 : 0}`
  const glyphs: Record<string, string> = {
    "1100": "│",
    "0011": "─",
    "0101": "╭",
    "0110": "╮",
    "1001": "╰",
    "1010": "╯",
    "1101": "├",
    "1110": "┤",
    "0111": "┬",
    "1011": "┴",
    "1111": "┼",
    "1000": "│",
    "0100": "│",
    "0010": "─",
    "0001": "─",
  }
  return glyphs[mask] ?? " "
}

function branchSpans(diagram: GitGraphDiagram, commitById: Map<string, GitGraphCommit>): Map<string, BranchSpan> {
  const spans = new Map<string, BranchSpan>()
  diagram.commits.forEach((commit, index) => {
    const span = spans.get(commit.branch)
    if (span) span.last = index
    else spans.set(commit.branch, { first: index, last: index })
    for (const parentId of commit.parents) {
      const parent = commitById.get(parentId)
      if (!parent || parent.branch === commit.branch) continue
      const parentSpan = spans.get(parent.branch)
      if (parentSpan) parentSpan.last = Math.max(parentSpan.last, index)
    }
  })
  return spans
}

function branchHeads(diagram: GitGraphDiagram): Map<string, string[]> {
  const heads = new Map<string, string[]>()
  for (const branch of diagram.branches) {
    if (branch.head === undefined) continue
    const names = heads.get(branch.head) ?? []
    names.push(branch.name)
    heads.set(branch.head, names)
  }
  return heads
}

function isFork(
  commit: GitGraphCommit,
  laneByBranch: Map<string, number>,
  commitById: Map<string, GitGraphCommit>,
): boolean {
  const parent = commit.parents[0] === undefined ? undefined : commitById.get(commit.parents[0])
  return parent !== undefined && laneByBranch.get(parent.branch) !== laneByBranch.get(commit.branch)
}

function commitGlyph(commit: GitGraphCommit): string {
  if (commit.type === "REVERSE") return "⊗"
  if (commit.type === "HIGHLIGHT") return "◆"
  return commit.parents.length > 1 ? "◎" : "●"
}

function commitStyle(commit: GitGraphCommit): GitGraphCellStyle {
  if (commit.type === "REVERSE") return "reverse"
  if (commit.type === "HIGHLIGHT") return "highlight"
  return commit.parents.length > 1 ? "merge" : "commit"
}

function commitLabel(commit: GitGraphCommit, heads: Map<string, string[]>): string {
  const subject = commit.message ?? commit.id
  const decorations = [...(heads.get(commit.id) ?? []), ...commit.tags].map((value) => `[${value}]`)
  return decorations.length === 0 ? subject : `${subject}  ${decorations.join(" ")}`
}

function branchStyle(lane: number): GitGraphCellStyle {
  return `branch${lane % 8}` as GitGraphCellStyle
}
