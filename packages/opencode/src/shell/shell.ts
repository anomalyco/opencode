import { z } from "zod"
import { Tool } from "../tool/tool"
import { getPersistentShell } from "./persistent"
import { getModeController, ExecutionMode } from "./mode"
import { Log } from "../util/log"
import { Permission } from "../permission"
import { Wildcard } from "../util/wildcard"
import { Agent } from "../agent/agent"

const log = Log.create({ service: "shell" })

const MAX_OUTPUT_LENGTH = 30_000
const DEFAULT_TIMEOUT = 1 * 60 * 1000
const MAX_TIMEOUT = 10 * 60 * 1000

/**
 * Enhanced shell tool with persistent state and mode support
 */
export const ShellTool = Tool.define("shell", {
  description: "Execute commands in a persistent shell with state management",
  parameters: z.object({
    command: z.string().describe("The command to execute"),
    timeout: z.number().describe("Optional timeout in milliseconds").optional(),
    mode: z.enum(["shell", "agent", "auto"]).optional().describe("Execution mode override"),
    description: z.string().describe("Clear, concise description of what this command does")
  }),
  
  async execute(params, ctx) {
    const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)
    const shell = getPersistentShell()
    const modeController = getModeController()
    
    // Check if we should route to shell or agent based on mode
    const effectiveMode = params.mode 
      ? (params.mode.charAt(0).toUpperCase() + params.mode.slice(1) as ExecutionMode)
      : modeController.getMode()
    
    // In Auto mode, determine routing
    if (effectiveMode === ExecutionMode.Auto) {
      const shouldUseShell = await modeController.shouldRouteToShell(params.command)
      
      if (!shouldUseShell) {
        // Route to agent - this would trigger the AI processing
        log.info("routing to agent", { command: params.command })
        // In the actual implementation, this would trigger the agent
        // For now, we'll just return a placeholder
        return {
          title: params.description,
          metadata: {
            command: params.command,
            workingDir: shell.getWorkingDir(),
            exitCode: 0,
            description: params.description,
            output: `[Would route to agent: ${params.command}]`
          },
          output: `[Would route to agent: ${params.command}]`
        }
      }
    } else if (effectiveMode === ExecutionMode.Agent) {
      // Force route to agent
      log.info("forced agent mode", { command: params.command })
      return {
        title: params.description,
        metadata: {
          command: params.command,
          workingDir: shell.getWorkingDir(),
          exitCode: 0,
          description: params.description,
          output: `[Agent mode: ${params.command}]`
        },
        output: `[Agent mode: ${params.command}]`
      }
    }
    
    // Execute in shell mode
    log.info("executing in shell", { 
      command: params.command,
      workingDir: shell.getWorkingDir()
    })
    
    // Check permissions
    const permissions = await Agent.get(ctx.agent).then((x) => x.permission.bash)
    const action = Wildcard.all(params.command, permissions)
    
    if (action === "deny") {
      throw new Error(
        `The user has restricted access to this command. Configuration: ${JSON.stringify(permissions)}`
      )
    }
    
    if (action === "ask") {
      await Permission.ask({
        type: "bash",
        pattern: params.command,
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        callID: ctx.callID,
        title: params.command,
        metadata: {
          command: params.command,
          workingDir: shell.getWorkingDir()
        }
      })
    }
    
    // Execute command with persistent shell
    const result = await shell.execute(params.command, {
      timeout,
      signal: ctx.abort
    })
    
    // Format output
    let output = result.stdout
    if (result.stderr) {
      output += `\n${result.stderr}`
    }
    
    // Special handling for cd command - show new directory
    if (params.command.trim().startsWith("cd ")) {
      if (result.success) {
        output = shell.getWorkingDir()
      }
    }
    
    // Show (ok) for successful commands with no output
    if (result.success && !output.trim()) {
      output = "(ok)"
    }
    
    // Truncate if too long
    if (output.length > MAX_OUTPUT_LENGTH) {
      output = output.slice(0, MAX_OUTPUT_LENGTH) + "\n... (output truncated)"
    }
    
    return {
      title: params.description,
      metadata: {
        command: params.command,
        workingDir: shell.getWorkingDir(),
        exitCode: result.exitCode,
        description: params.description,
        output: result.stdout + (result.stderr ? `\nstderr:\n${result.stderr}` : "")
      },
      output: output
    }
  }
})

/**
 * Shell state management functions
 */
export const Shell = {
  /**
   * Get the persistent shell instance
   */
  get() {
    return getPersistentShell()
  },
  
  /**
   * Get the mode controller
   */
  getModeController() {
    return getModeController()
  },
  
  /**
   * Reset shell state
   */
  reset() {
    getPersistentShell().reset()
    log.info("shell state reset")
  },
  
  /**
   * Get current working directory
   */
  getCwd() {
    return getPersistentShell().getWorkingDir()
  },
  
  /**
   * Set working directory
   */
  setCwd(dir: string) {
    getPersistentShell().setWorkingDir(dir)
  },
  
  /**
   * Get current execution mode
   */
  getMode() {
    return getModeController().getMode()
  },
  
  /**
   * Set execution mode
   */
  setMode(mode: ExecutionMode) {
    getModeController().setMode(mode)
  },
  
  /**
   * Toggle execution mode
   */
  toggleMode() {
    return getModeController().toggleMode()
  }
}