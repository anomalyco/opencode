/**
 * ============================================================================
 * 文件名：index.ts
 * 所属包：packages/opencode/src/global
 * ============================================================================
 *
 * 文件作用：
 * 全局配置和路径管理模块。定义 OpenCode 应用的全局路径和初始化逻辑。
 *
 * 主要功能：
 * - 定义 OpenCode 应用的全局路径（data、cache、config、state、log、bin）
 * - 初始化所有必要的目录结构
 * - 管理缓存版本，过期时清理缓存
 * - 支持测试环境的路径覆盖
 *
 * 依赖关系：
 * - fs/promises：文件系统操作
 * - xdg-basedir：XDG 基础目录规范
 * - path：路径处理
 * - os：操作系统信息
 *
 * 导出内容：
 * - Global.Path：全局路径对象
 *
 * 路径说明：
 * - data：用户数据目录（~/.local/share/opencode）
 * - cache：缓存目录（~/.cache/opencode）
 * - config：配置目录（~/.config/opencode）
 * - state：状态目录（~/.local/state/opencode）
 * - log：日志目录（~/.local/share/opencode/log）
 * - bin：二进制文件目录（~/.local/share/opencode/bin）
 *
 * 缓存管理：
 * - 当前缓存版本：17
 * - 当版本不匹配时，自动清理旧缓存
 *
 * @package opencode
 * @module global
 */

// 导入文件系统操作模块
import fs from "fs/promises"

// 导入 XDG 基础目录规范工具
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"

// 导入路径处理模块
import path from "path"

// 导入操作系统信息模块
import os from "os"

// 定义应用名称
const app = "opencode"

// 定义各 XDG 标准目录的完整路径
const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)

/**
 * 全局命名空间
 *
 * 包含 OpenCode 应用的全局配置和路径定义。
 */
export namespace Global {
  /**
   * 全局路径对象
   *
   * 定义 OpenCode 应用使用的所有重要路径。
   * 遵循 XDG 基础目录规范。
   */
  export const Path = {
    // 用户主目录路径
    // 支持通过 OPENCODE_TEST_HOME 环境变量覆盖，用于测试隔离
    get home() {
      return process.env.OPENCODE_TEST_HOME || os.homedir()
    },

    // 数据目录：存储用户数据文件
    data,

    // 二进制文件目录：存储可执行文件
    bin: path.join(data, "bin"),

    // 日志目录：存储应用日志
    log: path.join(data, "log"),

    // 缓存目录：存储临时缓存数据
    cache,

    // 配置目录：存储用户配置
    config,

    // 状态目录：存储应用状态
    state,
  }
}

/**
 * 模块初始化：创建所有必要的目录结构
 *
 * 异步创建以下目录（如果不存在）：
 * - ~/.local/share/opencode（data）
 * - ~/.config/opencode（config）
 * - ~/.local/state/opencode（state）
 * - ~/.local/share/opencode/log（log）
 * - ~/.local/share/opencode/bin（bin）
 *
 * 使用 recursive: true 确保父目录也会被创建。
 */
await Promise.all([
  fs.mkdir(Global.Path.data, { recursive: true }),
  fs.mkdir(Global.Path.config, { recursive: true }),
  fs.mkdir(Global.Path.state, { recursive: true }),
  fs.mkdir(Global.Path.log, { recursive: true }),
  fs.mkdir(Global.Path.bin, { recursive: true }),
])

// 定义当前缓存版本号
// 当此版本改变时，旧缓存会被清理
const CACHE_VERSION = "17"

/**
 * 缓存版本检查和清理
 *
 * 读取存储的缓存版本，与当前版本比较：
 * - 如果版本不匹配，清理整个缓存目录
 * - 写入新的版本号
 *
 * 这确保在代码更新时不会使用过期的缓存数据。
 */
const version = await Bun.file(path.join(Global.Path.cache, "version"))
  .text()
  .catch(() => "0")

// 如果缓存版本不匹配，执行清理
if (version !== CACHE_VERSION) {
  try {
    // 读取缓存目录的所有内容
    const contents = await fs.readdir(Global.Path.cache)

    // 递归删除所有缓存文件和目录
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Global.Path.cache, item), {
          recursive: true,  // 递归删除
          force: true,      // 强制删除，忽略错误
        }),
      ),
    )
  } catch (e) {
    // 忽略清理过程中的错误
  }

  // 写入新的缓存版本号
  await Bun.file(path.join(Global.Path.cache, "version")).write(CACHE_VERSION)
}
