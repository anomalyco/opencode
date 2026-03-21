import { Todo } from "./src/session/todo";
import { SessionID } from "./src/session/schema";

// Create a test session ID
const sessionId: SessionID = "test-session-1" as SessionID;

// Test creating todos
const todos = [
  {
    content: "Root task",
    status: "pending",
    priority: "high",
    parentId: undefined,
    dependsOn: [],
  },
  {
    content: "Subtask 1",
    status: "pending",
    priority: "medium",
    parentId: "todo-1",
    dependsOn: [],
  },
  {
    content: "Subtask 2",
    status: "pending",
    priority: "medium",
    parentId: "todo-1",
    dependsOn: ["todo-2"],
  },
];

// Add IDs to todos
const todosWithId = todos.map((todo, index) => ({
  ...todo,
  id: `todo-${index + 1}`,
}));

console.log("Testing todo update...");
Todo.update({ sessionID: sessionId, todos: todosWithId });
console.log("Todo update completed.");

console.log("Testing todo get...");
const retrievedTodos = Todo.get(sessionId);
console.log("Retrieved todos:", JSON.stringify(retrievedTodos, null, 2));