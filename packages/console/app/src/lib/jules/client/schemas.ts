import { z } from "zod"

// Session states
export const SessionState = z.enum([
  "STATE_UNSPECIFIED",
  "QUEUED",
  "PLANNING",
  "AWAITING_PLAN_APPROVAL",
  "AWAITING_USER_FEEDBACK",
  "IN_PROGRESS",
  "PAUSED",
  "FAILED",
  "COMPLETED",
])

export const AutomationMode = z.enum(["AUTOMATION_MODE_UNSPECIFIED", "AUTO_CREATE_PR"])

// GitHub types
export const GitHubBranch = z.object({
  displayName: z.string(),
})

export const GitHubRepo = z.object({
  owner: z.string(),
  repo: z.string(),
  isPrivate: z.boolean(),
  defaultBranch: GitHubBranch,
  branches: z.array(GitHubBranch),
})

export const GitHubRepoContext = z.object({
  startingBranch: z.string(),
})

export const SourceContext = z.object({
  source: z.string(),
  githubRepoContext: GitHubRepoContext.optional(),
})

// Source
export const Source = z.object({
  name: z.string(),
  id: z.string(),
  githubRepo: GitHubRepo,
})

// Plan
export const PlanStep = z.object({
  id: z.string(),
  index: z.number(),
  title: z.string(),
  description: z.string(),
})

export const Plan = z.object({
  id: z.string(),
  steps: z.array(PlanStep),
  createTime: z.string(),
})

// Artifacts
export const GitPatch = z.object({
  baseCommitId: z.string(),
  unidiffPatch: z.string(),
  suggestedCommitMessage: z.string(),
})

export const ChangeSet = z.object({
  source: z.string(),
  gitPatch: GitPatch,
})

export const BashOutput = z.object({
  command: z.string(),
  output: z.string(),
  exitCode: z.number(),
})

export const Media = z.object({
  mimeType: z.string(),
  data: z.string(),
})

export const Artifact = z.object({
  changeSet: ChangeSet.optional(),
  bashOutput: BashOutput.optional(),
  media: Media.optional(),
})

// Activity event types
export const PlanGenerated = z.object({
  plan: Plan,
})

export const PlanApproved = z.object({
  planId: z.string(),
})

export const UserMessaged = z.object({
  userMessage: z.string(),
})

export const AgentMessaged = z.object({
  agentMessage: z.string(),
})

export const ProgressUpdated = z.object({
  title: z.string(),
  description: z.string(),
})

export const SessionCompleted = z.object({})

export const SessionFailed = z.object({
  reason: z.string(),
})

// Activity
export const Activity = z.object({
  name: z.string(),
  id: z.string(),
  originator: z.string(),
  description: z.string(),
  createTime: z.string(),
  artifacts: z.array(Artifact).optional(),
  planGenerated: PlanGenerated.optional(),
  planApproved: PlanApproved.optional(),
  userMessaged: UserMessaged.optional(),
  agentMessaged: AgentMessaged.optional(),
  progressUpdated: ProgressUpdated.optional(),
  sessionCompleted: SessionCompleted.optional(),
  sessionFailed: SessionFailed.optional(),
})

// Session output
export const PullRequest = z.object({
  url: z.string(),
  title: z.string(),
  description: z.string(),
})

export const SessionOutput = z.object({
  pullRequest: PullRequest.optional(),
})

// Session
export const Session = z.object({
  name: z.string(),
  id: z.string(),
  prompt: z.string(),
  title: z.string().optional(),
  state: SessionState,
  url: z.string().optional(),
  sourceContext: SourceContext.optional(),
  outputs: z.array(SessionOutput).optional(),
  createTime: z.string(),
  updateTime: z.string(),
})

// Request bodies
export const CreateSessionBody = z.object({
  prompt: z.string().min(1),
  title: z.string().optional(),
  sourceContext: SourceContext.optional(),
  requirePlanApproval: z.boolean().optional(),
  automationMode: AutomationMode.optional(),
})

// List responses
export const ListSessionsResponse = z.object({
  sessions: z.array(Session),
  nextPageToken: z.string().optional(),
})

export const ListActivitiesResponse = z.object({
  activities: z.array(Activity),
  nextPageToken: z.string().optional(),
})

export const ListSourcesResponse = z.object({
  sources: z.array(Source),
  nextPageToken: z.string().optional(),
})

// Error response
export const JulesErrorResponse = z.object({
  error: z.object({
    code: z.number(),
    message: z.string(),
    status: z.string(),
  }),
})
