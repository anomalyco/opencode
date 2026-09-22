import type { Vcs } from "@opencode/schema/vcs"

// Adapted and modified from zai-org/ZCode at 872ad960de7ec172591f7e1952f7849229f94521.
// The upstream project is Apache-2.0 licensed; see THIRD_PARTY_NOTICES.md.
export interface GraphPoint {
  laneIndex: number
  rowIndex: number
}

export interface BranchLineSeed {
  from: GraphPoint
  to: GraphPoint
  laneIndex: number
  branchKey: string
  sourceHash: string
  targetHash: string
  lockedFirst: boolean
}

interface LaneConnection {
  target: LayoutVertex
  branch: LayoutBranch
}

const MISSING_PARENT_ID = -1

class LayoutBranch {
  readonly colourIndex: number
  readonly key: string
  readonly lines: BranchLineSeed[] = []
  endRowIndex = 0

  constructor(colourIndex: number, key: string) {
    this.colourIndex = colourIndex
    this.key = key
  }

  addLine(from: GraphPoint, to: GraphPoint, sourceHash: string, targetHash: string, lockedFirst: boolean) {
    this.lines.push({
      from,
      to,
      laneIndex: this.colourIndex,
      branchKey: this.key,
      sourceHash,
      targetHash,
      lockedFirst,
    })
  }
}

class LayoutVertex {
  readonly id: number
  readonly hash: string
  private readonly parents: LayoutVertex[] = []
  private nextParentIndex = 0
  private laneIndex: number | null = null
  private branch: LayoutBranch | null = null
  private nextLaneIndex = 0
  private readonly connections: Array<LaneConnection | undefined> = []

  constructor(id: number, hash: string) {
    this.id = id
    this.hash = hash
  }

  addParent(vertex: LayoutVertex) {
    this.parents.push(vertex)
  }

  getNextParent() {
    return this.nextParentIndex < this.parents.length ? this.parents[this.nextParentIndex]! : null
  }

  registerParentProcessed() {
    this.nextParentIndex++
  }

  isMerge() {
    return this.parents.length > 1
  }

  isNotOnBranch() {
    return this.branch === null || this.laneIndex === null
  }

  addToBranch(branch: LayoutBranch, laneIndex: number) {
    if (this.branch !== null) return
    this.branch = branch
    this.laneIndex = laneIndex
  }

  getBranch() {
    return this.branch
  }

  getLaneIndex() {
    return this.laneIndex ?? 0
  }

  getPoint(): GraphPoint {
    return { laneIndex: this.getLaneIndex(), rowIndex: this.id }
  }

  getNextPoint(): GraphPoint {
    return { laneIndex: this.nextLaneIndex, rowIndex: this.id }
  }

  getPointConnectingTo(target: LayoutVertex, branch: LayoutBranch) {
    const laneIndex = this.connections.findIndex(
      (connection) => connection?.target === target && connection.branch === branch,
    )
    return laneIndex >= 0 ? { laneIndex, rowIndex: this.id } : null
  }

  reservePoint(laneIndex: number, target: LayoutVertex, branch: LayoutBranch) {
    if (laneIndex !== this.nextLaneIndex) return
    this.connections[laneIndex] = { target, branch }
    this.nextLaneIndex = laneIndex + 1
  }

  getWidthLaneIndex() {
    return this.nextLaneIndex
  }
}

function createVertices(commits: readonly Vcs.GraphCommit[]) {
  const missingParent = new LayoutVertex(MISSING_PARENT_ID, "__opencode_missing_parent__")
  const vertices = commits.map((commit, index) => new LayoutVertex(index, commit.hash))
  const vertexByHash = new Map(vertices.map((vertex) => [vertex.hash, vertex]))

  commits.forEach((commit, index) => {
    const vertex = vertices[index]!
    commit.parents.forEach((parentHash) => vertex.addParent(vertexByHash.get(parentHash) ?? missingParent))
  })

  return { missingParent, vertices, vertexByHash }
}

function getAvailableColour(startAt: number, availableColours: number[]) {
  const reusable = availableColours.findIndex((endAt) => startAt > endAt)
  if (reusable >= 0) return reusable
  availableColours.push(0)
  return availableColours.length - 1
}

