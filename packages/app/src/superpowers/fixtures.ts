import type { NativeRecord } from "./native-types"

export function nativeFixture(): NativeRecord[] {
  return [
    {
      id: "root",
      title: "Root controller",
      directory: "/root/git/demo",
      status: "running",
      needsInput: false,
      model: { id: "gpt-5-codex", providerID: "openai" },
    },
    {
      id: "child",
      parentID: "root",
      title: "Child implementer",
      directory: "/root/git/demo/.worktrees/feature",
      status: "running",
      needsInput: false,
    },
    {
      id: "idle-child",
      parentID: "root",
      title: "Idle reviewer",
      directory: "/root/git/demo",
      status: "idle",
      needsInput: false,
      model: { id: "claude-sonnet-4", providerID: "anthropic" },
    },
    {
      id: "grandchild",
      parentID: "child",
      title: "Grandchild worker",
      directory: "/root/git/demo/.worktrees/feature",
      status: "idle",
      needsInput: false,
    },
  ]
}
