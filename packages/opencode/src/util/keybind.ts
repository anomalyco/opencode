/**
 * ============================================================================
 * 文件名：keybind.ts
 * 所属包：packages/opencode/src/util
 * ============================================================================
 *
 * 文件作用：
 * 键盘快捷键工具模块。提供快捷键解析、匹配和格式化功能。
 *
 * 主要功能：
 * - Info 类型：快捷键信息类型定义
 * - match()：比较两个快捷键是否相同
 * - fromParsedKey()：从 OpenTUI 的 ParsedKey 转换
 * - toString()：将快捷键转换为字符串表示
 * - parse()：解析快捷键字符串
 *
 * 依赖关系：
 * - remeda：isDeepEqual 深度相等比较
 * - @opentui/core：ParsedKey 类型定义
 *
 * 导出内容：
 * - Keybind namespace：快捷键命名空间
 *   - Info 类型：快捷键信息类型
 *   - match(a, b)：匹配快捷键
 *   - fromParsedKey(key, leader)：转换类型
 *   - toString(info)：格式化输出
 *   - parse(key)：解析快捷键字符串
 *
 * 快捷键格式：
 * - 字符串格式："ctrl+shift+p", "<leader>w", "alt+enter"
 * - 多个快捷键用逗号分隔："ctrl+p,ctrl+shift+p"
 * - 特殊键：ctrl, alt/meta/option, super, shift, leader
 * - 特殊键名：esc → escape, delete → del
 *
 * 使用场景：
 * - TUI（终端用户界面）的键盘快捷键
 * - 命令面板的快捷键绑定
 * - Vim 风格的 leader 键
 *
 * 使用示例：
 * ```typescript
 * // 解析快捷键
 * const bindings = Keybind.parse("ctrl+shift+p")
 * // [{ ctrl: true, shift: true, name: "p", meta: false, super: false, leader: false }]
 *
 * // 带 leader 的快捷键
 * const leaderBindings = Keybind.parse("<leader>w")
 * // [{ ctrl: false, shift: false, name: "w", meta: false, super: false, leader: true }]
 *
 * // 多个快捷键
 * const multi = Keybind.parse("ctrl+p,ctrl+shift+p")
 * // 两个 Info 对象的数组
 *
 * // 格式化输出
 * Keybind.toString({
 *   ctrl: true,
 *   shift: true,
 *   name: "p",
 *   meta: false,
 *   super: false,
 *   leader: false
 * })
 * // "ctrl+shift+p"
 *
 * // 匹配快捷键
 * const a = Keybind.parse("ctrl+p")[0]
 * const b = { ctrl: true, name: "p", meta: false, shift: false, super: false, leader: false }
 * Keybind.match(a, b)  // true
 * ```
 *
 * Leader 键：
 * - Leader 键是 Vim 编辑器的概念
 * - 允许用户自定义前缀键
 * - 格式：<leader>+其他键
 * - 例如：<leader>w 可以映射为 Ctrl+w
 *
 * @package opencode
 * @module util/keybind
 */

// 导入 remeda 的深度相等比较
import { isDeepEqual } from "remeda"

// 导入 OpenTUI 的按键解析类型
import type { ParsedKey } from "@opentui/core"

/**
 * 快捷键命名空间
 *
 * 提供快捷键解析、匹配和格式化功能。
 */
export namespace Keybind {
  /**
   * 快捷键信息类型
   *
   * 从 OpenTUI 的 ParsedKey 派生，添加自定义的 leader 字段。
   * 确保类型兼容性并在编译时捕获缺失字段。
   *
   * 字段说明：
   * - name：按键名称（如 "p", "enter", "escape"）
   * - ctrl：是否按住 Control 键
   * - meta：是否按住 Meta/Alt 键
   * - shift：是否按住 Shift 键
   * - super：是否按住 Super/Windows 键
   * - leader：是否使用 leader 前缀键
   */
  export type Info = Pick<ParsedKey, "name" | "ctrl" | "meta" | "shift" | "super"> & {
    leader: boolean  // 自定义的 leader 字段
  }

  /**
   * 比较两个快捷键是否相同
   *
   * 深度比较两个 Info 对象的所有字段。
   *
   * @param a - 第一个快捷键信息
   * @param b - 第二个快捷键信息
   * @returns 是否相同
   *
   * 规范化处理：
   * - super 字段：undefined 和 false 视为等效
   * - 其他字段：严格比较
   *
   * @example
   * ```typescript
   * const a = { ctrl: true, name: "p", meta: false, shift: false, super: false, leader: false }
   * const b = { ctrl: true, name: "p", meta: false, shift: false, super: undefined, leader: false }
   * Keybind.match(a, b)  // true（super 被规范化）
   * ```
   */
  export function match(a: Info, b: Info): boolean {
    // 规范化 super 字段（undefined 和 false 等效）
    const normalizedA = { ...a, super: a.super ?? false }
    const normalizedB = { ...b, super: b.super ?? false }

    // 使用深度相等比较
    return isDeepEqual(normalizedA, normalizedB)
  }

