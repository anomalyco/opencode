import React from "react"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"

interface TodoItem {
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority?: "high" | "medium" | "low"
}

interface TodoListRendererProps {
  todos: TodoItem[]
}

export const TodoListRenderer: React.FC<TodoListRendererProps> = ({ todos }) => {
  const getCheckboxIcon = (status: string) => {
    switch (status) {
      case "completed":
        return "check-square"
      case "in_progress":
        return "square"
      case "cancelled":
        return "x-square"
      default:
        return "square"
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "success"
      case "in_progress":
        return "accent"
      case "cancelled":
        return "muted"
      default:
        return "muted"
    }
  }

  return (
    <Box background="lightest" rounded="lg" p="sm" gap="xs" mode="warning">
      <Box direction="row" alignItems="center" gap="xs" pb="xs">
        <Icon icon={Feather} name="list" size={14} color="warning" />
        <Text size="sm" weight="medium">
          Plan
        </Text>
      </Box>
      <Box gap="sm">
        {todos.map((todo, index) => (
          <Box key={index} direction="row" alignItems="flex-start" gap="sm">
            <Icon
              icon={Feather}
              name={getCheckboxIcon(todo.status) as any}
              size={14}
              color={getStatusColor(todo.status) as any}
              style={{ marginTop: 2, flexShrink: 0 }}
            />
            <Text size="sm" style={{ flex: 1, lineHeight: 20 }}>
              {todo.content}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
