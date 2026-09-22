import type { Vcs } from "@opencode/schema/vcs"
import { createGitGraphLayoutModel, type BranchLineSeed, type GraphPoint } from "./layout-algorithm"

export interface GitGraphLayoutOptions {
  rowHeight?: number
  laneGap?: number
  lanePadding?: number
  topPadding?: number
  bottomPadding?: number
}

export interface GitGraphLayoutRow {
  commit: Vcs.GraphCommit
  rowIndex: number
  laneIndex: number
  colourIndex: number
  truncated: boolean
  x: number
  y: number
}

export interface GitGraphLayoutEdge {
  id: string
  fromHash: string
  toHash: string
  fromLaneIndex: number
  toLaneIndex: number
  path: string
  truncated: boolean
}

export interface GitGraphLayoutPath {
  id: string
  colourIndex: number
  path: string
  relatedHashes: string[]
}

export interface GitGraphLayout {
  rows: GitGraphLayoutRow[]
  edges: GitGraphLayoutEdge[]
  paths: GitGraphLayoutPath[]
  laneCount: number
  colourCount: number
  width: number
  height: number
  rowHeight: number
}

interface PixelOptions {
  lanePadding: number
  laneGap: number
  topPadding: number
  rowHeight: number
}

const DEFAULT_ROW_HEIGHT = 42
const DEFAULT_LANE_GAP = 18
const DEFAULT_LANE_PADDING = 16
const DEFAULT_TOP_PADDING = 21
const DEFAULT_BOTTOM_PADDING = 21

/** Number of distinct lane hues; keep in sync with `.git-graph-dialog` in git-graph.css. */
export const LANE_COLOUR_COUNT = 7

/**
 * Lane colour comes from branch identity, not from the visible column, so a
 * commit keeps its colour when earlier pages are appended.
 */
function colourIndexFor(branchKey: string) {
  let hash = 0
  for (let index = 0; index < branchKey.length; index++) {
    hash = (hash * 31 + branchKey.charCodeAt(index)) | 0
  }
  return Math.abs(hash) % LANE_COLOUR_COUNT
}

function buildEdgePath(input: { fromX: number; fromY: number; toX: number; toY: number; lockedFirst?: boolean }) {
  if (input.fromX === input.toX) return `M ${input.fromX} ${input.fromY} L ${input.toX} ${input.toY}`
  const curveOffset = Math.max(14, Math.abs(input.toY - input.fromY) * 0.38)
  if (input.lockedFirst === false) {
    return `M ${input.fromX} ${input.fromY} C ${input.fromX} ${input.toY - curveOffset}, ${input.toX} ${input.toY - curveOffset}, ${input.toX} ${input.toY}`
  }
  return `M ${input.fromX} ${input.fromY} C ${input.fromX} ${input.fromY + curveOffset}, ${input.toX} ${input.fromY + curveOffset}, ${input.toX} ${input.toY}`
}

function pointToPixels(point: GraphPoint, options: PixelOptions) {
  return {
    x: options.lanePadding + point.laneIndex * options.laneGap,
    y: options.topPadding + point.rowIndex * options.rowHeight,
  }
}

function createGraphPath(line: BranchLineSeed, index: number, options: PixelOptions): GitGraphLayoutPath {
  const from = pointToPixels(line.from, options)
  const to = pointToPixels(line.to, options)
  return {
    id: `${line.sourceHash}:${line.targetHash}:${line.from.rowIndex}:${line.to.rowIndex}:${index}`,
    colourIndex: colourIndexFor(line.branchKey),
    path: buildEdgePath({ fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, lockedFirst: line.lockedFirst }),
    relatedHashes: line.sourceHash === line.targetHash ? [line.sourceHash] : [line.sourceHash, line.targetHash],
  }
}

export function layoutGitGraph(
  commits: readonly Vcs.GraphCommit[],
  options: GitGraphLayoutOptions = {},
): GitGraphLayout {
  const rowHeight = options.rowHeight ?? DEFAULT_ROW_HEIGHT
  const laneGap = options.laneGap ?? DEFAULT_LANE_GAP
  const lanePadding = options.lanePadding ?? DEFAULT_LANE_PADDING
  const topPadding = options.topPadding ?? DEFAULT_TOP_PADDING
  const bottomPadding = options.bottomPadding ?? DEFAULT_BOTTOM_PADDING
  const model = createGitGraphLayoutModel(commits)
  const rows = model.vertices.map((vertex, rowIndex) => ({
    commit: commits[rowIndex]!,
    rowIndex,
    laneIndex: vertex.getLaneIndex(),
    colourIndex: colourIndexFor(vertex.getBranch()?.key ?? vertex.hash),
    truncated: false,
    x: lanePadding + vertex.getLaneIndex() * laneGap,
    y: topPadding + rowIndex * rowHeight,
  }))
  const rowByHash = new Map(rows.map((row) => [row.commit.hash, row]))
  const pixelOptions = { lanePadding, laneGap, topPadding, rowHeight }
  const edges = commits.flatMap((commit, rowIndex) => {
    const vertex = model.vertexByHash.get(commit.hash)!
    return commit.parents.map((parentHash, parentIndex) => {
      const parent = model.vertexByHash.get(parentHash)
      const fromLaneIndex = vertex.getLaneIndex()
      const toLaneIndex = parent?.getLaneIndex() ?? fromLaneIndex + parentIndex
      const fromRow = rows[rowIndex]!
      const toRow = rowByHash.get(parentHash)
      return {
        id: `${commit.hash}:${parentHash}:${parentIndex}`,
        fromHash: commit.hash,
        toHash: parentHash,
        fromLaneIndex,
        toLaneIndex,
        path: buildEdgePath({
          fromX: lanePadding + fromLaneIndex * laneGap,
          fromY: fromRow.y,
          toX: lanePadding + toLaneIndex * laneGap,
          toY: toRow?.y ?? fromRow.y,
          lockedFirst: fromLaneIndex < toLaneIndex,
        }),
        truncated: !toRow,
      }
    })
  })
  const truncatedHashes = new Set(edges.filter((edge) => edge.truncated).map((edge) => edge.fromHash))
  for (const row of rows) row.truncated = truncatedHashes.has(row.commit.hash)
  const maxRowLane = rows.reduce((max, row) => Math.max(max, row.laneIndex), 0)
  const maxWidthLane = model.vertices.reduce((max, vertex) => Math.max(max, vertex.getWidthLaneIndex() - 1), 0)
  const maxPathLane = model.branchLines.reduce((max, line) => Math.max(max, line.from.laneIndex, line.to.laneIndex), 0)
  const laneCount = Math.max(1, maxRowLane + 1, maxWidthLane + 1, maxPathLane + 1)

  return {
    rows,
    edges,
    paths: model.branchLines.map((line, index) => createGraphPath(line, index, pixelOptions)),
    laneCount,
    colourCount: LANE_COLOUR_COUNT,
    width: lanePadding * 2 + (laneCount - 1) * laneGap,
    height: topPadding + Math.max(0, commits.length - 1) * rowHeight + bottomPadding,
    rowHeight,
  }
}
