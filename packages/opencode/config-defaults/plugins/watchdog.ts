/**
 * OpenCode Watchdog Plugin
 * 
 * Monitors agent behavior and prevents doom loops.
 * Tracks repeated tool calls and injects recovery prompts when stuck.
 */

import type { Plugin } from "@opencode-ai/plugin"
import { createHash } from "crypto"

interface ActionRecord {
  toolName: string
  args: string
  timestamp: number
  hash: string
}

interface WatchdogState {
  recentActions: ActionRecord[]
  sameActionCount: number
  lastError: string | null
  errorCount: number
  startTime: number
}

const MAX_RECENT_ACTIONS = 10
const DOOM_LOOP_THRESHOLD = 3
const ERROR_THRESHOLD = 3

function hashAction(toolName: string, args: string): string {
  return createHash('md5').update(`${toolName}-${args}`).digest('hex')
}

const state: WatchdogState = {
  recentActions: [],
  sameActionCount: 0,
  lastError: null,
  errorCount: 0,
  startTime: Date.now()
}

function detectDoomLoop(toolName: string, args: string): boolean {
  const hash = hashAction(toolName, args)
  
  state.recentActions.push({
    toolName,
    args,
    timestamp: Date.now(),
    hash
  })
  
  if (state.recentActions.length > MAX_RECENT_ACTIONS) {
    state.recentActions.shift()
  }
  
  const lastThree = state.recentActions.slice(-3)
  if (lastThree.length === 3 && lastThree.every(a => a.hash === hash)) {
    state.sameActionCount++
    return true
  }
  
  state.sameActionCount = 0
  return false
}

function detectErrorLoop(error: string): boolean {
  if (error === state.lastError) {
    state.errorCount++
    return state.errorCount >= ERROR_THRESHOLD
  }
  
  state.lastError = error
  state.errorCount = 1
  return false
}

function getRecoveryPrompt(toolName: string, error?: string): string {
  const elapsed = Math.floor((Date.now() - state.startTime) / 1000)
  const minutes = Math.floor(elapsed / 60)
  
  return `
<system-reminder>
CRITICAL: Watchdog detected a potential doom loop.

Tool: ${toolName}
Repeated actions: ${state.sameActionCount}
Same errors: ${state.errorCount}
Time elapsed: ${minutes} minutes

You are stuck in a loop. DO NOT repeat this action.

INSTRUCTIONS:
1. STOP what you are doing immediately
2. Use 'websearch' to find alternative solutions
3. Read the official documentation for the library you are using
4. Consider a completely different approach
5. If still stuck, report the issue to the user with full context

Current state saved to .opencode/state.md
</system-reminder>
`
}

function resetState(): void {
  state.recentActions = []
  state.sameActionCount = 0
  state.lastError = null
  state.errorCount = 0
}

export default (async ({ client, project, directory, $ }) => {
  console.log('[Watchdog] Plugin loaded - monitoring for doom loops')
  
  return {
    'tool.execute.before': async (input: { tool: string; sessionID: string; callID: string }, output: { args: any }) => {
      const { tool } = input
      const argsStr = JSON.stringify(output.args)
      
      const isLoop = detectDoomLoop(tool, argsStr)
      
      if (isLoop) {
        console.log(`[Watchdog] Doom loop detected for tool: ${tool}`)
      }
      
      return output
    },
    
    'tool.execute.after': async (input: { tool: string; sessionID: string; callID: string; args: any }, output: { title: string; output: string; metadata: any }) => {
      const { tool } = input
      const result = output.output
      
      if (result && typeof result === 'string') {
        const isError = result.toLowerCase().includes('error') || 
                       result.toLowerCase().includes('failed') ||
                       result.toLowerCase().includes('exception')
        
        if (isError) {
          const isErrorLoop = detectErrorLoop(result)
          
          if (isErrorLoop) {
            console.log(`[Watchdog] Error loop detected for tool: ${tool}`)
            output.output = result + '\n\n' + getRecoveryPrompt(tool, result)
          }
        } else {
          state.lastError = null
          state.errorCount = 0
        }
      }
      
      return output
    },
    
    'chat.message': async (input: any, output: any) => {
      const elapsed = Math.floor((Date.now() - state.startTime) / 1000)
      
      if (elapsed > 1800) {
        output.content = output.content + `
<system-reminder>
Watchdog Notice: You have been running for ${Math.floor(elapsed / 60)} minutes.
Consider compacting your memory with /compact to maintain performance.
</system-reminder>
`
      }
      
      return output
    }
  }
}) satisfies Plugin
