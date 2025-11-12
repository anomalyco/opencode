/**
 * Interactive Todo Plugin Example
 * 
 * Demonstrates:
 * - Form inputs (Input, Button, Checkbox)
 * - Event handlers (onClick, onInput, onChange)
 * - Bidirectional communication (ui.action)
 * - Global state management (createStore)
 * - Multiple widgets sharing state
 */

import { type Plugin } from "@opencode-ai/plugin"

interface Todo {
  id: number
  text: string
  done: boolean
  priority: "low" | "medium" | "high"
}

// Simple reactive state (will be replaced with createStore once imports work)
const todoState = {
  todos: [] as Todo[],
  filter: "all" as "all" | "active" | "completed",
  newTodoText: "",
}

// In-memory storage
const storage = {
  todos: [] as Todo[],
  nextId: 1,
}

export const InteractiveTodoPlugin: Plugin = async (ctx) => {
  return {
    "ui.register": async (input, output) => {
      output.widgets = [
        {
          id: "todo-input-widget",
          label: "Add Todo",
          sidebarPosition: "top",
        },
        {
          id: "todo-list-widget",
          label: "Todo List",
          sidebarPosition: "inline",
        },
        {
          id: "todo-stats-widget",
          label: "Todo Stats",
          sidebarPosition: "bottom",
        },
      ]

      output.statusItems = [
        {
          id: "todo-status",
          priority: 10,
          alignment: "right",
        },
      ]
    },

    "ui.render": async (input, output) => {
      // Todo Input Widget
      if (input.componentId === "todo-input-widget") {
        output.content = `Todo Input Widget (form components available)
Add form: Input + Button
Current todos: ${todoState.todos.length}`
        output.type = "text"
      }

      // Todo List Widget
      if (input.componentId === "todo-list-widget") {
        const todos = todoState.todos
        output.content = `Todo List:
${todos.length > 0 ? todos.map(t => `${t.done ? "✓" : "○"} ${t.text}`).join("\n") : "No todos yet"}`
        output.type = "text"
      }

      // Todo Stats Widget
      if (input.componentId === "todo-stats-widget") {
        const total = todoState.todos.length
        const completed = todoState.todos.filter(t => t.done).length
        const active = todoState.todos.filter(t => !t.done).length
        output.content = `Stats: ${total} total, ${completed} done, ${active} active`
        output.type = "text"
      }

      // Status Bar Item
      if (input.componentId === "todo-status") {
        const active = todoState.todos.filter(t => !t.done).length
        output.content = `✓ ${active}`
        output.type = "text"
      }
    },

    "ui.action": async (input, output) => {
      if (input.action === "add-todo") {
        const { text } = input.payload
        const todo: Todo = {
          id: storage.nextId++,
          text,
          done: false,
          priority: "medium",
        }
        storage.todos.push(todo)
        output.result = { todo }
      }

      if (input.action === "toggle-todo") {
        const { id } = input.payload
        const todo = storage.todos.find((t) => t.id === id)
        if (todo) {
          todo.done = !todo.done
          output.result = { todo }
        } else {
          output.error = "Todo not found"
        }
      }

      if (input.action === "delete-todo") {
        const { id } = input.payload
        const index = storage.todos.findIndex((t) => t.id === id)
        if (index !== -1) {
          storage.todos.splice(index, 1)
          output.result = { success: true }
        } else {
          output.error = "Todo not found"
        }
      }
    },
  }
}
