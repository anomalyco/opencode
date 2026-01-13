/**
 * ============================================================================
 * 文件名：index.ts
 * 所属包：packages/script/src
 * ============================================================================
 *
 * 文件作用：
 * OpenCode 脚本工具模块。提供版本和发布频道检测功能。
 *
 * 主要功能：
 * - 验证 Bun 版本是否与项目要求一致
 * - 确定发布频道（latest、beta、next 等）
 * - 计算下一个版本号
 * - 提供脚本配置信息
 *
 * 依赖关系：
 * - bun：运行时环境
 * - node:path：路径处理
 * - npm registry：版本查询
 *
 * 导出内容：
 * - Script：脚本配置对象
 *   - channel：发布频道名称
 *   - version：计算出的版本号
 *   - preview：是否为预览版本
 *
 * 使用场景：
 * - CI/CD 发布流程
 * - 版本管理脚本
 * - 自动化构建
 *
 * @package script
 * @module index
 */

// 导入 Bun 的 shell 命令工具
import { $ } from "bun"

// 导入 Node.js path 模块，用于路径处理
import path from "path"

// 获取根目录 package.json 的路径
// import.meta.dir 是当前文件所在目录
// 向上三级到达 monorepo 根目录
const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")

// 读取根目录 package.json 文件
// Bun.file() 读取文件内容，.json() 解析为 JSON 对象
const rootPkg = await Bun.file(rootPkgPath).json()

// 从 packageManager 字段提取期望的 Bun 版本
// packageManager 格式通常为 "bun@x.x.x"
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

// 验证是否找到了 packageManager 字段
if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// 验证当前 Bun 版本是否与期望版本一致
// process.versions.bun 是当前运行时的 Bun 版本
if (process.versions.bun !== expectedBunVersion) {
  throw new Error(`This script requires bun@${expectedBunVersion}, but you are using bun@${process.versions.bun}`)
}

// 定义环境变量配置对象
// 这些变量用于控制发布流程
const env = {
  // 发布频道名称（latest、beta、next 等）
  OPENCODE_CHANNEL: process.env["OPENCODE_CHANNEL"],

  // 版本升级类型（major、minor、patch）
  OPENCODE_BUMP: process.env["OPENCODE_BUMP"],

  // 强制指定版本号
  OPENCODE_VERSION: process.env["OPENCODE_VERSION"],
}

// 计算发布频道
// 使用 IIFE（立即执行函数表达式）进行异步计算
const CHANNEL = await (async () => {
  // 如果明确指定了频道，使用指定值
  if (env.OPENCODE_CHANNEL) return env.OPENCODE_CHANNEL

  // 如果指定了版本升级，使用 latest 频道
  if (env.OPENCODE_BUMP) return "latest"

  // 如果指定了版本号且不是开发版本（0.0.0-开头），使用 latest
  if (env.OPENCODE_VERSION && !env.OPENCODE_VERSION.startsWith("0.0.0-")) return "latest"

  // 否则使用当前 Git 分支名作为频道
  // 例如：main -> latest, develop -> develop
  return await $`git branch --show-current`
    .text()           // 获取命令输出文本
    .then((x) => x.trim()) // 去除首尾空白字符
})()

// 判断是否为预览版本
// latest 频道为正式版本，其他为预览版本
const IS_PREVIEW = CHANNEL !== "latest"

// 计算版本号
// 使用 IIFE 进行异步计算
const VERSION = await (async () => {
  // 如果强制指定了版本号，使用指定值
  if (env.OPENCODE_VERSION) return env.OPENCODE_VERSION

  // 如果是预览版本，生成开发版本号
  // 格式：0.0.0-<频道>-<时间戳>
  if (IS_PREVIEW) {
    return `0.0.0-${CHANNEL}-${new Date()
      .toISOString()     // 转为 ISO 8601 格式
      .slice(0, 16)       // 取前 16 个字符（日期和时间）
      .replace(/[-:T]/g, "")}` // 移除分隔符，得到紧凑格式
  }

  // 对于正式版本，从 npm registry 获取最新版本
  const version = await fetch("https://registry.npmjs.org/opencode-ai/latest")
    .then((res) => {
      // 检查响应是否成功
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data: any) => data.version)

  // 解析版本号为 major.minor.patch 三部分
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)

  // 根据 OPENCODE_BUMP 环境变量确定如何升级版本
  const t = env.OPENCODE_BUMP?.toLowerCase()

  // major 版本升级：破坏性更改
  if (t === "major") return `${major + 1}.0.0`

  // minor 版本升级：新功能（向后兼容）
  if (t === "minor") return `${major}.${minor + 1}.0`

  // patch 版本升级：bug 修复（向后兼容）
  return `${major}.${minor}.${patch + 1}`
})()

// 导出脚本配置对象
export const Script = {
  // 获取发布频道名称
  get channel() {
    return CHANNEL
  },

  // 获取计算出的版本号
  get version() {
    return VERSION
  },

  // 是否为预览版本
  get preview() {
    return IS_PREVIEW
  },
}

// 输出脚本配置信息到控制台
// 用于调试和日志记录
console.log(`opencode script`, JSON.stringify(Script, null, 2))
