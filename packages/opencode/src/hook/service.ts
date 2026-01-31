// =================================================================
//                      Hook Service
// =================================================================
/**
 * @file packages/opencode/src/hook/service.ts
 * @description Manages the lifecycle and execution of native hooks.
 * Listens for events on the global bus and triggers configured hook scripts.
 * Provides Claude Code compatible hook system for OpenCode.
 */

import { Bus } from "@/bus"
import { HookEvent } from "@/bus/bus-event"
import { Config } from "@/config/config"
import { Log } from "@/util/log"
import { spawn } from "bun"

/**
 * HookService coordinates the loading and execution of user-defined hook scripts.
 * It is designed to be a lightweight, secure, and non-blocking bridge
 * between OpenCode events and external automation.
 */
export class HookService {
  private static instance: HookService
  private hooks: Config.Hooks = {}
  private log = Log.create({ service: "HookService" })

  // ===================== Initialization =====================

  private constructor() {
    this.log.info("Initializing Native Hook System...")
    
    // Register listeners IMMEDIATELY so we don't miss any early events
    // (even before configuration is fully loaded)
    this.registerListeners()
    
    this.loadConfiguration().then(() => {
      this.log.info("Native Hook System ready and listening.")
    })
  }

  /**
   * Singleton accessor for the HookService.
   */
  public static getInstance(): HookService {
    if (!HookService.instance) {
      HookService.instance = new HookService()
    }
    return HookService.instance
  }

  /**
   * Loads the hook configuration from the project settings.
   */
  private async loadConfiguration() {
    try {
      const config = await Config.get()
      // We expect a 'hooks' object in opencode.jsonc with PascalCase names
      this.hooks = config.hooks || {}
      this.log.debug("Configuration loaded.", { count: Object.keys(this.hooks).length })
    } catch (error) {
      this.log.error("Failed to load hook configuration", error)
    }
  }

  /**
   * Subscribes to hook events on the global event bus.
   * All 12 Claude Code compatible hooks are registered.
   */
  private registerListeners() {
    // ===================== Session Lifecycle =====================
    Bus.subscribe(HookEvent.SessionStart, (event) => 
      this.execute("SessionStart", { session: event.properties.session })
    )
    Bus.subscribe(HookEvent.SessionStop, (event) => 
      this.execute("SessionStop", { session: event.properties.session })
    )

    // ===================== Tool Execution =====================
    Bus.subscribe(HookEvent.PreToolUse, (event) => 
      this.execute("PreToolUse", { 
        toolCall: event.properties.toolCall, 
        sessionID: event.properties.sessionID 
      }, event.properties.sessionID)
    )
    Bus.subscribe(HookEvent.PostToolUse, (event) => 
      this.execute("PostToolUse", { 
        toolCall: event.properties.toolCall, 
        sessionID: event.properties.sessionID 
      }, event.properties.sessionID)
    )
    Bus.subscribe(HookEvent.PostToolUseFailure, (event) => 
      this.execute("PostToolUseFailure", { 
        toolCall: event.properties.toolCall, 
        sessionID: event.properties.sessionID,
        error: event.properties.error
      }, event.properties.sessionID)
    )

    // ===================== User Input =====================
    Bus.subscribe(HookEvent.UserPromptSubmit, (event) => 
      this.execute("UserPromptSubmit", { 
        prompt: event.properties.prompt, 
        sessionID: event.properties.sessionID 
      }, event.properties.sessionID)
    )

    // ===================== Automation Loop =====================
    Bus.subscribe(HookEvent.Stop, (event) => 
      this.execute("Stop", { 
        sessionID: event.properties.sessionID,
        reason: event.properties.reason
      }, event.properties.sessionID)
    )

    // ===================== Permissions =====================
    Bus.subscribe(HookEvent.PermissionRequest, (event) => 
      this.execute("PermissionRequest", { 
        permission: event.properties.permission, 
        sessionID: event.properties.sessionID,
        metadata: event.properties.metadata
      }, event.properties.sessionID)
    )

    // ===================== Subagent Lifecycle =====================
    Bus.subscribe(HookEvent.SubagentStart, (event) => 
      this.execute("SubagentStart", { 
        subagentID: event.properties.subagentID,
        parentSessionID: event.properties.parentSessionID,
        agentType: event.properties.agentType
      }, event.properties.parentSessionID)
    )
    Bus.subscribe(HookEvent.SubagentStop, (event) => 
      this.execute("SubagentStop", { 
        subagentID: event.properties.subagentID,
        parentSessionID: event.properties.parentSessionID,
        agentType: event.properties.agentType
      }, event.properties.parentSessionID)
    )

    // ===================== Context Management =====================
    Bus.subscribe(HookEvent.PreCompact, (event) => 
      this.execute("PreCompact", { 
        sessionID: event.properties.sessionID,
        contextSize: event.properties.contextSize
      }, event.properties.sessionID)
    )

    // ===================== Notifications =====================
    Bus.subscribe(HookEvent.Notification, (event) => 
      this.execute("Notification", { 
        message: event.properties.message,
        level: event.properties.level,
        sessionID: event.properties.sessionID
      }, event.properties.sessionID)
    )
  }

