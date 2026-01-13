/**
 * ============================================================================
 * 文件名：encode.ts
 * 所属包：packages/util
 * ============================================================================
 *
 * 文件作用：
 * 提供编码和解码相关的工具函数，包括 Base64 编码/解码、哈希计算和校验和计算。
 * 这些函数主要用于数据处理、内容验证和 URL 安全的 Base64 编码转换。
 *
 * 主要功能：
 * - Base64 编码：将字符串编码为 URL 安全的 Base64 格式
 * - Base64 解码：将 URL 安全的 Base64 格式解码回原始字符串
 * - 哈希计算：使用 Web Crypto API 计算内容的加密哈希值
 * - 校验和计算：使用 FNV-1a 算法计算内容的快速校验和
 *
 * 依赖关系：
 * - 使用内置的 TextEncoder 和 TextDecoder API 进行字符编码转换
 * - 使用内置的 btoa 和 atob 函数进行 Base64 编解码
 * - 使用 Web Crypto API (crypto.subtle) 进行加密哈希计算
 *
 * 导出内容：
 * - base64Encode：Base64 编码函数，生成 URL 安全的 Base64 字符串
 * - base64Decode：Base64 解码函数，解析 URL 安全的 Base64 字符串
 * - hash：使用指定算法计算内容的加密哈希值
 * - checksum：计算内容的快速校验和（FNV-1a 算法）
 *
 * @package util
 * @module encode
 */

/**
 * Base64 编码函数
 *
 * 将输入字符串编码为 URL 安全的 Base64 格式。
 * 标准 Base64 包含 +、/ 和 = 字符，这些字符在 URL 中有特殊含义。
 * 此函数将 + 替换为 -，将 / 替换为 _，并移除填充字符 =。
 *
 * @param value - 需要编码的字符串
 * @returns URL 安全的 Base64 编码字符串
 *
 * 编码过程：
 * 1. 使用 TextEncoder 将字符串转换为 UTF-8 字节序列
 * 2. 将字节数组转换为二进制字符串
 * 3. 使用 btoa 将二进制字符串编码为标准 Base64
 * 4. 替换特殊字符使其 URL 安全：
 *    - +（加号）替换为 -（连字符）
 *    - /（斜杠）替换为 _（下划线）
 *    - =（等号）完全移除（用于填充的字符）
 *
 * 使用场景：
 * - URL 参数编码
 * - API 请求中的数据传输
 * - 需要在 URL 中安全传递的编码数据
 */
export function base64Encode(value: string) {
  // 使用 TextEncoder 将字符串转换为 UTF-8 字节数组
  // TextEncoder 是浏览器和 Node.js 都支持的内置 API
  const bytes = new TextEncoder().encode(value)

  // 将字节数组转换为二进制字符串
  // Array.from 遍历每个字节，String.fromCharCode 将字节转换为字符
  // 然后用 join("") 将所有字符连接成一个字符串
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("")

  // 使用 btoa（binary to ASCII）将二进制字符串编码为 Base64
  // 然后进行 URL 安全转换：
  // - replace(/\+/g, "-")：将所有 + 替换为 -
  // - replace(/\//g, "_")：将所有 / 替换为 _
  // - replace(/=/g, "")：移除所有 =（Base64 填充字符）
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

/**
 * Base64 解码函数
 *
 * 将 URL 安全的 Base64 格式字符串解码回原始字符串。
 * 此函数是 base64Encode 的逆操作，会将 URL 安全字符还原为标准 Base64 字符。
 *
 * @param value - 需要解码的 URL 安全 Base64 字符串
 * @returns 解码后的原始字符串
 *
 * 解码过程：
 * 1. 将 URL 安全字符替换回标准 Base64 字符：
 *    - -（连字符）替换回 +（加号）
 *    - _（下划线）替换回 /（斜杠）
 * 2. 使用 atob 将标准 Base64 字符串解码为二进制字符串
 * 3. 将二进制字符串转换为字节数组
 * 4. 使用 TextDecoder 将 UTF-8 字节数组转换为原始字符串
 *
 * 使用场景：
 * - 解析 URL 参数中的编码数据
 * - 解析 API 响应中的 Base64 数据
 * - 从 URL 安全格式还原原始数据
 */
export function base64Decode(value: string) {
  // 将 URL 安全的 Base64 字符转换回标准 Base64 字符
  // - replace(/-/g, "+")：将所有 - 替换回 +
  // - replace(/_/g, "/")：将所有 _ 替换回 /
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"))

  // 将二进制字符串转换为 Uint8Array 字节数组
  // Uint8Array.from 遍历二进制字符串的每个字符
  // charCodeAt(0) 获取字符的 ASCII 码（即字节值）
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))

  // 使用 TextDecoder 将 UTF-8 字节数组解码为原始字符串
  // 这是 TextEncoder 的逆操作
  return new TextDecoder().decode(bytes)
}

