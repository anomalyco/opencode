import React from "react"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"

interface Todo {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority: "low" | "medium" | "high"
}

interface TodoReadRendererProps {
  todos: Todo[]
}

export const TodoReadRenderer: React.FC<TodoReadRendererProps> = ({ todos }) => {
  const getStatusIcon = (status: Todo["status"]) => {
    switch (status) {
      case "completed":
        return { name: "check-circle" as const, color: "success" as const }
      case "in_progress":
        return { name: "clock" as const, color: "warning" as const }
      case "cancelled":
        return { name: "x-circle" as const, color: "error" as const }
      default:
        return { name: "circle" as const, color: "muted" as const }
    }
  }

  const getPriorityColor = (priority: Todo["priority"]) => {
    switch (priority) {
      case "high":
        return "error"
      case "medium":
        return "warning"
      default:
        return "muted"
    }
  }

  const statusCounts = todos.reduce(
    (acc, todo) => {
      acc[todo.status] = (acc[todo.status] || 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )

  return (
    <Box background="darker" rounded="lg" p="sm" gap="xs" mode="secondary">
      <Box direction="row" alignItems="center" gap="xs" pb="xs">
        <Icon icon={Feather} name="list" size={14} color="info" />
        <Text size="sm" weight="medium" mode="subtle">
          Todo List ({todos.length} items)
        </Text>
      </Box>

      <Box direction="row" gap="md" pb="xs">
        {Object.entries(statusCounts).map(([status, count]) => (
          <Box key={status} direction="row" alignItems="center" gap="xs">
            <Icon
              icon={Feather}
              name={getStatusIcon(status as Todo["status"]).name}
              size={10}
              color={getStatusIcon(status as Todo["status"]).color}
            />
            <Text size="xs" mode="subtle" style={{ textTransform: "capitalize" }}>
              {status.replace("_", " ")}: {count}
            </Text>
          </Box>
        ))}
      </Box>

      <Box gap="xs">
        {todos.map((todo) => {
          const statusIcon = getStatusIcon(todo.status)
          return (
            <Box key={todo.id} direction="row" alignItems="flex-start" gap="xs" p="xs">
              <Icon icon={Feather} name={statusIcon.name} size={12} color={statusIcon.color} style={{ marginTop: 2 }} />
              <Box style={{ flex: 1 }} gap="xs">
                <Text
                  size="xs"
                  mode="subtle"
                  style={{
                    textDecorationLine: todo.status === "completed" ? "line-through" : "none",
                    opacity: todo.status === "completed" ? 0.6 : 1,
                  }}
                >
                  {todo.content}
                </Text>
                <Box direction="row" alignItems="center" gap="xs">
                  <Box
                    background="subtle"
                    rounded="sm"
                    p="xs"
                    style={{ borderLeftWidth: 2, borderLeftColor: getPriorityColor(todo.priority) }}
                  >
                    {" "}
                    <Text size="xs" mode="subtle" style={{ fontSize: 10 }}>
                      {todo.priority}
                    </Text>
                  </Box>
                  <Text size="xs" mode="subtle" style={{ fontSize: 10, opacity: 0.6 }}>
                    #{todo.id}
                  </Text>
                </Box>
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
