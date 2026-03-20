/**
 * Others 配置模块
 * 用于读取和管理 ~/.config/opencode/others.json 配置文件
 * 控制页面元素的显示/隐藏
 */
import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"
import { Log } from "@/util/log"
import z from "zod"

const log = Log.create({ service: "others-config" })

// UI 元素配置 Schema
export const UIElementConfig = z.object({
  // 终端切换按钮
  terminalToggle: z.boolean().default(true),
})

export type UIElementConfig = z.infer<typeof UIElementConfig>

// 默认 UI 配置
const defaultUIConfig: UIElementConfig = {
  terminalToggle: true,
}

// Others 配置 Schema
export const OthersConfig = z.object({
  // UI 元素显示配置，true 表示显示，false 表示隐藏
  ui: UIElementConfig.optional(),
})

export type OthersConfig = z.infer<typeof OthersConfig>

// 默认配置
const defaultConfig: OthersConfig = {
  ui: defaultUIConfig,
}

// 配置文件路径
function configPath() {
  return path.join(Global.Path.config, "others.json")
}

// 缓存的配置
let cachedConfig: OthersConfig | undefined = undefined

export namespace OthersConfigService {
  /**
   * 获取配置文件路径
   */
  export function getConfigPath(): string {
    return configPath()
  }

  /**
   * 读取 others.json 配置
   */
  export async function get(): Promise<OthersConfig> {
    if (cachedConfig) {
      return cachedConfig
    }

    const filePath = configPath()

    try {
      const content = await fs.readFile(filePath, "utf-8")
      const parsed = JSON.parse(content)
      const config = OthersConfig.parse(parsed)

      // 合并默认值
      cachedConfig = {
        ui: {
          ...defaultUIConfig,
          ...config.ui,
        },
      }

      return cachedConfig
    } catch (error: any) {
      if (error.code === "ENOENT") {
        // 文件不存在，返回默认配置
        log.debug("others.json not found, using default config")
        return defaultConfig
      }

      log.error("failed to read others.json", { error })
      return defaultConfig
    }
  }

  /**
   * 更新 others.json 配置
   */
  export async function update(config: Partial<OthersConfig>): Promise<OthersConfig> {
    const filePath = configPath()
    const current = await get()

    const updated: OthersConfig = {
      ui: {
        ...defaultUIConfig,
        ...current.ui,
        ...config.ui,
      },
    }

    await fs.writeFile(filePath, JSON.stringify(updated, null, 2), "utf-8")
    cachedConfig = updated

    return updated
  }

  /**
   * 清除缓存
   */
  export function clearCache(): void {
    cachedConfig = undefined
  }

  /**
   * 获取 UI 元素配置
   */
  export async function getUIConfig(): Promise<UIElementConfig> {
    const config = await get()
    return config.ui ?? defaultUIConfig
  }

  /**
   * 检查某个 UI 元素是否应该显示
   */
  export async function shouldShowUIElement(element: keyof UIElementConfig): Promise<boolean> {
    const uiConfig = await getUIConfig()
    return uiConfig[element] ?? true
  }
}
