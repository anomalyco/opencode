/**
 * ============================================================================
 * 文件名：index.ts
 * 所属包：packages/opencode/src/bun
 * ============================================================================
 *
 * 文件作用：
 * Bun 运行时工具模块。提供 Bun 进程管理和包安装功能。
 *
 * 主要功能：
 * - run(cmd, options?)：运行 Bun 命令
 * - which()：获取 Bun 可执行文件路径
 * - install(pkg, version?)：安装 npm 包
 * - InstallFailedError：安装失败错误
 *
 * 依赖关系：
 * - zod：类型验证
 * - ../global：全局配置路径
 * - ../util/log：日志记录
 * - path：路径处理
 * - @opencode-ai/util/error：命名错误
 * - bun：Bun 运行时 API
 * - module：ES 模块 API（createRequire）
 * - ../util/lock：读写锁
 *
 * 导出内容：
 * - BunProc namespace：Bun 进程命名空间
 *   - run()：运行命令
 *   - which()：获取可执行文件路径
 *   - install()：安装包
 *   - InstallFailedError：安装失败错误
 *
 * 使用场景：
 * - 动态安装 npm 包（如 MCP 服务器插件）
 * - 运行 Bun 子进程
 * - 管理缓存目录中的依赖
 *
 * @package opencode
 * @module bun/index
 */

// 导入 Zod 类型验证
import z from "zod"

// 导入全局配置路径
import { Global } from "../global"

// 导入日志工具
import { Log } from "../util/log"

// 导入路径模块
import path from "path"

// 导入命名错误工具
import { NamedError } from "@opencode-ai/util/error"

// 导入 Bun 运行时 API
import { readableStreamToText } from "bun"

// 导入 ES 模块 createRequire 函数
import { createRequire } from "module"

// 导入读写锁
import { Lock } from "../util/lock"

/**
 * Bun 进程命名空间
 *
 * 提供 Bun 运行时相关工具函数。
 */
export namespace BunProc {
  // 创建日志记录器
  const log = Log.create({ service: "bun" })

  // 创建 require 函数（用于 Node.js 兼容）
  const req = createRequire(import.meta.url)

  /**
   * 运行 Bun 命令
   *
   * 使用 Bun.spawn 执行命令，捕获输出并处理错误。
   *
   * @param cmd - 命令参数数组
   * @param options - 可选的 spawn 选项
   * @returns Promise，解析为 spawn 结果
   * @throws 如果命令退出码非零则抛出错误
   *
   * 执行流程：
   * 1. 记录开始日志
   * 2. 使用 Bun.spawn 启动进程
   * 3. 捕获 stdout 和 stderr
   * 4. 检查退出码
   * 5. 记录完成日志
   */
  export async function run(cmd: string[], options?: Bun.SpawnOptions.OptionsObject<any, any, any>) {
    // 记录开始执行
    log.info("running", {
      cmd: [which(), ...cmd],
      ...options,
    })

    // 启动进程
    const result = Bun.spawn([which(), ...cmd], {
      ...options,
      // 捕获标准输出
      stdout: "pipe",
      // 捕获标准错误
      stderr: "pipe",
      // 设置环境变量
      env: {
        ...process.env,
        ...options?.env,
        // 标识为 Bun 自己
        BUN_BE_BUN: "1",
      },
    })

    // 等待进程结束
    const code = await result.exited

    // 读取 stdout
    const stdout = result.stdout
      ? typeof result.stdout === "number"
        ? result.stdout
        : await readableStreamToText(result.stdout)
      : undefined

    // 读取 stderr
    const stderr = result.stderr
      ? typeof result.stderr === "number"
        ? result.stderr
        : await readableStreamToText(result.stderr)
      : undefined

    // 记录完成日志
    log.info("done", {
      code,
      stdout,
      stderr,
    })

    // 检查退出码
    if (code !== 0) {
      throw new Error(`Command failed with exit code ${result.exitCode}`)
    }

    return result
  }

