#!/usr/bin/env bun
/**
 * ============================================================================
 * 文件名：publish.ts
 * 所属包：packages/plugin/script
 * ============================================================================
 *
 * 文件作用：
 * 插件包的发布脚本。编译 TypeScript 代码，修改 package.json，
 * 打包并发布到 npm registry。
 *
 * 主要功能：
 * - 切换到插件包目录
 * - 编译 TypeScript 代码
 * - 修改 package.json 的 exports 字段为编译后的路径
 * - 打包并发布到 npm
 * - 恢复原始 package.json
 *
 * 依赖关系：
 * - @opencode-ai/script：脚本工具（版本和频道信息）
 * - bun：运行时环境和工具
 * - npm：包管理器
 *
 * 执行方式：
 * ```bash
 * bun run publish.ts
 * ```
 *
 * 环境变量：
 * - OPENCODE_CHANNEL：发布频道（latest、beta、next 等）
 * - OPENCODE_BUMP：版本升级类型（major、minor、patch）
 * - OPENCODE_VERSION：强制指定版本号
 *
 * @package plugin
 * @module publish
 */

// 导入脚本工具
// Script 提供发布频道和版本信息
import { Script } from "@opencode-ai/script"

// 导入 Bun shell 命令工具
// 用于执行 shell 命令（如 tsc、npm publish 等）
import { $ } from "bun"

// 获取插件包的目录路径
// import.meta.url 是当前文件的 URL
// new URL("..", import.meta.url) 获取父目录的 URL
// .pathname 提取路径部分
const dir = new URL("..", import.meta.url).pathname

// 切换当前工作目录到插件包目录
// 确保后续命令在正确的目录中执行
process.chdir(dir)

// 编译 TypeScript 代码
// tsc 将 src/ 目录下的 .ts 文件编译到 dist/ 目录
// 生成 .js 和 .d.ts 文件
await $`bun tsc`

// 读取 package.json 文件
// Bun.file() 读取文件，.json() 解析为 JSON 对象
// 使用动态 import 可以正确处理 JSON 文件
const pkg = await import("../package.json").then((m) => m.default)

// 保存原始 package.json 的副本
// 使用 JSON.parse(JSON.stringify()) 进行深拷贝
// 发布完成后需要恢复原始内容
const original = JSON.parse(JSON.stringify(pkg))

// 遍历 package.json 的 exports 字段
// exports 定义了包的导出路径
// 需要将源代码路径替换为编译后的路径
for (const [key, value] of Object.entries(pkg.exports)) {
  // 将源代码路径转换为编译后的路径
  // 例如：./src/index.ts -> ./dist/index
  // .ts 扩展名被移除，因为编译后是 .js 和 .d.ts
  const file = value.replace("./src/", "./dist/").replace(".ts", "")

  // 修改 exports 字段为新的格式
  // 使用条件导出，分别指定 ES 模块和类型定义
  // @ts-ignore 忽略类型检查，因为我们在动态修改对象结构
  pkg.exports[key] = {
    // import 字段指定 ES 模块的入口
    import: file + ".js",
    // types 字段指定 TypeScript 类型定义文件
    types: file + ".d.ts",
  }
}

// 将修改后的 package.json 写入文件
// 这样 npm publish 会使用新的配置
await Bun.write("package.json", JSON.stringify(pkg, null, 2))

// 打包并发布到 npm registry
// bun pm pack：创建 npm 包的 .tgz 压缩文件
// npm publish *.tgz：发布包到 npm
// --tag ${Script.channel}：发布到指定频道（latest、beta、next 等）
// --access public：设置包为公开访问
await $`bun pm pack && npm publish *.tgz --tag ${Script.channel} --access public`

// 恢复原始的 package.json
// 发布完成后恢复源代码配置，避免影响开发
await Bun.write("package.json", JSON.stringify(original, null, 2))
