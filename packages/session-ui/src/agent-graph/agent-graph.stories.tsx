import type { SessionID, SessionInfo, SessionMessageAssistant } from "@opencode/client/promise"
import { createMemo, createSignal, type JSX } from "solid-js"
import { AgentGraph, type AgentGraphMessageSelection } from "./agent-graph"
import { AgentGraphDetail, type AgentGraphLogs } from "./agent-graph-detail"
import { agentGraph, type TunnelMessage } from "./model"
import { storyTool } from "../storybook/current-session-scenarios"
import { CURRENT_SESSION_ID, STORY_MODEL, STORY_TIME } from "../storybook/current-session-fixtures"

export default {
  title: "OpenCode/Work/Agent graph",
  id: "session-agent-graph",
  component: AgentGraph,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The Session family graph: spawn links and directed agent messages. Spawn edges link parents to children; message arcs are clickable and show their conversation.",
      },
    },
  },
}

const agents = [
  { id: "build", name: "Build", color: "#4a6cf7" },
  { id: "explore", name: "Explore", color: "#e0a83c" },
  { id: "review", name: "Review", color: "#3fa36c" },
  { id: "test", name: "Test", color: "#9a6cf0" },
  { id: "plan", name: "Plan", color: "#d9598f" },
]

function storySession(input: {
  id: SessionID
  parentID?: SessionID
  title?: string
  agent?: string
  tokens?: number
  cost?: number
  offset?: number
}): SessionInfo {
  return {
    id: input.id,
    parentID: input.parentID,
    projectID: "project_story",
    agent: input.agent,
    model: STORY_MODEL,
    cost: input.cost ?? 0,
    tokens: { input: input.tokens ?? 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: STORY_TIME + (input.offset ?? 0), updated: STORY_TIME + (input.offset ?? 0) + 5_000 },
    title: input.title,
    location: { directory: "/workspaces/story" },
  }
}

/** The spawn call that created a child Session, so spawn edges carry agent and description labels. */
function subagentCall(input: { id: string; agent: string; description: string; child: SessionID; offset: number }): SessionMessageAssistant {
  return {
    id: input.id,
    type: "assistant",
    agent: "build",
    model: STORY_MODEL,
    content: [
      storyTool(input.id, "subagent", "completed", { agent: input.agent, description: input.description }, {
        metadata: { sessionID: input.child },
      }),
    ],
    time: { created: STORY_TIME + input.offset, ran: STORY_TIME + input.offset + 100, completed: STORY_TIME + input.offset + 200 },
  } satisfies SessionMessageAssistant
}

/** The tunnel message's sender or recipient, with the agent named only when the Session had one. */
function endpoint(sessionID: SessionID, agent: string | undefined) {
  return agent ? { sessionID, agent } : { sessionID }
}

const message = (input: {
  id: string
  from: SessionID
  fromAgent?: string
  to: SessionID
  toAgent?: string
  kind: "message" | "report"
  body: string
  offset: number
  sequence: number
}): TunnelMessage => ({
  id: input.id,
  from: endpoint(input.from, input.fromAgent),
  to: endpoint(input.to, input.toAgent),
  kind: input.kind,
  body: input.body,
  time: { created: STORY_TIME + input.offset },
  sequence: input.sequence,
})

function GraphStory(props: { title: string; description: string; children: JSX.Element }) {
  return (
    <section class="mx-auto flex w-full flex-col gap-4 p-6" style={{ "max-width": "960px" }}>
      <header class="flex items-start justify-between gap-4 border-b border-border-weak-base pb-3">
        <div class="min-w-0">
          <h1 class="text-16-medium text-text-strong">{props.title}</h1>
          <p class="mt-1 text-13-regular text-text-weak">{props.description}</p>
        </div>
      </header>
      <div class="overflow-hidden rounded-lg border border-border-weak-base bg-background-base p-6">{props.children}</div>
    </section>
  )
}

function singleRootGraph() {
  return agentGraph({
    sessions: [storySession({ id: CURRENT_SESSION_ID, title: "Design the release notes", agent: "build", tokens: 12_400, cost: 0.31 })],
    sessionID: CURRENT_SESSION_ID,
    status: () => "idle",
    agents,
  })
}

export const SingleRoot = {
  render: () => (
    <GraphStory
      title="Single root"
      description="A family with no subagents yet: one node, no edges."
    >
      <AgentGraph
        graph={singleRootGraph()}
        selectedNodeID={CURRENT_SESSION_ID}
        onSelectNode={() => {}}
        onSelectMessages={() => {}}
      />
    </GraphStory>
  ),
}

