/**
 * OpenCode Service Module
 *
 * This module provides a wrapper around the opencode core functionality,
 * allowing opencode-web to access skills, tools, agents, and config
 * by providing a project directory context.
 *
 * Note: Uses dynamic imports to work around TypeScript path alias issues.
 * The imports work at runtime with Bun.
 */

// Type definitions (manually defined to avoid import issues)
export interface SkillInfo {
  name: string
  description: string
  location: string
}

export interface ToolInfo {
  id: string
  description: string
}

export interface AgentInfo {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  model?: { modelID: string; providerID: string }
  prompt?: string
  temperature?: number
  topP?: number
  steps?: number
}

export interface ProviderInfo {
  id: string
  name: string
}

export interface ModelInfo {
  id: string
  name: string
  providerID: string
}

export interface CommandInfo {
  name: string
  description: string
}

export interface ProjectInfo {
  directory: string
  skills: SkillInfo[]
  agents: AgentInfo[]
  config: Record<string, unknown>
  vcs: { branch: string | undefined }
  commands: CommandInfo[]
}

// Lazy-loaded modules cache
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _Instance: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _InstanceBootstrap: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _Skill: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _Agent: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _Config: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _ToolRegistry: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _Provider: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _Vcs: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _Command: any = null

/**
 * Initialize opencode modules (lazy loading)
 * Uses dynamic imports to work with Bun at runtime
 *
 * Note: These imports work at runtime with Bun but TypeScript cannot
 * resolve the path aliases used by the opencode package. We use @ts-ignore
 * to suppress these errors since the imports work correctly at runtime.
 */
async function loadModules() {
  if (!_Instance) {
    // @ts-ignore - opencode uses path aliases that tsc can't resolve
    const instanceMod = await import("opencode/project/instance")
    _Instance = instanceMod.Instance
  }
  if (!_InstanceBootstrap) {
    // @ts-ignore - opencode uses path aliases that tsc can't resolve
    const bootstrapMod = await import("opencode/project/bootstrap")
    _InstanceBootstrap = bootstrapMod.InstanceBootstrap
  }
  if (!_Skill) {
    // @ts-ignore - opencode uses path aliases that tsc can't resolve
    const skillMod = await import("opencode/skill")
    _Skill = skillMod.Skill
  }
  if (!_Agent) {
    // @ts-ignore - opencode uses path aliases that tsc can't resolve
    const agentMod = await import("opencode/agent/agent")
    _Agent = agentMod.Agent
  }
  if (!_Config) {
    // @ts-ignore - opencode uses path aliases that tsc can't resolve
    const configMod = await import("opencode/config/config")
    _Config = configMod.Config
  }
  if (!_ToolRegistry) {
    // @ts-ignore - opencode uses path aliases that tsc can't resolve
    const toolMod = await import("opencode/tool/registry")
    _ToolRegistry = toolMod.ToolRegistry
  }
  if (!_Provider) {
    // @ts-ignore - opencode uses path aliases that tsc can't resolve
    const providerMod = await import("opencode/provider/provider")
    _Provider = providerMod.Provider
  }
  if (!_Vcs) {
    // @ts-ignore - opencode uses path aliases that tsc can't resolve
    const vcsMod = await import("opencode/project/vcs")
    _Vcs = vcsMod.Vcs
  }
  if (!_Command) {
    // @ts-ignore - opencode uses path aliases that tsc can't resolve
    const cmdMod = await import("opencode/command")
    _Command = cmdMod.Command
  }
}

/**
 * Execute a function within an opencode Instance context
 * This initializes the project context and makes all opencode features available
 */
export async function withProjectContext<T>(
  projectDir: string,
  fn: () => Promise<T>
): Promise<T> {
  await loadModules()
  return _Instance.provide({
    directory: projectDir,
    init: _InstanceBootstrap,
    fn,
  })
}

/**
 * Skill Service - Get skills from a project directory
 */
export namespace SkillService {
  /**
   * Get all skills available in a project
   */
  export async function list(projectDir: string): Promise<SkillInfo[]> {
    await loadModules()
    return withProjectContext(projectDir, async () => {
      return _Skill.all()
    })
  }

  /**
   * Get a specific skill by name
   */
  export async function get(
    projectDir: string,
    name: string
  ): Promise<SkillInfo | undefined> {
    await loadModules()
    return withProjectContext(projectDir, async () => {
      return _Skill.get(name)
    })
  }
}