  /**
   * 获取 Bun 可执行文件路径
   *
   * @returns 当前进程的可执行文件路径
   */
  export function which() {
    return process.execPath
  }

  /**
   * Bun 安装失败错误
   *
   * 当包安装失败时抛出此错误。
   */
  export const InstallFailedError = NamedError.create(
    "BunInstallFailedError",
    z.object({
      // 包名
      pkg: z.string(),
      // 版本号
      version: z.string(),
    }),
  )

  /**
   * 安装 npm 包
   *
   * 使用 Bun 包管理器安装指定的包到缓存目录。
   * 使用写锁确保同时只有一个安装进程。
   *
   * @param pkg - 包名
   * @param version - 版本号（默认 "latest"）
   * @returns Promise，解析为安装目录路径
   *
   * 安装流程：
   * 1. 获取写锁（防止并发安装）
   * 2. 检查是否已安装指定版本
   * 3. 检测代理设置
   * 4. 运行 bun add 命令
   * 5. 解析实际安装的版本
   * 6. 更新 package.json
   *
   * 注意事项：
   * - 使用 Bun 的默认注册表解析
   * - 如果有代理，禁用缓存（已知问题）
   * - 安装到缓存目录而非当前项目
   */
  export async function install(pkg: string, version = "latest") {
    // 使用写锁确保同时只有一个安装进程
    // using 语法会在作用域结束时自动释放锁
    using _ = await Lock.write("bun-install")

    // 计算模块安装路径
    const mod = path.join(Global.Path.cache, "node_modules", pkg)

    // 读取或创建 package.json
    const pkgjson = Bun.file(path.join(Global.Path.cache, "package.json"))
    const parsed = await pkgjson.json().catch(async () => {
      // 如果不存在，创建新的 package.json
      const result = { dependencies: {} }
      await Bun.write(pkgjson.name!, JSON.stringify(result, null, 2))
      return result
    })

    // 如果已经安装了指定版本，直接返回
    if (parsed.dependencies[pkg] === version) return mod

    // 检测是否配置了代理
    const proxied = !!(
      process.env.HTTP_PROXY ||
      process.env.HTTPS_PROXY ||
      process.env.http_proxy ||
      process.env.https_proxy
    )

    // 构建命令参数
    const args = [
      "add",
      "--force",        // 强制重新安装
      "--exact",        // 使用精确版本
      // 代理情况下禁用缓存（Bun 的已知问题）
      // TODO: get rid of this case (see: https://github.com/oven-sh/bun/issues/19936)
      ...(proxied ? ["--no-cache"] : []),
      "--cwd",          // 指定工作目录
      Global.Path.cache,
      pkg + "@" + version,
    ]

    // 记录安装日志
    // Bun 会自动处理注册表解析：
    // - 如果存在 .npmrc 文件，Bun 会自动使用
    // - 如果没有 .npmrc 文件，Bun 默认使用 https://registry.npmjs.org
    // - 不需要传递 --registry 参数
    log.info("installing package using Bun's default registry resolution", {
      pkg,
      version,
    })

    // 执行安装命令
    await BunProc.run(args, {
      cwd: Global.Path.cache,
    }).catch((e) => {
      // 安装失败，抛出错误
      throw new InstallFailedError(
        { pkg, version },
        {
          cause: e,
        },
      )
    })

    // 如果使用 "latest"，解析实际安装的版本
    // 这确保后续启动使用缓存版本，直到显式更新
    let resolvedVersion = version
    if (version === "latest") {
      const installedPkgJson = Bun.file(path.join(mod, "package.json"))
      const installedPkg = await installedPkgJson.json().catch(() => null)
      if (installedPkg?.version) {
        resolvedVersion = installedPkg.version
      }
    }

    // 更新 package.json
    parsed.dependencies[pkg] = resolvedVersion
    await Bun.write(pkgjson.name!, JSON.stringify(parsed, null, 2))

    return mod
  }
}
