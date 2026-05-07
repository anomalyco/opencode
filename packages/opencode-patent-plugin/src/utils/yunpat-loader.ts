/**
 * YunPat 动态加载器
 *
 * 在运行时动态加载 YunPat 模块，避免构建时依赖冲突。
 * 如果 YunPat 不可用，自动降级为纯 LLM 模式。
 */

import { existsSync } from "fs"
import { resolve } from "path"

const YUNPAT_BASE_PATH = process.env.YUNPAT_PATH ?? "/Users/xujian/projects/YunPat/packages"

/**
 * YunPat 模块缓存
 */
const moduleCache = new Map<string, any>()

/**
 * 动态加载 YunPat 模块
 */
export async function loadYunPatModule<T = any>(moduleName: string): Promise<T | null> {
  // 检查缓存
  if (moduleCache.has(moduleName)) {
    return moduleCache.get(moduleName)
  }

  // 构建模块路径
  const modulePath = resolve(YUNPAT_BASE_PATH, moduleName)

  // 检查模块是否存在
  if (!existsSync(modulePath)) {
    console.warn(`[YunPat] Module not found: ${modulePath}`)
    return null
  }

  try {
    // 尝试动态导入
    const mod = await import(modulePath)
    moduleCache.set(moduleName, mod)
    console.log(`[YunPat] Loaded module: ${moduleName}`)
    return mod
  } catch (error) {
    console.warn(`[YunPat] Failed to load module ${moduleName}:`, error)
    return null
  }
}

/**
 * 检查 YunPat 是否可用
 */
export function isYunPatAvailable(): boolean {
  return existsSync(YUNPAT_BASE_PATH)
}

/**
 * 获取 YunPat 模块路径（用于 require）
 */
export function getYunPatModulePath(moduleName: string): string {
  return resolve(YUNPAT_BASE_PATH, moduleName)
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
