import { MessageV2 } from "./message-v2"
import { Log } from "@/util/log"

export namespace ToolDependency {
  const log = Log.create({ service: "tool.dependency" })

  interface PendingCall {
    id: string
    tool: string
    input: Record<string, any>
    dependents: Set<string>
  }

  interface ExecutionLevel {
    level: number
    calls: PendingCall[]
  }

  export interface DependencyResult {
    levels: ExecutionLevel[]
    dependencies: Map<string, Set<string>>
    dependents: Map<string, Set<string>>
  }

  function isFilePath(input: unknown): input is string {
    if (typeof input !== "string") return false
    return (
      input.startsWith("/") ||
      input.startsWith("./") ||
      input.startsWith("../") ||
      /^[a-zA-Z]:[\\/]/.test(input) ||
      input.startsWith("\\\\")
    )
  }

  function extractPathsFromInput(input: Record<string, any>): Set<string> {
    const paths = new Set<string>()

    function traverse(obj: any, key?: string) {
      if (obj === null || obj === undefined) return

      if (typeof obj === "string") {
        if (isFilePath(obj)) {
          paths.add(key === "path" || key === "file" ? obj : obj)
        }
        return
      }

      if (Array.isArray(obj)) {
        obj.forEach((item) => traverse(item))
        return
      }

      if (typeof obj === "object") {
        for (const [k, v] of Object.entries(obj)) {
          traverse(v, k)
        }
      }
    }

    traverse(input)
    return paths
  }

  function extractLockFilesFromCommand(command: string): Set<string> {
    const locks = new Set<string>()
    const sharedDeps = ["package.json", "package-lock.json", "bun.lockb", "pnpm-lock.yaml", "yarn.lock"]
    for (const dep of sharedDeps) {
      if (command.includes(dep)) {
        locks.add(dep)
      }
    }
    return locks
  }

  function getToolDependencies(
    call: PendingCall,
    allCalls: PendingCall[],
    executedResults: Map<string, any>,
  ): Set<string> {
    const dependencies = new Set<string>()

    switch (call.tool) {
      case "edit": {
        const targetPath = call.input.path
        if (typeof targetPath !== "string") break

        for (const [id, result] of executedResults) {
          const prevCall = allCalls.find((c) => c.id === id)
          if (!prevCall) continue

          if (prevCall.tool === "read" && prevCall.input.path === targetPath) {
            dependencies.add(id)
          }
          if (prevCall.tool === "grep" && prevCall.input.path === targetPath) {
            dependencies.add(id)
          }
        }
        break
      }

      case "apply_patch": {
        const targetPath = call.input.path
        if (typeof targetPath !== "string") break

        for (const [id, result] of executedResults) {
          const prevCall = allCalls.find((c) => c.id === id)
          if (!prevCall) continue

          if (prevCall.tool === "read" && prevCall.input.path === targetPath) {
            dependencies.add(id)
          }
        }
        break
      }

      case "bash": {
        const command = call.input.cmd ?? call.input.command ?? ""
        if (typeof command !== "string") break

        for (const [id, result] of executedResults) {
          const prevCall = allCalls.find((c) => c.id === id)
          if (!prevCall) continue

          if (prevCall.tool === "read") {
            const paths = extractPathsFromInput(prevCall.input)
            for (const path of paths) {
              if (command.includes(path)) {
                dependencies.add(id)
                break
              }
            }
          }
        }
        break
      }

      case "write": {
        const targetPath = call.input.path
        if (typeof targetPath !== "string") break

        for (const [id, result] of executedResults) {
          const prevCall = allCalls.find((c) => c.id === id)
          if (!prevCall) continue

          if (prevCall.tool === "read" && prevCall.input.path === targetPath) {
            dependencies.add(id)
          }
        }
        break
      }

      case "grep": {
        const targetPath = call.input.path
        if (typeof targetPath !== "string" || targetPath.includes("*")) break

        for (const [id, result] of executedResults) {
          const prevCall = allCalls.find((c) => c.id === id)
          if (!prevCall) continue

          if (prevCall.tool === "read" && prevCall.input.path === targetPath) {
            dependencies.add(id)
          }
        }
        break
      }
    }

    return dependencies
  }

  function hasCircularDependency(
    call: PendingCall,
    visited: Set<string>,
    recursionStack: Set<string>,
    dependencies: Map<string, Set<string>>,
  ): boolean {
    if (recursionStack.has(call.id)) return true
    if (visited.has(call.id)) return false

    recursionStack.add(call.id)
    visited.add(call.id)

    const deps = dependencies.get(call.id) ?? new Set()
    for (const depId of deps) {
      const depCall = { ...call, id: depId }
      if (hasCircularDependency(depCall, visited, recursionStack, dependencies)) {
        return true
      }
    }

    recursionStack.delete(call.id)
    return false
  }

