import { Layer, ManagedRuntime } from "effect"
import { attach, memoMap } from "./run-service"
import * as Observability from "./observability"

import { AppFileSystem } from "@opencode-ai/shared/filesystem"
import { Bus } from "@/bus"
import { Auth } from "@/auth"
import { Account } from "@/account/account"
import { Config } from "@/config"
import { Git } from "@/git"
import { Ripgrep } from "@/file/ripgrep"
import { FileTime } from "@/file/time"
import { File } from "@/file"
import { FileWatcher } from "@/file/watcher"
import { Storage } from "@/storage"
import { Snapshot } from "@/snapshot"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider"
import { ProviderAuth } from "@/provider"
import { Agent } from "@/agent/agent"
import { Skill } from "@/skill"
import { Discovery } from "@/skill/discovery"
import { Question } from "@/question"
import { Permission } from "@/permission"
import { Todo } from "@/session/todo"
import { Session } from "@/session"
import { SessionStatus } from "@/session/status"
import { SessionRunState } from "@/session/run-state"
import { SessionProcessor } from "@/session/processor"
import { SessionCompaction } from "@/session/compaction"
import { SessionRevert } from "@/session/revert"
import { SessionSummary } from "@/session/summary"
import { SessionPrompt } from "@/session/prompt"
import { Instruction } from "@/session/instruction"
import { LLM } from "@/session/llm"
import { LSP } from "@/lsp"
import { MCP } from "@/mcp"
import { McpAuth } from "@/mcp/auth"
import { Command } from "@/command"
import { Truncate } from "@/tool"
import { ToolRegistry } from "@/tool"
import { Format } from "@/format"
import { Project } from "@/project"
import { Vcs } from "@/project"
import { Worktree } from "@/worktree"
import { Pty } from "@/pty"
import { Installation } from "@/installation"
import { ShareNext } from "@/share"
import { SessionShare } from "@/share"
import { Npm } from "@opencode-ai/shared/npm"

export const AppLayer = Layer.mergeAll(
  Npm.defaultLayer,
  AppFileSystem.defaultLayer,
  Bus.defaultLayer,
  Auth.defaultLayer,
  Account.defaultLayer,
  Config.defaultLayer,
  Git.defaultLayer,
  Ripgrep.defaultLayer,
  FileTime.defaultLayer,
  File.defaultLayer,
  FileWatcher.defaultLayer,
  Storage.defaultLayer,
  Snapshot.defaultLayer,
  Plugin.defaultLayer,
  Provider.defaultLayer,
  ProviderAuth.defaultLayer,
  Agent.defaultLayer,
  Skill.defaultLayer,
  Discovery.defaultLayer,
  Question.defaultLayer,
  Permission.defaultLayer,
  Todo.defaultLayer,
  Session.defaultLayer,
  SessionStatus.defaultLayer,
  SessionRunState.defaultLayer,
  SessionProcessor.defaultLayer,
  SessionCompaction.defaultLayer,
  SessionRevert.defaultLayer,
  SessionSummary.defaultLayer,
  SessionPrompt.defaultLayer,
  Instruction.defaultLayer,
  LLM.defaultLayer,
  LSP.defaultLayer,
  MCP.defaultLayer,
  McpAuth.defaultLayer,
  Command.defaultLayer,
  Truncate.defaultLayer,
  ToolRegistry.defaultLayer,
  Format.defaultLayer,
  Project.defaultLayer,
  Vcs.defaultLayer,
  Worktree.defaultLayer,
  Pty.defaultLayer,
  Installation.defaultLayer,
  ShareNext.defaultLayer,
  SessionShare.defaultLayer,
).pipe(Layer.provideMerge(Observability.layer))

const rt = ManagedRuntime.make(AppLayer, { memoMap })
type Runtime = Pick<typeof rt, "runSync" | "runPromise" | "runPromiseExit" | "runFork" | "runCallback" | "dispose">
const wrap = (effect: Parameters<typeof rt.runSync>[0]) => attach(effect as never) as never

export const AppRuntime: Runtime = {
  runSync(effect) {
    return rt.runSync(wrap(effect))
  },
  runPromise(effect, options) {
    return rt.runPromise(wrap(effect), options)
  },
  runPromiseExit(effect, options) {
    return rt.runPromiseExit(wrap(effect), options)
  },
  runFork(effect) {
    return rt.runFork(wrap(effect))
  },
  runCallback(effect) {
    return rt.runCallback(wrap(effect))
  },
  dispose: () => rt.dispose(),
}
