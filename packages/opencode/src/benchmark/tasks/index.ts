export { RefactorTask } from "./refactor"

/**
 * Available benchmark tasks
 */
export const AVAILABLE_TASKS = ["refactor"] as const
export type TaskName = (typeof AVAILABLE_TASKS)[number]

/**
 * Get task configuration by name
 */
export async function getTask(name: TaskName): Promise<{
  setup: () => Promise<string>
  cleanup: (dir: string) => Promise<void>
  prompt: string
  verify?: (dir: string) => Promise<{ success: boolean; issues: string[] }>
}> {
  switch (name) {
    case "refactor": {
      const { RefactorTask } = await import("./refactor")
      return {
        setup: RefactorTask.setup,
        cleanup: RefactorTask.cleanup,
        prompt: RefactorTask.TASK_PROMPT,
        verify: RefactorTask.verify,
      }
    }
    default:
      throw new Error(`Unknown task: ${name}`)
  }
}
