/**
 * ============================================================================
 * 文件名：status.ts
 * 所属包：packages/console/app/src/routes/auth
 * ============================================================================
 *
 * 文件作用：
 * 认证状态查询路由。返回当前会话的认证信息。
 *
 * 主要功能：
 * - 获取当前会话数据
 * - 以 JSON 格式返回认证状态
 *
 * 依赖关系：
 * - @solidjs/start：API 事件类型
 * - ~/context/auth：会话管理
 *
 * 导出内容：
 * - GET：处理 GET 请求，返回会话状态
 *
 * 路由：
 * - GET /auth/status → 返回当前会话 JSON
 *
 * 返回数据格式：
 * ```json
 * {
 *   "account": {
 *     "acc_xxx": {
 *       "id": "acc_xxx",
 *       "email": "user@example.com"
 *     }
 *   },
 *   "current": "acc_xxx"
 * }
 * ```
 *
 * 使用场景：
 * - 前端检查用户登录状态
 * - 获取当前用户信息
 * - 调试认证流程
 *
 * @package console.app
 * @module auth/routes
 */

// 导入 API 事件类型
import { APIEvent } from "@solidjs/start"

// 导入会话管理
import { useAuthSession } from "~/context/auth"

/**
 * 认证状态查询路由处理器
 *
 * 获取并返回当前会话的认证状态：
 * 1. 从会话存储中获取会话数据
 * 2. 以 JSON 格式返回会话信息
 *
 * @param input - API 事件对象
 * @returns JSON 格式的会话数据
 *
 * @example
 * 请求 GET /auth/status
 *
 * 响应（已登录）：
 * ```json
 * {
 *   "account": {
 *     "acc_123": { "id": "acc_123", "email": "user@example.com" },
 *     "acc_456": { "id": "acc_456", "email": "admin@example.com" }
 *   },
 *   "current": "acc_123"
 * }
 * ```
 *
 * 响应（未登录）：
 * ```json
 * {
 *   "account": {},
 *   "current": undefined
 * }
 * ```
 */
export async function GET(input: APIEvent) {
  // 获取会话存储
  const session = await useAuthSession()
  // 以 JSON 格式返回会话数据
  return Response.json(session.data)
}
