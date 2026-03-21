import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import * as schema from "./src/storage/schema"

// Connect to database
const sqlite = new Database("/root/.local/share/opencode/opencode-local.db")
const db = drizzle({ client: sqlite, schema })

console.log("Database connected successfully")

// First create a project
db.insert(schema.ProjectTable).values({
  id: "test-project",
  worktree: "/tmp/test",
  vcs: "git",
  name: "Test Project",
  time_created: Date.now(),
  time_updated: Date.now(),
  sandboxes: "[]",
}).run()

console.log("Project created successfully")

// Then create a session
db.insert(schema.SessionTable).values({
  id: "test-session",
  project_id: "test-project",
  slug: "test-session",
  directory: "/tmp/test",
  title: "Test Session",
  version: "1.0.0",
  time_created: Date.now(),
  time_updated: Date.now(),
}).run()

console.log("Session created successfully")

// Now insert a todo
db.insert(schema.TodoTable).values({
  id: "test-todo-1",
  session_id: "test-session",
  content: "Test todo item",
  status: "pending",
  priority: "medium",
  position: 0,
  time_created: Date.now(),
  time_updated: Date.now(),
}).run()

console.log("Todo inserted successfully")

// Query todos
const todos = db.select().from(schema.TodoTable).all()
console.log("Todos:", todos)

// Test with parent_id and depends_on
db.insert(schema.TodoTable).values({
  id: "test-todo-2",
  session_id: "test-session",
  content: "Child todo item",
  status: "pending",
  priority: "medium",
  parent_id: "test-todo-1",
  depends_on: ["test-todo-1"],
  position: 1,
  time_created: Date.now(),
  time_updated: Date.now(),
}).run()

console.log("Child todo inserted successfully")

const allTodos = db.select().from(schema.TodoTable).all()
console.log("All todos:", allTodos)

sqlite.close()
console.log("Test completed successfully!")