/**
 * ============================================================================
 * 文件名：path.ts
 * 所属包：packages/util
 * ============================================================================
 *
 * 文件作用：
 * 提供文件路径解析和处理的工具函数。
 * 这些函数用于从文件路径中提取有用的信息，如文件名、目录和文件扩展名。
 *
 * 主要功能：
 * - 获取文件名：从完整路径中提取文件名部分
 * - 获取目录：从完整路径中提取目录部分
 * - 获取文件扩展名：从文件路径中提取文件扩展名
 *
 * 依赖关系：
 * - 无外部依赖，仅使用 JavaScript 内置字符串方法
 *
 * 导出内容：
 * - getFilename：从路径中提取文件名
 * - getDirectory：从路径中提取目录路径
 * - getFileExtension：从路径中提取文件扩展名
 *
 * 使用场景：
 * - 文件系统操作
 * - 路径解析和处理
 * - 文件类型判断
 * - 文件名和目录分离
 *
 * @package util
 * @module path
 */

/**
 * 获取文件名函数
 *
 * 从文件路径中提取文件名部分，忽略目录和路径分隔符。
 * 支持 Unix 风格（/）和 Windows 风格（\）的路径分隔符。
 *
 * @param path - 文件路径字符串，可能包含目录和文件名
 * @returns 路径中的文件名部分，如果路径为空则返回空字符串
 *
 * 处理逻辑：
 * 1. 如果路径为空或 undefined，直接返回空字符串
 * 2. 移除路径末尾的所有路径分隔符（避免将空字符串当作文件名）
 * 3. 使用正则表达式分割路径，支持 / 和 \ 两种分隔符
 * 4. 返回路径的最后一部分（即文件名）
 *
 * 使用场景：
 * - 从完整文件路径中提取文件名
 * - 显示文件列表时的文件名获取
 * - 文件操作前的文件名验证
 *
 * @example
 * ```typescript
 * getFilename("/path/to/file.txt")  // 返回 "file.txt"
 * getFilename("C:\\Users\\test.txt")  // 返回 "test.txt"
 * getFilename("/path/to/dir/")  // 返回 "dir"
 * getFilename("")  // 返回 ""
 * getFilename(undefined)  // 返回 ""
 * ```
 */
export function getFilename(path: string | undefined) {
  // 如果路径为空或 undefined，返回空字符串
  // 这是防御性编程，避免后续操作出错
  if (!path) return ""

  // 移除路径末尾的所有路径分隔符
  // 正则表达式 /[\/\\]+$/ 匹配末尾的一个或多个 / 或 \ 字符
  // replace 将它们替换为空字符串，确保不会因为末尾分隔符返回空文件名
  const trimmed = path.replace(/[\/\\]+$/, "")

  // 使用正则表达式分割路径
  // /[\/\\]/ 匹配 / 或 \ 任意一个分隔符
  // split 将路径按分隔符分割成数组
  const parts = trimmed.split(/[\/\\]/)

  // 返回数组的最后一个元素，即文件名
  // 使用空值合并运算符 ?? 确保如果数组为空时返回空字符串
  return parts[parts.length - 1] ?? ""
}

/**
 * 获取目录函数
 *
 * 从文件路径中提取目录部分，返回包含末尾斜杠的目录路径。
 * 注意：此函数只处理 Unix 风格的路径分隔符（/）。
 *
 * @param path - 文件路径字符串
 * @returns 目录路径，以斜杠结尾，如果路径为空则返回空字符串
 *
 * 处理逻辑：
 * 1. 如果路径为空或 undefined，直接返回空字符串
 * 2. 使用 / 分隔符分割路径
 * 3. 取除最后一个元素外的所有部分（即目录路径）
 * 4. 用 / 连接并添加末尾斜杠
 *
 * 使用场景：
 * - 从文件路径中提取目录路径
 * - 创建文件时获取目标目录
 * - 路径处理和拼接
 *
 * @example
 * ```typescript
 * getDirectory("/path/to/file.txt")  // 返回 "/path/to/"
 * getDirectory("file.txt")  // 返回 "/"
 * getDirectory("")  // 返回 ""
 * getDirectory(undefined)  // 返回 ""
 * ```
 *
 * 注意事项：
 * - 此函数只处理 Unix 风格路径（/），不处理 Windows 风格（\）
 * - 即使输入路径没有目录部分，也会返回带斜杠的路径
 */
export function getDirectory(path: string | undefined) {
  // 如果路径为空或 undefined，返回空字符串
  if (!path) return ""

  // 使用 / 分隔符分割路径
  // 注意：此函数只处理 Unix 风格路径，不处理 Windows 风格
  const parts = path.split("/")

  // 取除最后一个元素外的所有部分（即目录路径）
  // slice(0, parts.length - 1) 返回从开始到倒数第二个元素的数组
  // 然后 join("/") 将它们用 / 连接起来
  // 最后添加 / 确保目录路径以分隔符结尾
  return parts.slice(0, parts.length - 1).join("/") + "/"
}

/**
 * 获取文件扩展名函数
 *
 * 从文件路径中提取文件扩展名（最后一个点后的部分）。
 *
 * @param path - 文件路径字符串
 * @returns 文件扩展名（不包含点），如果路径为空则返回空字符串
 *
 * 处理逻辑：
 * 1. 如果路径为空或 undefined，直接返回空字符串
 * 2. 使用点（.）作为分隔符分割路径
 * 3. 返回最后一个部分（即扩展名）
 *
 * 使用场景：
 * - 判断文件类型
 * - 根据扩展名选择处理方式
 * - 文件过滤和分类
 *
 * @example
 * ```typescript
 * getFileExtension("/path/to/file.txt")  // 返回 "txt"
 * getFileExtension("archive.tar.gz")  // 返回 "gz"
 * getFileExtension("noextension")  // 返回 "noextension"
 * getFileExtension("")  // 返回 ""
 * getFileExtension(undefined)  // 返回 ""
 * ```
 *
 * 注意事项：
 * - 如果文件名有多个点，只返回最后一个点后的部分
 * - 如果文件没有扩展名（没有点），返回整个文件名
 * - 不检查扩展名是否有效，只是简单地分割字符串
 */
export function getFileExtension(path: string | undefined) {
  // 如果路径为空或 undefined，返回空字符串
  if (!path) return ""

  // 使用点（.）作为分隔符分割路径
  // split(".") 将路径按点分割成数组
  const parts = path.split(".")

  // 返回数组的最后一个元素，即扩展名
  // 如果没有点（没有扩展名），返回整个字符串
  // 如果有多个点，返回最后一个点后的部分
  return parts[parts.length - 1]
}
