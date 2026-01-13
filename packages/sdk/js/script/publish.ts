/**
 * ============================================================================
 * 文件名：publish.ts
 * 所属包：packages/sdk/js/script
 * ============================================================================
 *
 * 文件作用：
 * SDK 发布脚本。构建并发布 SDK 到 npm 注册表。
 *
 * 主要功能：
 * - 执行构建流程
 * - 修改 package.json 的 exports 字段（构建后的路径）
 * - 打包 npm 包
 * - 发布到 npm
 * - 恢复 package.json 原始状态
 *
 * 依赖关系：
 * - bun：运行时环境
 * - @opencode-ai/script：获取发布频道信息
 *
 * 使用场景：
 * - SDK 版本发布
 * - CI/CD 自动发布
 *
 * @package sdk/js
 * @module publish
 */

#!/usr/bin/env bun

// 导入 Script 工具，用于获取发布频道信息
import { Script } from "@opencode-ai/script"

// 导入 Bun 的 shell 命令工具
import { $ } from "bun"

// 获取当前脚本的父目录路径
const dir = new URL("..", import.meta.url).pathname

// 切换工作目录到 SDK 包目录
process.chdir(dir)

// 先执行构建脚本
// 这确保发布的包包含最新生成的代码
await import("./build")

// 读取 package.json 文件
// 动态导入 JSON 文件获取包配置
const pkg = await import("../package.json").then((m) => m.default)

// 深拷贝原始配置，用于后续恢复
// JSON.parse(JSON.stringify()) 是一种简单的深拷贝方法
const original = JSON.parse(JSON.stringify(pkg))

// 修改 exports 字段，将源文件路径替换为构建后的路径
// 这确保发布的包指向正确的编译后文件
for (const [key, value] of Object.entries(pkg.exports)) {
  // 将 "./src/" 替换为 "./dist/"
  // 将 ".ts" 替换为 ""（移除扩展名）
  const file = value.replace("./src/", "./dist/").replace(".ts", "")

  // @ts-expect-error - 忽略类型检查，因为我们在修改 exports 结构
  // 将字符串值改为对象格式，支持 ESM 和 CJS
  pkg.exports[key] = {
    // ESM 入口（.js 文件）
    import: file + ".js",

    // TypeScript 类型定义（.d.ts 文件）
    types: file + ".d.ts",
  }
}

// 写入修改后的 package.json
await Bun.write("package.json", JSON.stringify(pkg, null, 2))

// 打包 npm 包
// bun pm pack 创建 .tgz 文件
await $`bun pm pack`

// 发布到 npm
// --tag ${Script.channel}：使用指定频道（latest、beta、next 等）
// --access public：设置为公开包
await $`npm publish *.tgz --tag ${Script.channel} --access public`

// 恢复原始的 package.json
// 发布完成后恢复原始配置
await Bun.write("package.json", JSON.stringify(original, null, 2))
