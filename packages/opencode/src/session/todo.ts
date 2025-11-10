import z from "zod"
import { Bus } from "../bus"
import { Storage } from "../storage/storage"

export namespace Todo {
  export const Info = z
    .object({
      content: z.string().describe("Brief description of the task"),
      status: z.string().describe("Current status of the task: pending, in_progress, completed, cancelled"),
      priority: z.string().describe("Priority level of the task: high, medium, low"),
      id: z.string().describe("Unique identifier for the todo item"),
      parentId: z.string().optional().describe("ID of parent task if this is a subtask"),
    })
    .meta({ ref: "Todo" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: Bus.event(
      "todo.updated",
      z.object({
        sessionID: z.string(),
        todos: z.array(Info),
      }),
    ),
  }

  export async function update(input: { sessionID: string; todos: Info[] }) {
    const todosWithInferredParents = inferParentIds(input.todos)
    await Storage.write(["todo", input.sessionID], todosWithInferredParents)
    Bus.publish(Event.Updated, { sessionID: input.sessionID, todos: todosWithInferredParents })
  }

  export async function get(sessionID: string) {
    return Storage.read<Info[]>(["todo", sessionID])
      .then((x) => x || [])
      .catch(() => [])
  }

  export function getChildren(todos: Info[], parentId: string): Info[] {
    return todos.filter((todo) => todo.parentId === parentId)
  }

  export function getRootTasks(todos: Info[]): Info[] {
    return todos.filter((todo) => !todo.parentId)
  }

  export function getDepth(todos: Info[], taskId: string): number {
    const task = todos.find((t) => t.id === taskId)
    if (!task || !task.parentId) return 0
    return 1 + getDepth(todos, task.parentId)
  }

  export function hasChildren(todos: Info[], taskId: string): boolean {
    return todos.some((todo) => todo.parentId === taskId)
  }

  /**
   * Extracts hierarchical number prefix from todo content (e.g., "1.2.3" from "1.2.3 do something")
   */
  function extractNumberPrefix(content: string): string | null {
    const match = content.match(/^(\d+(\.\d+)*)\s/)
    return match ? match[1] : null
  }

  /**
   * Determines if numberB is a child of numberA based on hierarchical numbering
   * Examples: "1.2" is child of "1", "1.2.3" is child of "1.2"
   */
  function isChildNumber(parent: string, child: string): boolean {
    return child.startsWith(parent + ".") && child.split(".").length === parent.split(".").length + 1
  }

  /**
   * Auto-detects parent relationships based on hierarchical numbering (e.g., 1.0, 1.1, 1.1.1)
   */
  export function inferParentIds(todos: Info[]): Info[] {
    const todosWithNumbers = todos.map((todo) => ({
      todo,
      number: extractNumberPrefix(todo.content),
    }))

    return todos.map((todo) => {
      // If already has explicit parentId, keep it
      if (todo.parentId) return todo

      const todoNumber = extractNumberPrefix(todo.content)
      if (!todoNumber) return todo

      // Find potential parent based on numbering
      const parent = todosWithNumbers.find(
        ({ todo: potentialParent, number }) =>
          number && potentialParent.id !== todo.id && isChildNumber(number, todoNumber),
      )

      if (parent) {
        return { ...todo, parentId: parent.todo.id }
      }

      return todo
    })
  }
}