function orchestratorGraph() {
  const sessions = [
    storySession({ id: CURRENT_SESSION_ID, title: "Ship the update", agent: "build", tokens: 41_200, cost: 1.18 }),
    storySession({ id: "session_child_map", parentID: CURRENT_SESSION_ID, title: "Map the affected modules", agent: "explore", tokens: 8_300, cost: 0.22, offset: 40_000 }),
    storySession({ id: "session_child_review", parentID: CURRENT_SESSION_ID, title: "Review the open changes", agent: "review", tokens: 15_900, cost: 0.44, offset: 42_000 }),
    storySession({ id: "session_child_tests", parentID: CURRENT_SESSION_ID, title: "Run the test matrix", agent: "test", tokens: 6_100, cost: 0.17, offset: 44_000 }),
  ]

  const messages = new Map<SessionID, readonly SessionMessageAssistant[]>([
    [
      CURRENT_SESSION_ID,
      [
        subagentCall({ id: "msg_spawn_map", agent: "explore", description: "Map the affected modules", child: "session_child_map", offset: 39_000 }),
        subagentCall({ id: "msg_spawn_review", agent: "review", description: "Review the open changes", child: "session_child_review", offset: 41_000 }),
        subagentCall({ id: "msg_spawn_tests", agent: "test", description: "Run the test matrix", child: "session_child_tests", offset: 43_000 }),
      ],
    ],
  ])

  return agentGraph({
    sessions,
    sessionID: CURRENT_SESSION_ID,
    status: (id) => (id === CURRENT_SESSION_ID || id === "session_child_review" ? "running" : "idle"),
    agents,
    messages: (id) => messages.get(id) ?? [],
  })
}

export const OrchestratorWithRunningSubagents = {
  render: () => (
    <GraphStory
      title="Orchestrator with running subagents"
      description="A root Session running three subagents; running nodes carry an activity ring."
    >
      <AgentGraph
        graph={orchestratorGraph()}
        selectedNodeID={CURRENT_SESSION_ID}
        onSelectNode={() => {}}
        onSelectMessages={() => {}}
      />
    </GraphStory>
  ),
}

const chainSessionIDs = {
  root: "session_chain_root",
  child: "session_chain_child",
  grandchild: "session_chain_grand",
} as const

function deepChainInput() {
  const sessions = [
    storySession({ id: chainSessionIDs.root, title: "Audit the parser", agent: "build", tokens: 22_400, cost: 0.61 }),
    storySession({ id: chainSessionIDs.child, parentID: chainSessionIDs.root, title: "Trace the failing rule", agent: "explore", tokens: 9_800, cost: 0.27, offset: 60_000 }),
    storySession({ id: chainSessionIDs.grandchild, parentID: chainSessionIDs.child, title: "Reproduce the crash", agent: "test", tokens: 3_500, cost: 0.09, offset: 120_000 }),
  ]

  const messages = new Map<SessionID, readonly SessionMessageAssistant[]>([
    [chainSessionIDs.root, [subagentCall({ id: "msg_spawn_trace", agent: "explore", description: "Trace the failing rule", child: chainSessionIDs.child, offset: 59_000 })]],
    [chainSessionIDs.child, [subagentCall({ id: "msg_spawn_repro", agent: "test", description: "Reproduce the crash", child: chainSessionIDs.grandchild, offset: 119_000 })]],
  ])

  const tunnelMessages = [
    message({ id: "msg_tunnel_direction", from: chainSessionIDs.root, fromAgent: "build", to: chainSessionIDs.child, toAgent: "explore", kind: "message", body: "Start from the grammar rules, not the tokenizer.", offset: 70_000, sequence: 3 }),
    message({ id: "msg_tunnel_findings", from: chainSessionIDs.child, fromAgent: "explore", to: chainSessionIDs.grandchild, toAgent: "test", kind: "message", body: "The rule fails only when a comment contains an unmatched quote.", offset: 130_000, sequence: 5 }),
    message({ id: "msg_tunnel_report", from: chainSessionIDs.grandchild, fromAgent: "test", to: chainSessionIDs.child, toAgent: "explore", kind: "report", body: "Reproduced. Input `--flag 'unterminated` crashes rule 12 on line 44.", offset: 180_000, sequence: 7 }),
  ]

  return { sessions, messages, tunnelMessages }
}

function DeepChainStory() {
  const input = deepChainInput()

  const graph = createMemo(() =>
    agentGraph({
      sessions: input.sessions,
      sessionID: chainSessionIDs.root,
      status: () => "idle",
      agents,
      messages: (id) => input.messages.get(id) ?? [],
      tunnelMessages: input.tunnelMessages,
    }),
  )

  const [selectedNodeID, setSelectedNodeID] = createSignal<SessionID>()

  const [selectedPair, setSelectedPair] = createSignal<AgentGraphMessageSelection | undefined>({
    from: chainSessionIDs.child,
    to: chainSessionIDs.grandchild,
  })

  return (
    <GraphStory
      title="Completed deep chain"
      description="Three generations, message arrows between them, and the selected message's content."
    >
      <AgentGraph
        graph={graph()}
        messages={input.tunnelMessages}
        selectedNodeID={selectedNodeID()}
        selectedPair={selectedPair()}
        onSelectNode={setSelectedNodeID}
        onSelectMessages={setSelectedPair}
      />
    </GraphStory>
  )
}