function determineMergePath(startAt: number, vertices: LayoutVertex[], vertex: LayoutVertex, parent: LayoutVertex) {
  const branch = parent.getBranch()!
  let lastPoint = vertex.getPoint()

  for (let rowIndex = startAt + 1; rowIndex < vertices.length; rowIndex++) {
    const current = vertices[rowIndex]!
    const existing = current.getPointConnectingTo(parent, branch)
    const point = existing ?? current.getNextPoint()
    branch.addLine(
      lastPoint,
      point,
      vertex.hash,
      parent.hash,
      existing === null && current !== parent ? lastPoint.laneIndex < point.laneIndex : true,
    )
    current.reservePoint(point.laneIndex, parent, branch)
    lastPoint = point
    if (existing === null) continue
    vertex.registerParentProcessed()
    return
  }
}

function determineNormalPath(input: {
  startAt: number
  vertices: LayoutVertex[]
  branches: LayoutBranch[]
  availableColours: number[]
  missingParent: LayoutVertex
}) {
  let rowIndex = input.startAt
  let vertex = input.vertices[rowIndex]!
  let parent = vertex.getNextParent()
  let lastPoint = vertex.isNotOnBranch() ? vertex.getNextPoint() : vertex.getPoint()
  // The branch identity is the commit that started it, so lane colour survives
  // pagination instead of shifting when the visible window changes.
  const branch = new LayoutBranch(getAvailableColour(input.startAt, input.availableColours), vertex.hash)
  vertex.addToBranch(branch, lastPoint.laneIndex)
  vertex.reservePoint(lastPoint.laneIndex, vertex, branch)

  for (rowIndex = input.startAt + 1; rowIndex < input.vertices.length; rowIndex++) {
    if (parent === null || parent === input.missingParent) break
    const current = input.vertices[rowIndex]!
    const point = parent === current && !parent.isNotOnBranch() ? current.getPoint() : current.getNextPoint()
    branch.addLine(lastPoint, point, vertex.hash, parent.hash, lastPoint.laneIndex < point.laneIndex)
    current.reservePoint(point.laneIndex, parent, branch)
    lastPoint = point
    if (parent !== current) continue
    vertex.registerParentProcessed()
    const parentWasAlreadyOnBranch = !parent.isNotOnBranch()
    parent.addToBranch(branch, point.laneIndex)
    vertex = parent
    parent = vertex.getNextParent()
    if (parent === input.missingParent) {
      vertex.registerParentProcessed()
      break
    }
    if (parent === null || parentWasAlreadyOnBranch) break
  }

  branch.endRowIndex = rowIndex
  input.branches.push(branch)
  input.availableColours[branch.colourIndex] = rowIndex
}

function determinePath(input: {
  startAt: number
  vertices: LayoutVertex[]
  branches: LayoutBranch[]
  availableColours: number[]
  missingParent: LayoutVertex
}) {
  const vertex = input.vertices[input.startAt]!
  const parent = vertex.getNextParent()
  if (parent === input.missingParent) {
    vertex.registerParentProcessed()
    return
  }
  if (parent !== null && vertex.isMerge() && !vertex.isNotOnBranch() && !parent.isNotOnBranch()) {
    determineMergePath(input.startAt, input.vertices, vertex, parent)
    return
  }
  determineNormalPath(input)
}

export function createGitGraphLayoutModel(commits: readonly Vcs.GraphCommit[]) {
  const model = createVertices(commits)
  const branches: LayoutBranch[] = []
  const availableColours: number[] = []
  let index = 0

  while (index < model.vertices.length) {
    const vertex = model.vertices[index]!
    if (vertex.getNextParent() !== null || vertex.isNotOnBranch()) {
      determinePath({
        startAt: index,
        vertices: model.vertices,
        branches,
        availableColours,
        missingParent: model.missingParent,
      })
      continue
    }
    index++
  }

  return {
    vertices: model.vertices,
    vertexByHash: model.vertexByHash,
    branchLines: branches.flatMap((branch) => branch.lines),
  }
}
