import { For, Show, createSignal } from "solid-js"
import { tasks, stats } from "../../stores/forge"
import type { ForgeTask, TaskStatus } from "../../types/forge"
import { TaskCard } from "./TaskCard"

/**
 * Kanban columns configuration
 */
const COLUMNS: Array<{ status: TaskStatus; label: string; color: string }> = [
  { status: "backlog", label: "Backlog", color: "bg-gray-600" },
  { status: "todo", label: "To Do", color: "bg-blue-600" },
  { status: "in_progress", label: "In Progress", color: "bg-yellow-600" },
  { status: "review", label: "Review", color: "bg-purple-600" },
  { status: "testing", label: "Testing", color: "bg-orange-600" },
  { status: "blocked", label: "Blocked", color: "bg-red-600" },
  { status: "done", label: "Done", color: "bg-green-600" },
  { status: "cancelled", label: "Cancelled", color: "bg-gray-500" },
]

interface KanbanBoardProps {
  onTaskClick?: (task: ForgeTask) => void
}

export function KanbanBoard(props: KanbanBoardProps) {
  const [draggedTask, setDraggedTask] = createSignal<ForgeTask | null>(null)
  const [dragOverColumn, setDragOverColumn] = createSignal<TaskStatus | null>(null)

  /**
   * Get tasks for a specific column
   */
  function getTasksForColumn(status: TaskStatus): ForgeTask[] {
    return tasks().filter((task) => task.status === status)
  }

  /**
   * Handle drag start
   */
  function handleDragStart(task: ForgeTask) {
    setDraggedTask(task)
  }

  /**
   * Handle drag over column
   */
  function handleDragOver(e: DragEvent, status: TaskStatus) {
    e.preventDefault()
    setDragOverColumn(status)
  }

  /**
   * Handle drag leave column
   */
  function handleDragLeave() {
    setDragOverColumn(null)
  }

  /**
   * Handle drop on column
   */
  async function handleDrop(e: DragEvent, status: TaskStatus) {
    e.preventDefault()
    setDragOverColumn(null)

    const task = draggedTask()
    if (!task) return

    // Don't update if dropped on same column
    if (task.status === status) {
      setDraggedTask(null)
      return
    }

    // Update task status
    try {
      const { updateTask } = await import("../../stores/forge")
      await updateTask(task.id, { status })
      setDraggedTask(null)
    } catch (error) {
      console.error("Failed to update task status:", error)
      setDraggedTask(null)
    }
  }

  /**
   * Handle drag end
   */
  function handleDragEnd() {
    setDraggedTask(null)
    setDragOverColumn(null)
  }

  return (
    <div class="flex flex-col h-full bg-gray-900">
      {/* Header with stats */}
      <div class="flex items-center justify-between p-4 border-b border-gray-700">
        <h2 class="text-xl font-bold text-white">FORGE Task Board</h2>
        <div class="flex items-center gap-4 text-sm text-gray-400">
          <div>Total: <span class="text-white font-semibold">{stats().totalTasks}</span></div>
          <div>In Progress: <span class="text-yellow-400 font-semibold">{stats().tasksInProgress}</span></div>
          <div>Completed Today: <span class="text-green-400 font-semibold">{stats().tasksCompletedToday}</span></div>
        </div>
      </div>

      {/* Kanban columns */}
      <div class="flex-1 overflow-x-auto overflow-y-hidden">
        <div class="flex h-full gap-4 p-4 min-w-max">
          <For each={COLUMNS}>
            {(column) => {
              const columnTasks = () => getTasksForColumn(column.status)
              const isActive = () => dragOverColumn() === column.status

              return (
                <div
                  class="flex flex-col w-80 bg-gray-800 rounded-lg border border-gray-700 transition-colors"
                  classList={{
                    "border-blue-500 bg-gray-750": isActive(),
                  }}
                  onDragOver={(e) => handleDragOver(e, column.status)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, column.status)}
                >
                  {/* Column header */}
                  <div class="flex items-center justify-between p-3 border-b border-gray-700">
                    <div class="flex items-center gap-2">
                      <div class={`w-3 h-3 rounded-full ${column.color}`} />
                      <h3 class="font-semibold text-white">{column.label}</h3>
                    </div>
                    <span class="px-2 py-1 text-xs font-semibold text-gray-400 bg-gray-700 rounded-full">
                      {columnTasks().length}
                    </span>
                  </div>

                  {/* Column tasks */}
                  <div class="flex-1 overflow-y-auto p-3 space-y-3">
                    <Show
                      when={columnTasks().length > 0}
                      fallback={
                        <div class="flex items-center justify-center h-32 text-sm text-gray-500">
                          No tasks
                        </div>
                      }
                    >
                      <For each={columnTasks()}>
                        {(task) => (
                          <TaskCard
                            task={task}
                            onClick={() => props.onTaskClick?.(task)}
                            onDragStart={() => handleDragStart(task)}
                            onDragEnd={handleDragEnd}
                          />
                        )}
                      </For>
                    </Show>
                  </div>
                </div>
              )
            }}
          </For>
        </div>
      </div>
    </div>
  )
}