  export function analyze(
    toolCalls: MessageV2.ToolPart[],
    executedResults: Map<string, any> = new Map(),
  ): DependencyResult {
    const pendingCalls: PendingCall[] = toolCalls.map((part) => ({
      id: part.callID,
      tool: part.tool,
      input: part.state.input as Record<string, any>,
      dependents: new Set<string>(),
    }))

    const dependencies = new Map<string, Set<string>>()
    const dependents = new Map<string, Set<string>>()

    for (const call of pendingCalls) {
      const deps = getToolDependencies(call, pendingCalls, executedResults)
      dependencies.set(call.id, deps)

      for (const depId of deps) {
        if (!dependents.has(depId)) {
          dependents.set(depId, new Set<string>())
        }
        dependents.get(depId)!.add(call.id)
      }
    }

    for (const call of pendingCalls) {
      const visited = new Set<string>()
      const recursionStack = new Set<string>()
      if (hasCircularDependency(call, visited, recursionStack, dependencies)) {
        log.warn("circular dependency detected", { callId: call.id, dependencies: dependencies.get(call.id) })
      }
    }

    const levels: ExecutionLevel[] = []
    const remaining = new Set(pendingCalls.map((c) => c.id))
    let currentLevel = 0

    while (remaining.size > 0) {
      const levelCalls: PendingCall[] = []

      for (const call of pendingCalls) {
        if (!remaining.has(call.id)) continue

        const deps = dependencies.get(call.id) ?? new Set()
        const canExecute = Array.from(deps).every((depId) => !remaining.has(depId))

        if (canExecute) {
          levelCalls.push(call)
        }
      }

      if (levelCalls.length === 0 && remaining.size > 0) {
        log.warn("unable to resolve dependencies, executing remaining", {
          remaining: Array.from(remaining),
        })
        const remainingCalls = pendingCalls.filter((c) => remaining.has(c.id))
        levels.push({ level: currentLevel, calls: remainingCalls })
        break
      }

      if (levelCalls.length > 0) {
        levels.push({ level: currentLevel, calls: levelCalls })
        for (const call of levelCalls) {
          remaining.delete(call.id)
        }
      }

      currentLevel++
    }

    return { levels, dependencies, dependents }
  }

  export function canExecuteInParallel(call1: MessageV2.ToolPart, call2: MessageV2.ToolPart): boolean {
    const path1 = extractPathsFromInput(call1.state.input as Record<string, any>)
    const path2 = extractPathsFromInput(call2.state.input as Record<string, any>)

    const conflictTools = new Set(["edit", "write", "apply_patch"])

    if (conflictTools.has(call1.tool) && conflictTools.has(call2.tool)) {
      for (const p1 of path1) {
        for (const p2 of path2) {
          if (p1 === p2) return false
        }
      }
    }

    if ((call1.tool === "read" || call1.tool === "grep") && conflictTools.has(call2.tool)) {
      for (const p1 of path1) {
        for (const p2 of path2) {
          if (p1 === p2) return false
        }
      }
    }

    if ((call2.tool === "read" || call2.tool === "grep") && conflictTools.has(call1.tool)) {
      for (const p2 of path2) {
        for (const p1 of path1) {
          if (p2 === p1) return false
        }
      }
    }

    if (call1.tool === "bash" && call2.tool === "bash") {
      const cmd1 = String(call1.state.input.cmd ?? call1.state.input.command ?? "")
      const cmd2 = String(call2.state.input.cmd ?? call2.state.input.command ?? "")

      const sharedDeps = ["package.json", "package-lock.json", "bun.lockb", "pnpm-lock.yaml", "yarn.lock"]
      for (const dep of sharedDeps) {
        if ((cmd1.includes(dep) && cmd2.includes(dep)) || (cmd1.includes("cd ") && cmd2.includes("cd "))) {
          return false
        }
      }
    }

    return true
  }

  export function resourceKeys(call: MessageV2.ToolPart): Set<string> {
    const keys = new Set<string>()
    const input = call.state.input as Record<string, any>
    const paths = extractPathsFromInput(input)
    const normalize = (p: string) => {
      let v = p.replaceAll("\\", "/")
      v = v.replace(/^([A-Z]):/, (m, d: string) => `${d.toLowerCase()}:`)
      if (v.endsWith("/")) v = v.slice(0, -1)
      return v
    }
    for (const p of paths) {
      keys.add(normalize(p))
    }

    if (call.tool === "bash") {
      const cmd = String(input.cmd ?? input.command ?? "")
      const locks = extractLockFilesFromCommand(cmd)
      for (const lock of locks) {
        keys.add(lock)
      }
    }

    if (keys.size === 0) {
      keys.add(`tool:${call.tool}`)
    }
    return keys
  }
}
