import { DiagramCanvas } from "../core/canvas.js"
import { diagramTextWidth } from "../core/text.js"
import type { GitGraphGrid } from "./render-grid.js"
import type { GitGraphCellStyle, GitGraphCommit, GitGraphDiagram, GitGraphDiagramRenderOptions } from "./types.js"

interface BranchSpan {
  first: number
  last: number
}

interface Transition {
  fromLane: number
  toLane: number
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
  const heads = new Map<string, string[]>()
  for (const branch of diagram.branches) {
    if (branch.head === undefined) continue
    const names = heads.get(branch.head) ?? []
    names.push(branch.name)
    heads.set(branch.head, names)
  }
  const graphWidth = (diagram.branches.length - 1) * LANE_WIDTH + 1
  let labelWidth = 0
  for (const commit of diagram.commits) labelWidth = Math.max(labelWidth, diagramTextWidth(commitLabel(commit, heads)))
  const transitions = diagram.commits.map((commit) => commitTransitions(commit, laneByBranch, commitById))
  const transitionHeights = transitions.map((items, index) =>
    index === 0 ? 0 : Math.max(1, ...items.map((item) => Math.abs(item.fromLane - item.toLane))),
  )
  const height = diagram.commits.length + transitionHeights.reduce((sum, value) => sum + value, 0)
  const grid: GitGraphGrid = new DiagramCanvas(graphWidth + LABEL_GAP + labelWidth, height)

  let row = 0
  diagram.commits.forEach((commit, index) => {
    const transitionHeight = transitionHeights[index]!
    if (transitionHeight > 0) {
      drawTransitionRows(grid, spans, laneByBranch, commit, index, row, transitionHeight, transitions[index]!)
      row += transitionHeight
    }
    drawCommitRow(grid, diagram, spans, laneByBranch, commit, index, row)
    grid.setText(graphWidth + LABEL_GAP, row, commitLabel(commit, heads), "label")
    row += 1
  })
  return grid
}

function drawCommitRow(
  grid: GitGraphGrid,
  diagram: GitGraphDiagram,
  spans: Map<string, BranchSpan>,
  laneByBranch: Map<string, number>,
  commit: GitGraphCommit,
  index: number,
  y: number,
): void {
  for (const branch of diagram.branches) {
    const lane = laneByBranch.get(branch.name)!
    const span = spans.get(branch.name)
    if (span && span.first <= index && (span.last > index || branch.name === commit.branch)) {
      grid.setCell(lane * LANE_WIDTH, y, "│", branchStyle(lane))
    }
  }
  const lane = laneByBranch.get(commit.branch)!
  grid.setCell(lane * LANE_WIDTH, y, commitGlyph(commit), commitStyle(commit))
}

function drawTransitionRows(
  grid: GitGraphGrid,
  spans: Map<string, BranchSpan>,
  laneByBranch: Map<string, number>,
  commit: GitGraphCommit,
  index: number,
  startY: number,
  height: number,
  transitions: readonly Transition[],
): void {
  for (let row = 0; row < height; row += 1) {
    const y = startY + row
    for (const [branch, span] of spans) {
      const lane = laneByBranch.get(branch)!
      if (span.first < index && (span.last > index || branch === commit.branch)) {
        grid.setCell(lane * LANE_WIDTH, y, "│", branchStyle(lane))
      }
    }
    for (const transition of transitions) drawTransitionStep(grid, transition, row, height, y)
  }
}

function commitTransitions(
  commit: GitGraphCommit,
  laneByBranch: Map<string, number>,
  commitById: Map<string, GitGraphCommit>,
): Transition[] {
  const result: Transition[] = []
  const lane = laneByBranch.get(commit.branch)!
  const firstParent = commit.parents[0] === undefined ? undefined : commitById.get(commit.parents[0])
  if (firstParent && firstParent.branch !== commit.branch) {
    result.push({ fromLane: laneByBranch.get(firstParent.branch)!, toLane: lane, style: branchStyle(lane) })
  }
  const secondParent = commit.parents[1] === undefined ? undefined : commitById.get(commit.parents[1])
  if (secondParent) {
    const fromLane = laneByBranch.get(secondParent.branch)!
    result.push({ fromLane, toLane: lane, style: branchStyle(fromLane) })
  }
  return result
}

function drawTransitionStep(grid: GitGraphGrid, transition: Transition, row: number, height: number, y: number): void {
  const distance = Math.abs(transition.fromLane - transition.toLane)
  if (distance === 0) return
  const firstStep = height - distance
  if (row < firstStep) return
  const direction = Math.sign(transition.toLane - transition.fromLane)
  const step = row - firstStep
  const lane = transition.fromLane + (direction > 0 ? step : -step - 1)
  grid.setCell(lane * LANE_WIDTH + 1, y, direction > 0 ? "╲" : "╱", transition.style)
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

function commitGlyph(commit: GitGraphCommit): string {
  if (commit.type === "REVERSE") return "⊗"
  if (commit.type === "HIGHLIGHT") return "◆"
  return commit.parents.length > 1 ? "◎" : "○"
}

function commitStyle(commit: GitGraphCommit): GitGraphCellStyle {
  if (commit.type === "REVERSE") return "reverse"
  if (commit.type === "HIGHLIGHT") return "highlight"
  return commit.parents.length > 1 ? "merge" : "commit"
}

function commitLabel(commit: GitGraphCommit, heads: Map<string, string[]>): string {
  const subject = commit.message && commit.message !== commit.id ? `${commit.id} ${commit.message}` : commit.id
  const decorations = [...(heads.get(commit.id) ?? []), ...commit.tags.map((tag) => `tag: ${tag}`)]
  return decorations.length === 0 ? subject : `${subject}  (${decorations.join(", ")})`
}

function branchStyle(lane: number): GitGraphCellStyle {
  return `branch${lane % 8}` as GitGraphCellStyle
}
