import { describe, it, expect } from "bun:test"
import { Todo } from "../../src/session/todo"

describe("Todo Hierarchy", () => {
  const todos: Todo.Info[] = [
    { id: "1", content: "Root Task 1", status: "pending", priority: "high" },
    { id: "2", content: "Root Task 2", status: "pending", priority: "medium" },
    { id: "3", content: "Child of Task 1", status: "pending", priority: "medium", parentId: "1" },
    { id: "4", content: "Child of Task 1 (2)", status: "completed", priority: "low", parentId: "1" },
    { id: "5", content: "Grandchild of Task 1", status: "in_progress", priority: "high", parentId: "3" },
  ]

  it("should get root tasks only", () => {
    const roots = Todo.getRootTasks(todos)
    expect(roots.length).toBe(2)
    expect(roots[0].id).toBe("1")
    expect(roots[1].id).toBe("2")
  })

  it("should get children of a parent", () => {
    const children = Todo.getChildren(todos, "1")
    expect(children.length).toBe(2)
    expect(children[0].id).toBe("3")
    expect(children[1].id).toBe("4")
  })

  it("should calculate depth correctly", () => {
    expect(Todo.getDepth(todos, "1")).toBe(0) // Root
    expect(Todo.getDepth(todos, "2")).toBe(0) // Root
    expect(Todo.getDepth(todos, "3")).toBe(1) // Child
    expect(Todo.getDepth(todos, "5")).toBe(2) // Grandchild
  })

  it("should detect if task has children", () => {
    expect(Todo.hasChildren(todos, "1")).toBe(true)
    expect(Todo.hasChildren(todos, "3")).toBe(true)
    expect(Todo.hasChildren(todos, "2")).toBe(false)
    expect(Todo.hasChildren(todos, "4")).toBe(false)
    expect(Todo.hasChildren(todos, "5")).toBe(false)
  })

  it("should handle empty todo list", () => {
    expect(Todo.getRootTasks([])).toEqual([])
    expect(Todo.getChildren([], "1")).toEqual([])
    expect(Todo.hasChildren([], "1")).toBe(false)
  })
})
