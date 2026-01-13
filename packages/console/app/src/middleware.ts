/**
 * ============================================================================
 * 文件名：middleware.ts
 * 所属包：packages/console/app/src
 * ============================================================================
 *
 * 文件作用：
 * SolidJS Start 中间件配置。在响应发送前执行自定义逻辑。
 *
 * 主要功能：
 * - 提供 onBeforeResponse 钩子
 * - 可用于添加自定义响应头、日志等
 *
 * 依赖关系：
 * - @solidjs/start/middleware：中间件创建工具
 *
 * 导出内容：
 * - 默认导出中间件实例
 *
 * @package console.app
 * @module middleware
 */

// 导入中间件创建工具
import { createMiddleware } from "@solidjs/start/middleware"

/**
 * 默认中间件
 *
 * 创建并配置 SolidJS Start 的请求处理中间件。
 * 当前版本未实现具体逻辑，预留扩展点。
 */
export default createMiddleware({
  /**
   * 响应发送前的钩子
   *
   * 在响应发送到客户端之前执行。
   * 可用于：
   * - 添加自定义响应头
   * - 记录请求日志
   * - 修改响应内容
   */
  onBeforeResponse() {},
  // 当前为空实现，预留扩展点
})
