// Jules API wire types — mirrors jules.googleapis.com/v1alpha

export type SessionState =
  | "STATE_UNSPECIFIED"
  | "QUEUED"
  | "PLANNING"
  | "AWAITING_PLAN_APPROVAL"
  | "AWAITING_USER_FEEDBACK"
  | "IN_PROGRESS"
  | "PAUSED"
  | "FAILED"
  | "COMPLETED"

export type AutomationMode = "AUTOMATION_MODE_UNSPECIFIED" | "AUTO_CREATE_PR"

export type GitHubBranch = {
  displayName: string
}

export type GitHubRepo = {
  owner: string
  repo: string
  isPrivate: boolean
  defaultBranch: GitHubBranch
  branches: GitHubBranch[]
}

export type Source = {
  name: string
  id: string
  githubRepo: GitHubRepo
}

export type GitHubRepoContext = {
  startingBranch: string
}

export type SourceContext = {
  source: string
  githubRepoContext?: GitHubRepoContext
}

export type PlanStep = {
  id: string
  index: number
  title: string
  description: string
}

export type Plan = {
  id: string
  steps: PlanStep[]
  createTime: string
}

export type GitPatch = {
  baseCommitId: string
  unidiffPatch: string
  suggestedCommitMessage: string
}

export type ChangeSet = {
  source: string
  gitPatch: GitPatch
}

export type BashOutput = {
  command: string
  output: string
  exitCode: number
}

export type Media = {
  mimeType: string
  data: string
}

export type Artifact = {
  changeSet?: ChangeSet
  bashOutput?: BashOutput
  media?: Media
}

export type PlanGenerated = {
  plan: Plan
}

export type PlanApproved = {
  planId: string
}

export type UserMessaged = {
  userMessage: string
}

export type AgentMessaged = {
  agentMessage: string
}

export type ProgressUpdated = {
  title: string
  description: string
}

export type SessionCompleted = Record<string, never>

export type SessionFailed = {
  reason: string
}

export type Activity = {
  name: string
  id: string
  originator: string
  description: string
  createTime: string
  artifacts?: Artifact[]
  planGenerated?: PlanGenerated
  planApproved?: PlanApproved
  userMessaged?: UserMessaged
  agentMessaged?: AgentMessaged
  progressUpdated?: ProgressUpdated
  sessionCompleted?: SessionCompleted
  sessionFailed?: SessionFailed
}

export type PullRequest = {
  url: string
  title: string
  description: string
}

export type SessionOutput = {
  pullRequest?: PullRequest
}

export type Session = {
  name: string
  id: string
  prompt: string
  title?: string
  state: SessionState
  url?: string
  sourceContext?: SourceContext
  outputs?: SessionOutput[]
  createTime: string
  updateTime: string
}

export type CreateSessionBody = {
  prompt: string
  title?: string
  sourceContext?: SourceContext
  requirePlanApproval?: boolean
  automationMode?: AutomationMode
}

export type ListSessionsResponse = {
  sessions: Session[]
  nextPageToken?: string
}

export type ListActivitiesResponse = {
  activities: Activity[]
  nextPageToken?: string
}

export type ListSourcesResponse = {
  sources: Source[]
  nextPageToken?: string
}

export type JulesError = {
  error: {
    code: number
    message: string
    status: string
  }
}
