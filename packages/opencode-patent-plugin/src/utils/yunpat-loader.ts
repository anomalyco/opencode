/**
 * YunPat 动态加载器
 *
 * 在运行时通过 Bun 动态加载 YunPat 模块，避免构建时依赖冲突。
 * 如果 YunPat 不可用，自动降级为纯 LLM 模式。
 */

import { existsSync, statSync, readFileSync } from "fs"
import { resolve, join } from "path"

const YUNPAT_BASE_PATH = process.env.YUNPAT_PATH ?? "/Users/xujian/projects/YunPat/packages"

/**
 * YunPat 模块缓存
 */
const moduleCache = new Map<string, any>()

/**
 * 解析 YunPat 模块路径
 *
 * ESM 不支持目录导入，需要解析到具体的入口文件。
 * 策略：
 * 1. 如果路径指向文件，直接使用
 * 2. 如果路径指向目录，读取 package.json 的 main 字段
 * 3. 回退到 dist/index.js
 */
function resolveYunPatPath(moduleName: string): string {
  const modulePath = resolve(YUNPAT_BASE_PATH, moduleName)

  // 如果已经是文件路径，直接使用
  if (existsSync(modulePath) && !modulePath.endsWith("/")) {
    try {
      const stats = statSync(modulePath)
      if (stats.isFile()) return modulePath
    } catch {
      // ignore
    }
  }

  // 尝试读取 package.json
  const pkgPath = join(modulePath, "package.json")
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      const main = pkg.main || pkg.exports?.["."]?.import || "./dist/index.js"
      const resolved = resolve(modulePath, main)
      if (existsSync(resolved)) return resolved
    } catch {
      // ignore
    }
  }

  // 回退到常见的入口路径
  const fallbacks = [
    join(modulePath, "dist", "index.js"),
    join(modulePath, "index.js"),
    join(modulePath, "dist", "index.ts"),
    join(modulePath, "index.ts"),
  ]

  for (const p of fallbacks) {
    if (existsSync(p)) return p
  }

  return modulePath
}

/**
 * 动态加载 YunPat 模块
 */
export async function loadYunPatModule<T = any>(moduleName: string): Promise<T | null> {
  if (moduleCache.has(moduleName)) {
    return moduleCache.get(moduleName)
  }

  const modulePath = resolveYunPatPath(moduleName)

  if (!existsSync(modulePath)) {
    console.warn(`[YunPat] Module not found: ${modulePath}`)
    return null
  }

  try {
    const mod = await import(modulePath)
    moduleCache.set(moduleName, mod)
    console.log(`[YunPat] Loaded module: ${moduleName}`)
    return mod
  } catch (error: any) {
    console.warn(`[YunPat] Failed to load module ${moduleName}:`, error?.message || error)
    return null
  }
}

/**
 * 创建 Agent 执行上下文
 *
 * YunPat Agent 需要完整的上下文才能运行，包括：
 * - eventBus: 事件总线
 * - memory: 短期记忆
 * - tools: 工具注册表
 * - logger: 日志记录器
 */
export async function createAgentContext() {
  const core = await loadYunPatModule("core")
  if (!core) return null

  const eventBus = new core.EventBus()
  const MemoryClass = core.ShortTermMemory || core.MemoryStore || Object
  const memory = new (MemoryClass as any)()
  const ToolRegistryClass = core.ToolRegistry || Object
  const tools = new (ToolRegistryClass as any)(eventBus)

  const logger = {
    info: (...args: any[]) => console.log(...args),
    warn: (...args: any[]) => console.warn(...args),
    error: (...args: any[]) => console.error(...args),
    debug: (...args: any[]) => {},
  }

  return { eventBus, memory, tools, logger }
}

/**
 * 创建 YunPat Agent 实例
 *
 * 自动加载 Agent 类并实例化，配置必要的上下文。
 */
export async function createYunPatAgent(
  moduleName: string,
  className: string,
  config: Record<string, any>,
) {
  const mod = await loadYunPatModule(moduleName)
  if (!mod?.[className]) return null

  const context = await createAgentContext()
  if (!context) return null

  const agent = new mod[className]({
    ...config,
    eventBus: context.eventBus,
    memory: context.memory,
    tools: context.tools,
  })

  return { agent, context }
}

/**
 * 检查 YunPat 是否可用
 */
export function isYunPatAvailable(): boolean {
  return existsSync(YUNPAT_BASE_PATH)
}

/**
 * 获取 YunPat 模块路径
 */
export function getYunPatModulePath(moduleName: string): string {
  return resolveYunPatPath(moduleName)
}

/**
 * 预加载核心模块
 */
export async function preloadYunPatCore(): Promise<boolean> {
  const core = await loadYunPatModule("core")
  if (!core) {
    console.warn("[YunPat] Core module not available, falling back to LLM-only mode")
    return false
  }
  return true
}