/**
 * Tool Service - Get tools from a project directory
 */
export namespace ToolService {
  /**
   * Get all tool IDs available
   */
  export async function listIds(projectDir: string): Promise<string[]> {
    await loadModules()
    return withProjectContext(projectDir, async () => {
      return _ToolRegistry.ids()
    })
  }

  /**
   * Get all tools with their definitions
   */
  export async function list(
    projectDir: string,
    model?: { providerID: string; modelID: string }
  ): Promise<ToolInfo[]> {
    await loadModules()
    return withProjectContext(projectDir, async () => {
      const defaultModel = model ?? {
        providerID: "anthropic",
        modelID: "claude-sonnet-4-20250514",
      }
      const tools = await _ToolRegistry.tools(defaultModel)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return tools.map((t: any) => ({
        id: t.id,
        description: t.description,
      }))
    })
  }
}

/**
 * Agent Service - Get agents from a project directory
 */
export namespace AgentService {
  /**
   * Get all agents available in a project
   */
  export async function list(projectDir: string): Promise<AgentInfo[]> {
    await loadModules()
    return withProjectContext(projectDir, async () => {
      return _Agent.list()
    })
  }

  /**
   * Get a specific agent by name
   */
  export async function get(
    projectDir: string,
    name: string
  ): Promise<AgentInfo | undefined> {
    await loadModules()
    return withProjectContext(projectDir, async () => {
      return _Agent.get(name)
    })
  }

  /**
   * Get the default agent
   */
  export async function getDefault(projectDir: string): Promise<AgentInfo> {
    await loadModules()
    return withProjectContext(projectDir, async () => {
      return _Agent.defaultAgent()
    })
  }
}

/**
 * Config Service - Get and update project configuration
 */
export namespace ConfigService {
  /**
   * Get the merged configuration for a project
   */
  export async function get(projectDir: string): Promise<Record<string, unknown>> {
    await loadModules()
    return withProjectContext(projectDir, async () => {
      const config = await _Config.get()
      return config as Record<string, unknown>
    })
  }

  /**
   * Get all config directories (project, global, etc.)
   */
  export async function directories(projectDir: string): Promise<string[]> {
    await loadModules()
    return withProjectContext(projectDir, async () => {
      return _Config.directories()
    })
  }
}

/**
 * Provider Service - Get AI provider information
 */
export namespace ProviderService {
  /**
   * Get all available providers
   */
  export async function list(projectDir: string): Promise<ProviderInfo[]> {
    await loadModules()
    return withProjectContext(projectDir, async () => {
      const providers = await _Provider.list()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return providers.map((p: any) => ({
        id: p.id,
        name: p.name,
      }))
    })
  }

  /**
   * Get the default model
   */
  export async function getDefaultModel(projectDir: string): Promise<ModelInfo | undefined> {
    await loadModules()
    return withProjectContext(projectDir, async () => {
      const model = await _Provider.defaultModel()
      if (!model) return undefined
      return {
        id: model.info.id,
        name: model.info.name,
        providerID: model.provider.id,
      }
    })
  }
}

/**
 * VCS Service - Get version control information
 */
export namespace VcsService {
  /**
   * Get current branch name
   */
  export async function branch(projectDir: string): Promise<string | undefined> {
    await loadModules()
    return withProjectContext(projectDir, async () => {
      return _Vcs.branch()
    })
  }
}

/**
 * Command Service - Get available commands
 */
export namespace CommandService {
  /**
   * Get all available commands
   */
  export async function list(projectDir: string): Promise<CommandInfo[]> {
    await loadModules()
    return withProjectContext(projectDir, async () => {
      return _Command.list()
    })
  }
}

/**
 * Project Info - Get comprehensive project information
 */
export async function getProjectInfo(projectDir: string): Promise<ProjectInfo> {
  await loadModules()
  return withProjectContext(projectDir, async () => {
    const [skills, agents, config, branch, commands] = await Promise.all([
      _Skill.all(),
      _Agent.list(),
      _Config.get(),
      _Vcs.branch(),
      _Command.list(),
    ])

    return {
      directory: projectDir,
      skills,
      agents,
      config,
      vcs: { branch },
      commands,
    }
  })
}