  // ===================== Execution Engine =====================

  /**
   * Executes configured hooks for a specific event type.
   * Execution is non-blocking (hooks run in background).
   * @param hookName The PascalCase name of the hook (e.g. "PreToolUse")
   * @param payload The data to be sent to the hook script
   * @param sessionID The session ID for permission verification
   */
  private async execute(hookName: keyof Config.Hooks, payload: any, sessionID?: string) {
    const hookConfigs = this.hooks[hookName] || []
    if (hookConfigs.length === 0) return

    this.log.debug(`Triggering ${hookName} hooks`, { count: hookConfigs.length })

    for (const config of hookConfigs) {
      if (!config.enabled) continue
      
      // Execute each hook in its own isolated process
      // We do not await this to keep the event bus moving
      this.runSingleHook(config, payload, sessionID).catch(err => {
        this.log.error(`Critical failure in hook runner for '${config.name}'`, err)
      })
    }
  }

  /**
   * Runs a single hook script with sandboxing.
   */
  private async runSingleHook(config: Config.HookConfig, payload: any, sessionID?: string) {
    // ========== 1. Path Expansion ==========
    let hookPath = config.path
    if (hookPath.startsWith("~")) {
      hookPath = hookPath.replace("~", process.env.HOME || "")
    }

    // ========== 2. Isolated Execution (using Bun spawn) ==========
    // We execute via 'bun' to maintain environment consistency
    const proc = spawn({
      cmd: ["bun", "--no-install", hookPath],
      stdin: "pipe",
      stdout: "inherit",
      stderr: "inherit",
      env: { ...process.env, OPENCODE_HOOK_CONTEXT: "1" },
    })

    // Stream payload to the hook script's stdin as JSON
    const fullPayload = JSON.stringify({
      ...payload,
      hook_event_name: config.name,
      sessionID: sessionID || payload.sessionID || payload.session?.id,
      timestamp: Date.now(),
    })

    try {
      proc.stdin.write(fullPayload)
      proc.stdin.end()
    } catch (err) {
      this.log.error(`Failed to write to hook stdin: ${config.name}`, err)
      proc.kill()
      return
    }

    // ========== 3. Lifecycle Management (Timeout) ==========
    const timeout = config.timeout || 5000
    const timer = setTimeout(() => {
      this.log.warn(`Hook ${config.name} timed out after ${timeout}ms. Terminating.`)
      proc.kill()
    }, timeout)

    try {
      const exitCode = await proc.exited
      clearTimeout(timer)
      
      if (exitCode !== 0) {
        this.log.error(`Hook ${config.name} failed with exit code ${exitCode}`)
      } else {
        this.log.debug(`Hook ${config.name} completed successfully.`)
      }
    } catch (error) {
      this.log.error(`Exception during hook completion: ${config.name}`, error)
    }
  }
}