  /**
   * 从 OpenTUI 的 ParsedKey 转换为我们的 Keybind.Info 格式
   *
   * 确保所有必需字段都存在，避免手动创建对象。
   *
   * @param key - OpenTUI 解析的按键
   * @param leader - 是否使用 leader 键（默认 false）
   * @returns Keybind.Info 对象
   *
   * 转换说明：
   * - 直接复制所有字段
   * - super 默认为 false（而非 undefined）
   * - leader 由参数指定
   *
   * @example
   * ```typescript
   * const parsed: ParsedKey = { name: "p", ctrl: true, meta: false, shift: false }
   * const info = Keybind.fromParsedKey(parsed)
   * // { name: "p", ctrl: true, meta: false, shift: false, super: false, leader: false }
   * ```
   */
  export function fromParsedKey(key: ParsedKey, leader = false): Info {
    return {
      name: key.name,          // 按键名称
      ctrl: key.ctrl,          // Control 键状态
      meta: key.meta,          // Meta/Alt 键状态
      shift: key.shift,        // Shift 键状态
      super: key.super ?? false,  // Super 键状态（默认 false）
      leader,                  // Leader 键状态
    }
  }

  /**
   * 将快捷键信息转换为字符串表示
   *
   * 生成易于阅读的快捷键字符串。
   *
   * @param info - 快捷键信息
   * @returns 快捷键字符串（如 "ctrl+shift+p" 或 "<leader> w"）
   *
   * 格式规则：
   * - 修饰键顺序：ctrl, alt, super, shift, 按键名
   * - 用 + 连接各个部分
   * - leader 键使用特殊格式 <leader>
   * - delete 键显示为 del
   *
   * @example
   * ```typescript
   * Keybind.toString({ ctrl: true, name: "p", meta: false, shift: false, super: false, leader: false })
   * // "ctrl+p"
   *
   * Keybind.toString({ ctrl: true, shift: true, name: "p", meta: false, super: false, leader: false })
   * // "ctrl+shift+p"
   *
   * Keybind.toString({ leader: true, name: "w", ctrl: false, meta: false, shift: false, super: false })
   * // "<leader> w"
   * ```
   */
  export function toString(info: Info): string {
    // 存储各部分
    const parts: string[] = []

    // 添加修饰键
    if (info.ctrl) parts.push("ctrl")    // Control 键
    if (info.meta) parts.push("alt")     // Meta/Alt 键（显示为 alt）
    if (info.super) parts.push("super")  // Super/Windows 键
    if (info.shift) parts.push("shift")  // Shift 键

    // 添加按键名
    if (info.name) {
      // delete 键显示为 del（更简洁）
      if (info.name === "delete") parts.push("del")
      else parts.push(info.name)
    }

    // 用 + 连接各部分
    let result = parts.join("+")

    // 如果有 leader 键，添加特殊格式
    if (info.leader) {
      result = result ? `<leader> ${result}` : `<leader>`
    }

    return result
  }

  /**
   * 解析快捷键字符串
   *
   * 将快捷键字符串解析为 Info 对象数组。
   *
   * @param key - 快捷键字符串（支持逗号分隔多个）
   * @returns Info 对象数组
   *
   * 支持的格式：
   * - 单个："ctrl+shift+p"
   * - 多个："ctrl+p,ctrl+shift+p"（逗号分隔）
   * - Leader："<leader>w"
   * - "none"：返回空数组（禁用快捷键）
   *
   * 修饰键识别：
   * - ctrl：Control 键
   * - alt/meta/option：Meta/Alt 键
   * - super：Super/Windows 键
   * - shift：Shift 键
   * - leader：Leader 前缀键
   *
   * 特殊键映射：
   * - esc → escape（ESC 键）
   * - delete → del（Delete 键）
   *
   * @example
   * ```typescript
   * Keybind.parse("ctrl+shift+p")
   * // [{ ctrl: true, shift: true, name: "p", meta: false, super: false, leader: false }]
   *
   * Keybind.parse("<leader>w")
   * // [{ ctrl: false, shift: false, name: "w", meta: false, super: false, leader: true }]
   *
   * Keybind.parse("ctrl+p,ctrl+shift+p")
   * // 两个 Info 对象
   *
   * Keybind.parse("none")
   * // []
   * ```
   */
  export function parse(key: string): Info[] {
    // "none" 表示禁用快捷键
    if (key === "none") return []

    // 按逗号分割多个快捷键
    return key.split(",").map((combo) => {
      // 处理 <leader> 语法，替换为 leader+
      const normalized = combo.replace(/<leader>/g, "leader+")

      // 按加号分割各部分，转为小写
      const parts = normalized.toLowerCase().split("+")

      // 初始化快捷键信息
      const info: Info = {
        ctrl: false,    // Control 键
        meta: false,    // Meta/Alt 键
        shift: false,   // Shift 键
        leader: false,  // Leader 键
        name: "",       // 按键名
      }

      // 遍历各部分，设置对应字段
      for (const part of parts) {
        switch (part) {
          case "ctrl":
            info.ctrl = true
            break
          case "alt":
          case "meta":
          case "option":
            info.meta = true
            break
          case "super":
            info.super = true
            break
          case "shift":
            info.shift = true
            break
          case "leader":
            info.leader = true
            break
          case "esc":
            // ESC 键转换为完整名称
            info.name = "escape"
            break
          default:
            // 其他部分作为按键名
            info.name = part
            break
        }
      }

      return info
    })
  }
}
