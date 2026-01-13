/**
 * ============================================================================
 * 文件名：color.ts
 * 所属包：packages/opencode/src/util
 * ============================================================================
 *
 * 文件作用：
 * 颜色处理工具模块。提供颜色验证、转换和终端 ANSI 转码功能。
 *
 * 主要功能：
 * - isValidHex()：验证十六进制颜色格式
 * - hexToRgb()：将十六进制颜色转换为 RGB
 * - hexToAnsiBold()：将十六进制颜色转换为 ANSI 粗体转义码
 *
 * 依赖关系：
 * - 无外部依赖
 *
 * 导出内容：
 * - Color namespace：颜色命名空间
 *   - isValidHex(hex)：验证颜色格式
 *   - hexToRgb(hex)：转换为 RGB
 *   - hexToAnsiBold(hex)：转换为 ANSI 粗体
 *
 * 颜色格式：
 * - 输入：#RRGGBB 格式的十六进制颜色
 * - RGB：{ r, g, b } 对象，每个分量 0-255
 * - ANSI：24 位真彩色 ANSI 转义码
 *
 * 使用场景：
 * - 终端 UI 的颜色渲染
 * - 日志输出的颜色标记
 * - TUI（Terminal UI）界面样式
 * - 验证用户输入的颜色值
 *
 * 使用示例：
 * ```typescript
 * // 验证颜色格式
 * Color.isValidHex("#ff0000")  // true
 * Color.isValidHex("#f00")     // false
 * Color.isValidHex("ff0000")   // false
 * Color.isValidHex(undefined)  // false
 *
 * // 转换为 RGB
 * Color.hexToRgb("#ff0000")    // { r: 255, g: 0, b: 0 }
 * Color.hexToRgb("#00ff00")    // { r: 0, g: 255, b: 0 }
 *
 * // 转换为 ANSI 粗体（用于终端输出）
 * const redBold = Color.hexToAnsiBold("#ff0000")
 * console.log(`${redBold}Bold red text\x1b[0m`)
 *
 * // 在 TUI 中使用
 * const color = Color.hexToAnsiBold(theme.primary)
 * terminal.write(`${color}Important message${reset()}`)
 * ```
 *
 * ANSI 转义码：
 * - \x1b[38;2;R;G;Bm：设置 24 位前景色
 * - \x1b[1m：设置粗体
 * - \x1b[0m：重置所有样式
 *
 * 十六进制格式：
 * - 必须以 # 开头
 * - 必须 6 位十六进制数（3 字节）
 * - 不支持简写格式（如 #f00）
 * - 不支持 alpha 通道（如 #ff000080）
 *
 * @package opencode
 * @module util/color
 */

/**
 * 颜色命名空间
 *
 * 提供颜色处理相关的工具函数。
 */
export namespace Color {
  /**
   * 验证十六进制颜色格式
   *
   * 检查字符串是否为有效的 #RRGGBB 格式。
   *
   * @param hex - 待验证的颜色字符串
   * @returns 是否为有效的十六进制颜色（类型守卫）
   *
   * 验证规则：
   * - 必须以 # 开头
   * - 后跟 6 位十六进制数字（0-9, a-f, A-F）
   * - 不接受简写格式（如 #f00）
   * - 不接受 alpha 通道（如 #ff000080）
   *
   * 类型守卫：
   * - 返回 true 时，TypeScript 会将参数类型缩小为 string
   * - 返回 false 时，参数类型为 string | undefined
   *
   * @example
   * ```typescript
   * let color: string | undefined = "#ff0000"
   *
   * if (Color.isValidHex(color)) {
   *   // color 的类型现在是 string
   *   const rgb = Color.hexToRgb(color)
   * }
   * ```
   */
  export function isValidHex(hex?: string): hex is string {
    // 如果值为空，返回 false
    if (!hex) return false

    // 使用正则表达式验证格式
    // ^#：以 # 开头
    // [0-9a-fA-F]{6}：6 位十六进制数字
    // $：字符串结束
    return /^#[0-9a-fA-F]{6}$/.test(hex)
  }

  /**
   * 将十六进制颜色转换为 RGB 对象
   *
   * 解析 #RRGGBB 格式的颜色，提取 RGB 分量。
   *
   * @param hex - 十六进制颜色字符串（格式：#RRGGBB）
   * @returns RGB 对象，包含 r、g、b 分量（0-255）
   *
   * 解析过程：
   * 1. hex.slice(1, 3)：提取 RR 部分（跳过 #）
   * 2. parseInt(..., 16)：将十六进制转换为十进制
   * 3. 同样处理 GG 和 BB 部分
   *
   * @example
   * ```typescript
   * Color.hexToRgb("#ff0000")  // { r: 255, g: 0, b: 0 } 红色
   * Color.hexToRgb("#00ff00")  // { r: 0, g: 255, b: 0 } 绿色
   * Color.hexToRgb("#0000ff")  // { r: 0, g: 0, b: 255 } 蓝色
   * Color.hexToRgb("#ffffff")  // { r: 255, g: 255, b: 255 } 白色
   * Color.hexToRgb("#000000")  // { r: 0, g: 0, b: 0 } 黑色
   * ```
   */
  export function hexToRgb(hex: string): { r: number; g: number; b: number } {
    // 提取并转换 R 分量（第 1-2 个字符）
    const r = parseInt(hex.slice(1, 3), 16)

    // 提取并转换 G 分量（第 3-4 个字符）
    const g = parseInt(hex.slice(3, 5), 16)

    // 提取并转换 B 分量（第 5-6 个字符）
    const b = parseInt(hex.slice(5, 7), 16)

    // 返回 RGB 对象
    return { r, g, b }
  }

  /**
   * 将十六进制颜色转换为 ANSI 粗体转义码
   *
   * 生成适用于终端的 24 位真彩色 + 粗体转义序列。
   *
   * @param hex - 十六进制颜色字符串（可选）
   * @returns ANSI 转义码字符串，无效输入返回 undefined
   *
   * ANSI 转义码格式：
   * - \x1b[38;2;R;G;Bm：设置 24 位前景色
   * - \x1b[1m：设置粗体
   * - 组合后：\x1b[38;2;R;G;Bm\x1b[1m
   *
   * 使用方式：
   * ```typescript
   * const colored = Color.hexToAnsiBold("#ff0000")
   * if (colored) {
   *   console.log(`${colored}红色粗体文本\x1b[0m`)
   * }
   * ```
   *
   * 重置样式：
   * - 使用 \x1b[0m 重置所有样式（颜色、粗体等）
   * - 建议在着色文本后添加重置序列
   *
   * 终端兼容性：
   * - 24 位真彩色需要较新的终端支持
   * - 大多数现代终端都支持
   *
   * @example
   * ```typescript
   * const reset = "\x1b[0m"
   *
   * // 红色粗体警告
   * const warn = Color.hexToAnsiBold("#ff0000")
   * console.log(`${warn}警告：${reset}重要消息`)
   *
   * // 绿色粗体成功
   * const success = Color.hexToAnsiBold("#00ff00")
   * console.log(`${success}成功：${reset}操作完成`)
   * ```
   */
  export function hexToAnsiBold(hex?: string): string | undefined {
    // 验证颜色格式
    if (!isValidHex(hex)) return undefined

    // 转换为 RGB
    const { r, g, b } = hexToRgb(hex)

    // 返回 ANSI 转义序列
    // \x1b[38;2;R;G;Bm：设置 24 位前景色
    // \x1b[1m：设置粗体
    return `\x1b[38;2;${r};${g};${b}m\x1b[1m`
  }
}
