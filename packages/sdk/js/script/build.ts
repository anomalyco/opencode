/**
 * ============================================================================
 * 文件名：build.ts
 * 所属包：packages/sdk/js/script
 * ============================================================================
 *
 * 文件作用：
 * SDK 构建脚本。从 OpenAPI 规范自动生成 TypeScript SDK 代码。
 *
 * 主要功能：
 * - 从 opencode 服务器生成 OpenAPI 规范
 * - 使用 @hey-api/openapi-ts 从 OpenAPI 规范生成 SDK
 * - 格式化生成的代码
 * - 编译 TypeScript
 *
 * 依赖关系：
 * - bun：运行时环境
 * - @hey-api/openapi-ts：代码生成工具
 * - prettier：代码格式化
 * - tsc：TypeScript 编译器
 *
 * 使用场景：
 * - SDK 发布前的构建
 * - API 更新后重新生成 SDK
 *
 * @package sdk/js
 * @module build
 */

#!/usr/bin/env bun

// 获取当前脚本的父目录路径
// new URL("..", import.meta.url) 获取父目录的 URL
// .pathname 提取路径部分
const dir = new URL("..", import.meta.url).pathname

// 切换工作目录到 SDK 包目录
// 确保所有相对路径操作都在正确的目录下执行
process.chdir(dir)

// 导入 Bun 的 shell 命令工具
// $ 符号用于执行 shell 命令
import { $ } from "bun"

// 导入 Node.js path 模块，用于路径操作
import path from "path"

// 导入 OpenAPI 代码生成工具
import { createClient } from "@hey-api/openapi-ts"

// 步骤 1：生成 OpenAPI 规范
// 从 opencode 包生成 openapi.json 文件
// 使用 bun dev generate 命令生成规范，输出到 openapi.json
await $`bun dev generate > ${dir}/openapi.json`.cwd(path.resolve(dir, "../../opencode"))

// 步骤 2：从 OpenAPI 规范生成 TypeScript SDK
// 使用 @hey-api/openapi-ts 工具生成客户端代码
await createClient({
  // 输入文件：刚才生成的 OpenAPI 规范
  input: "./openapi.json",

  // 输出配置
  output: {
    // 输出目录：src/v2/gen
    path: "./src/v2/gen",

    // TypeScript 配置文件路径
    tsConfigPath: path.join(dir, "tsconfig.json"),

    // 清理输出目录（删除旧文件）
    clean: true,
  },

  // 插件配置
  plugins: [
    // TypeScript 类型插件
    {
      name: "@hey-api/typescript",
      // 不从 index.ts 导出（保持结构清晰）
      exportFromIndex: false,
    },

    // SDK 生成插件
    {
      name: "@hey-api/sdk",
      // 客户端实例名称
      instance: "OpencodeClient",
      // 不从 index.ts 导出
      exportFromIndex: false,
      // 禁用自动认证（认证由用户处理）
      auth: false,
      // 使用扁平的参数结构（更简洁的 API）
      paramsStructure: "flat",
    },

    // Fetch 客户端插件
    {
      name: "@hey-api/client-fetch",
      // 不从 index.ts 导出
      exportFromIndex: false,
      // 默认基础 URL
      baseUrl: "http://localhost:4096",
    },
  ],
})

// 步骤 3：格式化生成的代码
// 使用 prettier 格式化生成的代码，保持代码风格一致
await $`bun prettier --write src/gen`
await $`bun prettier --write src/v2`

// 步骤 4：编译 TypeScript
// 先删除旧的 dist 目录
await $`rm -rf dist`

// 编译 TypeScript 到 JavaScript
await $`bun tsc`

// 步骤 5：清理临时文件
// 删除 OpenAPI 规范文件（不再需要）
await $`rm openapi.json`