export const CompletedDeepChain = { render: () => <DeepChainStory /> }

function ReportToParentStory() {
  const input = deepChainInput()

  const graph = createMemo(() =>
    agentGraph({
      sessions: input.sessions,
      sessionID: chainSessionIDs.root,
      status: () => "idle",
      agents,
      messages: (id) => input.messages.get(id) ?? [],
      tunnelMessages: input.tunnelMessages,
    }),
  )

  const [selectedPair, setSelectedPair] = createSignal<AgentGraphMessageSelection | undefined>({
    from: chainSessionIDs.grandchild,
    to: chainSessionIDs.child,
  })

  return (
    <GraphStory
      title="Report to parent"
      description="A report arc climbs back up the chain; the badge and arc mark the report kind."
    >
      <AgentGraph
        graph={graph()}
        messages={input.tunnelMessages}
        selectedPair={selectedPair()}
        onSelectNode={() => {}}
        onSelectMessages={setSelectedPair}
      />
    </GraphStory>
  )
}

export const ReportToParent = { render: () => <ReportToParentStory /> }

export const EmptyState = {
  render: () => (
    <GraphStory
      title="Empty state"
      description="A Session with no family to draw shows a placeholder instead of a graph."
    >
      <AgentGraph
        graph={agentGraph({ sessions: [], sessionID: undefined, status: () => "idle" })}
        onSelectNode={() => {}}
        onSelectMessages={() => {}}
      />
    </GraphStory>
  ),
}

const detailLogs: AgentGraphLogs = {
  status: "live",
  entries: [
    { id: "log_1", type: "session.created", time: STORY_TIME },
    { id: "log_2", type: "session.inbox.enqueued", time: STORY_TIME + 2_000 },
    { id: "log_3", type: "session.inbox.delivered", time: STORY_TIME + 2_400 },
    { id: "log_4", type: "session.tunnel.sent", time: STORY_TIME + 180_000 },
  ],
}

function NodeDetailStory() {
  const input = deepChainInput()

  const graph = createMemo(() =>
    agentGraph({
      sessions: input.sessions,
      sessionID: chainSessionIDs.root,
      status: (id) => (id === chainSessionIDs.child ? "running" : "idle"),
      agents,
      messages: (id) => input.messages.get(id) ?? [],
      tunnelMessages: input.tunnelMessages,
    }),
  )

  const [selectedNodeID, setSelectedNodeID] = createSignal<SessionID>(chainSessionIDs.child)

  const [opened, setOpened] = createSignal("No session opened")

  const node = createMemo(() => graph().nodes.find((node) => node.id === selectedNodeID()))

  const messages: readonly SessionMessageAssistant[] = [
    {
      id: "msg_detail_step",
      type: "assistant",
      agent: "explore",
      model: STORY_MODEL,
      content: [],
      time: { created: STORY_TIME + 61_000 },
      tokens: { input: 7_100, output: 2_400, reasoning: 0, cache: { read: 300, write: 0 } },
      cost: 0.21,
    },
  ]

  return (
    <section class="mx-auto flex w-full flex-col gap-4 p-6" style={{ "max-width": "960px" }}>
      <header class="border-b border-border-weak-base pb-3">
        <h1 class="text-16-medium text-text-strong">Selected node detail</h1>
        <p class="mt-1 text-13-regular text-text-weak">
          The selected node's identity, usage by agent, subtree roll-up, and the presentational log feed.
        </p>
      </header>
      <div class="flex gap-4 overflow-hidden rounded-lg border border-border-weak-base bg-background-base p-6">
        <div class="min-w-0 flex-1">
          <AgentGraph
            graph={graph()}
            messages={input.tunnelMessages}
            selectedNodeID={selectedNodeID()}
            onSelectNode={setSelectedNodeID}
            onSelectMessages={() => {}}
          />
        </div>
        <div class="w-[280px] shrink-0">
          <AgentGraphDetail
            node={node()}
            messages={messages}
            sessions={input.sessions}
            logs={detailLogs}
            onOpenSession={(id) => setOpened(`Opened ${id}`)}
          />
        </div>
      </div>
      <output class="text-12-regular text-text-weak">Story action: {opened()}</output>
    </section>
  )
}

export const NodeDetailWithLogs = { render: () => <NodeDetailStory /> }
