import type * as Effect from "effect/Effect"
import type { Driver } from "opencode-drive/driver"
import { executableScenario } from "../catalog/flow"
import { patchSuccessFlow } from "./tools/patch-success"
import { shellLifecycleFlow } from "./tools/shell-lifecycle"
import { subagentLifecycleFlow } from "./subagents/subagent-lifecycle"
import { searchLifecycleFlow } from "./tools/search-lifecycle"
import { webLifecycleFlow } from "./tools/web-lifecycle"
import { assistantLifecycleFlow } from "./responses/assistant-lifecycle"
import { questionLifecycleFlow } from "./tools/question-lifecycle"
import { readLifecycleFlow } from "./tools/read-lifecycle"
import { patchFileChangesFlow } from "./tools/patch-file-changes"
import { sessionTabsFlow } from "./session-tabs"

export const executableScenarios = [
  executableScenario(patchSuccessFlow),
  executableScenario(shellLifecycleFlow),
  executableScenario(subagentLifecycleFlow, { llmMode: "serve" }),
  executableScenario(searchLifecycleFlow),
  executableScenario(webLifecycleFlow),
  executableScenario(assistantLifecycleFlow, { clientIsolation: "isolated" }),
  executableScenario(questionLifecycleFlow, { clientIsolation: "isolated" }),
  executableScenario(readLifecycleFlow, { clientIsolation: "isolated" }),
  executableScenario(patchFileChangesFlow),
  executableScenario(sessionTabsFlow, { clientIsolation: "isolated" }),
] as const

export const executableFlows = executableScenarios.map((scenario) => scenario.flow)

type RegisteredFlow = typeof executableFlows[number]
type RegisteredState = RegisteredFlow["states"][number]
type StateStep<State extends RegisteredState> = {
  readonly capture: State["id"]
} & State["metadata"]["step"]
type FlowSteps<Flow extends RegisteredFlow> = Flow["states"] extends readonly [
  infer First extends RegisteredState,
  ...infer Rest extends ReadonlyArray<RegisteredState>,
]
  ? readonly [StateStep<First>, ...{ readonly [Index in keyof Rest]: StateStep<Rest[Index]> }]
  : never

export const executableScreens = Object.fromEntries(
  executableFlows.flatMap((flow) =>
    flow.states.map((state) => [state.id, state.metadata.screen] as const),
  ),
) as {
  readonly [State in RegisteredState as State["id"]]: State["metadata"]["screen"]
}

export function executableFlowDefinitions<const GroupId extends RegisteredFlow["group"]["id"]>(groupId: GroupId) {
  return Object.fromEntries(
    executableFlows
      .filter((flow) => flow.group.id === groupId)
      .map((flow) => [flow.id, {
        title: flow.title,
        description: flow.description,
        replayable: true as const,
        steps: flow.states.map((state) => ({ capture: state.id, ...state.metadata.step })),
      }]),
  ) as unknown as {
    readonly [Flow in RegisteredFlow as Flow["group"]["id"] extends GroupId ? Flow["id"] : never]: {
      readonly title: Flow["title"]
      readonly description: Flow["description"]
      readonly replayable: true
      readonly steps: FlowSteps<Flow>
    }
  }
}

export const executableStates = executableScenarios.flatMap((scenario) =>
  scenario.states.map((state) => ({
    address: state.address,
    run: (driver: Driver, capture: () => Effect.Effect<void, unknown>) =>
      scenario.run({ driver, through: state.id, capture }),
  })),
)
