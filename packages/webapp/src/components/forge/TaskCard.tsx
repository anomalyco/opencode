import { Show } from "solid-js"
import type { ForgeTask } from "../../types/forge"

interface TaskCardProps {
  task: ForgeTask
  onClick?: () => void
  onDragStart?: () => void
  onDragEnd?: () => void
}

/**
 * Priority colors
 */
const PRIORITY_COLORS = {
  low: "text-gray-400",
  medium: "text-blue-400",
  high: "text-orange-400",
  urgent: "text-red-400",
}

/**
 * Priority icons
 */
const PRIORITY_ICONS = {
  low: "→",
  medium: "↑",
  high: "↑↑",
  urgent: "!!!",
}

/**
 * Task type icons
 */
const TASK_TYPE_ICONS = {
  feature: "✨",
  bug: "🐛",
  refactor: "♻️",
  docs: "📝",
  test: "🧪",
  chore: "🔧",
}

export function TaskCard(props: TaskCardProps) {
  /**
   * Format date to relative time
   */
  function formatDate(timestamp: number): string {
    const now = Date.now()
    const diff = now - timestamp
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return "just now"
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    return `${days}d ago`
  }

  /**
   * Get progress bar color based on progress
   */
  function getProgressColor(progress: number): string {
    if (progress === 0) return "bg-gray-600"
    if (progress < 30) return "bg-red-500"
    if (progress < 70) return "bg-yellow-500"
    return "bg-green-500"
  }

  return (
    <div
      class="group relative p-3 bg-gray-750 rounded-lg border border-gray-600 hover:border-gray-500 cursor-pointer transition-all hover:shadow-lg"
      draggable={true}
      onClick={props.onClick}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
    >
      {/* Task header */}
      <div class="flex items-start justify-between gap-2 mb-2">
        <div class="flex items-center gap-2">
          <span class="text-lg">{TASK_TYPE_ICONS[props.task.type]}</span>
          <span class={`text-xs font-semibold ${PRIORITY_COLORS[props.task.priority]}`}>
            {PRIORITY_ICONS[props.task.priority]}
          </span>
        </div>
        <span class="text-xs text-gray-500">#{props.task.id.slice(0, 8)}</span>
      </div>

      {/* Task title */}
      <h4 class="text-sm font-semibold text-white mb-2 line-clamp-2">
        {props.task.title}
      </h4>

      {/* Task description */}
      <Show when={props.task.description}>
        <p class="text-xs text-gray-400 mb-3 line-clamp-2">
          {props.task.description}
        </p>
      </Show>

      {/* Progress bar */}
      <Show when={props.task.progress > 0}>
        <div class="mb-3">
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs text-gray-400">Progress</span>
            <span class="text-xs font-semibold text-white">{props.task.progress}%</span>
          </div>
          <div class="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div
              class={`h-full ${getProgressColor(props.task.progress)} transition-all`}
              style={{ width: `${props.task.progress}%` }}
            />
          </div>
        </div>
      </Show>

      {/* Steps indicator */}
      <Show when={props.task.steps.length > 0}>
        <div class="flex items-center gap-1 mb-2">
          <span class="text-xs text-gray-400">
            {props.task.steps.filter((s) => s.status === "completed").length}/{props.task.steps.length} steps
          </span>
        </div>
      </Show>

      {/* Task metadata */}
      <div class="flex items-center justify-between text-xs text-gray-500">
        <div class="flex items-center gap-2">
          {/* Files changed */}
          <Show when={props.task.filesChanged.length > 0}>
            <span>📁 {props.task.filesChanged.length}</span>
          </Show>

          {/* Commits */}
          <Show when={props.task.commits.length > 0}>
            <span>💾 {props.task.commits.length}</span>
          </Show>

          {/* GitHub reference */}
          <Show when={props.task.githubIssue || props.task.githubPR}>
            <span>
              {props.task.githubIssue && `#${props.task.githubIssue}`}
              {props.task.githubPR && `PR#${props.task.githubPR}`}
            </span>
          </Show>
        </div>

        {/* Created time */}
        <span>{formatDate(props.task.createdAt)}</span>
      </div>

      {/* Assignee indicator */}
      <Show when={props.task.assignee}>
        <div class="absolute -top-2 -right-2 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-semibold text-white border-2 border-gray-800">
          {props.task.assignee![0].toUpperCase()}
        </div>
      </Show>

      {/* Blocked indicator */}
      <Show when={props.task.status === "blocked" && props.task.blockedReason}>
        <div class="mt-2 p-2 bg-red-900/30 border border-red-700 rounded text-xs text-red-300">
          <span class="font-semibold">Blocked:</span> {props.task.blockedReason}
        </div>
      </Show>
    </div>
  )
}
