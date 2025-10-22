import { resolve, relative } from "node:path"

import { tool } from "./tool"
import type { Plugin } from "./index"

type DirectoryState = {
  virtualDirectory: string
  lastReminder: number
}

const directoryStateMap = new Map<string, DirectoryState>()
const REMINDER_INTERVAL = 5 * 60 * 1000

function getDirectoryState(sessionID: string, projectDirectory: string): DirectoryState {
  const existing = directoryStateMap.get(sessionID)
  if (existing) return existing

  const state: DirectoryState = {
    virtualDirectory: projectDirectory,
    lastReminder: Date.now(),
  }
  directoryStateMap.set(sessionID, state)
  return state
}

function resolveVirtualDirectory(currentDir: string, target: string, projectRoot: string): string {
  const resolved = resolve(currentDir, target)
  const relativePath = relative(projectRoot, resolved)

  if (relativePath.startsWith("..") || resolve(projectRoot, relativePath) !== resolved) {
    return projectRoot
  }

  return resolved
}

function parseCDCommand(command: string): string | null {
  const trimmed = command.trim()
  const cdMatch = trimmed.match(/^(?:cd|chdir)\s+(.+?)(?:\s*&&|\s*;|\s*$)/)
  if (!cdMatch) return null

  const pathArg = cdMatch[1].trim()

  if ((pathArg.startsWith('"') && pathArg.endsWith('"')) || (pathArg.startsWith("'") && pathArg.endsWith("'"))) {
    return pathArg.slice(1, -1)
  }

  return pathArg
}

function extractBashCommand(command: string): string {
  const parts = command.split(/&&|;/)
  return parts[0].trim()
}

function shouldShowReminder(state: DirectoryState): boolean {
  const now = Date.now()
  return now - state.lastReminder > REMINDER_INTERVAL
}

function formatDirectoryPath(projectDirectory: string, virtualDirectory: string): string {
  const relativePath = relative(projectDirectory, virtualDirectory)
  return relativePath === "" ? "." : relativePath
}

function handleCDCommand(command: string, state: DirectoryState, projectDirectory: string, sessionID: string): string {
  const bashCommand = extractBashCommand(command)
  const cdTarget = parseCDCommand(bashCommand)

  if (cdTarget !== null) {
    const newVirtualDir = resolveVirtualDirectory(state.virtualDirectory, cdTarget, projectDirectory)
    const newState = { ...state, virtualDirectory: newVirtualDir }
    directoryStateMap.set(sessionID, newState)

    const remainingCommand = command.replace(bashCommand, "").trim()
    return remainingCommand
  }

  return command
}

export const DirectoryAwarenessPlugin: Plugin = async (ctx) => {
  const projectDirectory = ctx.directory

  return {
    tool: {
      pwd: tool({
        description: "Show current virtual working directory",
        args: {},
        async execute(_args, context) {
          const state = getDirectoryState(context.sessionID, projectDirectory)
          const displayPath = formatDirectoryPath(projectDirectory, state.virtualDirectory)
          return `Current virtual directory: ${displayPath} (${state.virtualDirectory})`
        },
      }),
    },

    async "tool.execute.before"(input, output) {
      if (input.tool !== "bash") return

      const state = getDirectoryState(input.sessionID, projectDirectory)
      const args = output.args as Record<string, unknown>
      const command = (args.command as string) || ""

      const updatedCommand = handleCDCommand(command, state, projectDirectory, input.sessionID)
      if (updatedCommand !== command) {
        args.command = updatedCommand
      }

      args.cwd = state.virtualDirectory
    },

    async "tool.execute.after"(input, output) {
      if (input.tool !== "bash") return

      const state = getDirectoryState(input.sessionID, projectDirectory)

      if (shouldShowReminder(state)) {
        const displayPath = formatDirectoryPath(projectDirectory, state.virtualDirectory)
        output.output += `\n\n💡 Directory Reminder: You are in virtual directory "${displayPath}"`
        const updatedState = { ...state, lastReminder: Date.now() }
        directoryStateMap.set(input.sessionID, updatedState)
      }
    },
  }
}
