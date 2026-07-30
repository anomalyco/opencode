import { Layer.effectDiscard } from "effect"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { TaskRegistry } from "@opencode-ai/core/session/task-registry"

const layer = Layer.effectDiscard(
  Effect.gen(function*() {
    const taskRegistry = yield* TaskRegistry.Service
    const events = yield* SessionEvent.Service

    // Sync task state during reasoning cycles
    yield* events.subscribe(SessionEvent.ReasoningCycle.Fired, async (event) => {
      const sessionID = event.payload.sessionID
      const taskState = await taskRegistry.getTaskState(sessionID)
      
      // Task alignment check
      const alignmentResult = await taskRegistry.validateSessionTaskState(sessionID)
    })
    
    // Forward-project task outcomes like a Then Loop
    yield* events.subscribe(SessionEvent.ToolCall, async (event) => {
      const { sessionID } = event.payload
      const tool = event.payload.tool
      const result = event.payload.result
      const changed = event.payload.providerExecuted
      
      if (changed) {
        await taskRegistry.syncTasksWithToolResult(sessionID, tool, result)
        
        const tasks = await taskRegistry.getActiveTasks(sessionID)
        if (tasks.length > 0) {
          await taskRegistry.projectTaskOutcomes(sessionID, 3)
        }
      }
    })
  })
)

export const TaskReflectionBridge = { layer }