/**
 * 加密哈希计算函数
 *
 * 使用 Web Crypto API 计算输入内容的加密哈希值。
 * 支持多种哈希算法，默认使用 SHA-256。
 *
 * @param content - 需要计算哈希的字符串内容
 * @param algorithm - 使用的哈希算法，默认为 "SHA-256"
 *                    支持的算法包括：SHA-1、SHA-256、SHA-384、SHA-512
 * @returns 十六进制格式的哈希字符串
 *
 * 哈希过程：
 * 1. 创建 TextEncoder 实例用于字符编码
 * 2. 将输入字符串编码为 UTF-8 字节数组
 * 3. 使用 crypto.subtle.digest 计算字节数组的哈希值
 *    - 这是异步操作，因为可能涉及硬件加速
 * 4. 将哈希结果（ArrayBuffer）转换为 Uint8Array
 * 5. 将每个字节转换为两位十六进制字符串
 *    - toString(16) 将数字转为十六进制
 *    - padStart(2, "0") 确保单字节始终是两位（如 0f 而非 f）
 * 6. 连接所有十六进制字符形成最终的哈希字符串
 *
 * 使用场景：
 * - 密码存储和验证
 * - 数据完整性验证
 * - 数字签名
 * - 内容去重和缓存键生成
 *
 * @example
 * ```typescript
 * const hash1 = await hash("hello")  // SHA-256 哈希
 * const hash2 = await hash("world", "SHA-512")  // SHA-512 哈希
 * ```
 */
export async function hash(content: string, algorithm = "SHA-256"): Promise<string> {
  // 创建 TextEncoder 实例，用于将字符串转换为 UTF-8 字节
  const encoder = new TextEncoder()

  // 将输入字符串编码为 UTF-8 字节数组（Uint8Array）
  const data = encoder.encode(content)

  // 使用 Web Crypto Subtle API 计算哈希值
  // crypto.subtle.digest 是异步的，返回一个 Promise<ArrayBuffer>
  // algorithm 参数指定哈希算法，如 "SHA-256"、"SHA-512" 等
  const hashBuffer = await crypto.subtle.digest(algorithm, data)

  // 将 ArrayBuffer 转换为 Uint8Array 以便处理
  const hashArray = Array.from(new Uint8Array(hashBuffer))

  // 将每个字节转换为两位十六进制字符串并连接
  // map 遍历每个字节，将其转换为十六进制表示
  // padStart(2, "0") 确保单字节始终显示为两位（如 0a 而非 a）
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")

  // 返回最终的十六进制哈希字符串
  return hashHex
}

/**
 * 快速校验和计算函数
 *
 * 使用 FNV-1a（Fowler-Noll-Vo）哈希算法计算内容的快速校验和。
 * 这是一个非加密哈希算法，主要用于快速比较和查找。
 *
 * @param content - 需要计算校验和的字符串内容
 * @returns 十六进制格式的校验和字符串，如果内容为空则返回 undefined
 *
 * 算法说明：
 * FNV-1a 是一个简单但高效的哈希算法：
 * 1. 使用初始哈希值 0x811c9dc5（FNV offset basis）
 * 2. 对输入字符串的每个字符：
 *    a. 将哈希值与字符码进行异或（XOR）操作
 *    b. 将哈希值乘以 FNV prime 0x01000193
 * 3. 最后将结果转换为无符号整数并转为 base36 字符串
 *
 * 特点：
 * - 非常快速的计算速度
 * - 低碰撞率（但不如加密哈希）
 * - 不适用于安全场景，仅用于快速比较
 *
 * 使用场景：
 * - 快速比较字符串是否相同
 * - 生成缓存键
 * - 数据快速去重
 * - 内存中的数据结构索引
 *
 * @example
 * ```typescript
 * const sum1 = checksum("hello")  // 返回类似 "8v5g4" 的字符串
 * const sum2 = checksum("")  // 返回 undefined
 * const sum3 = checksum("hello")  // 与 sum1 相同
 * ```
 */
export function checksum(content: string): string | undefined {
  // 如果内容为空，返回 undefined
  // 这是特殊处理，避免对空字符串进行无意义的计算
  if (!content) return undefined

  // 初始化 FNV-1a 哈希值
  // 0x811c9dc5 是 32 位 FNV-1a 的标准偏移基数（offset basis）
  let hash = 0x811c9dc5

  // 遍历输入字符串的每个字符
  for (let i = 0; i < content.length; i++) {
    // 将哈希值与当前字符的 Unicode 码点进行异或（XOR）操作
    // FNV-1a 与 FNV-1 的区别在于：先异或再乘，而不是先乘再异或
    hash ^= content.charCodeAt(i)

    // 将哈希值乘以 FNV prime（质数）0x01000193
    // Math.imul 是 JavaScript 32 位整数乘法，比普通 * 更快且正确处理溢出
    hash = Math.imul(hash, 0x01000193)
  }

  // 将哈希值转换为无符号 32 位整数（>>> 0 执行无符号右移）
  // 然后转换为 base36 字符串（0-9 和 a-z，共 36 个字符）
  // base36 比十六进制更紧凑，适合用于字符串表示
  return (hash >>> 0).toString(36)
}
