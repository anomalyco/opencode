/**
 * ============================================================================
 * 文件名：log-processor.ts
 * 所属包：packages/console/function/src
 * ============================================================================
 *
 * 文件作用：
 * OpenCode Zen API 的日志处理云函数。
 * 收集 Cloudflare Workers 的日志，提取指标数据，发送到 Honeycomb 进行监控分析。
 *
 * 主要功能：
 * - 监听 Cloudflare Workers 的 tail 日志
 * - 过滤 Zen API 相关的请求
 * - 提取请求指标（地理位置、耗时、状态码等）
 * - 解析自定义指标（从日志中提取）
 * - 发送指标到 Honeycomb
 *
 * 依赖关系：
 * - @opencode-ai/console-resource：资源访问（Honeycomb API Key）
 * - @cloudflare/workers-types：Cloudflare Workers 类型
 *
 * 导出内容：
 * - default：Cloudflare Worker Tail Handler
 *
 * 使用场景：
 * - 监控 Zen API 性能
 * - 分析用户请求模式
 * - 追踪错误和异常
 *
 * @package console.function
 * @module log-processor
 */

// 导入资源访问模块
// 用于获取 Honeycomb API Key
import { Resource } from "@opencode-ai/console-resource"

// 导入 Cloudflare Workers Tail 事件类型
// TraceItem：tail 事件的单个条目类型
import type { TraceItem } from "@cloudflare/workers-types"

/**
 * 默认导出：Cloudflare Worker Tail Handler
 *
 * Tail Handler 用于实时接收 Cloudflare Workers 的日志流。
 */
export default {
  /**
   * tail 方法
   *
   * 当 Worker 产生日志时，Cloudflare 会调用此方法。
   *
   * @param events - 日志事件数组
   */
  async tail(events: TraceItem[]) {
    // 遍历所有日志事件
    for (const event of events) {
      // 跳过没有事件数据的日志
      if (!event.event) continue

      // 跳过不是 HTTP 请求的日志
      if (!("request" in event.event)) continue

      // 只处理 POST 请求
      // Zen API 的主要端点都是 POST 请求
      if (event.event.request.method !== "POST") continue

      // 解析请求 URL
      const url = new URL(event.event.request.url)

      // 过滤：只处理 Zen API 相关的端点
      if (
        // 聊天补全端点
        url.pathname !== "/zen/v1/chat/completions" &&
        // 消息端点
        url.pathname !== "/zen/v1/messages" &&
        // 响应端点
        url.pathname !== "/zen/v1/responses" &&
        // 模型相关端点
        !url.pathname.startsWith("/zen/v1/models/")
      )
        return

      // 构建基础指标对象
      let metrics = {
        // 事件类型标识
        event_type: "completions",

        // Cloudflare 提供的地理位置信息
        // 大洲（如 NA、EU、AS）
        "cf.continent": event.event.request.cf?.continent,
        // 国家代码（如 US、CN）
        "cf.country": event.event.request.cf?.country,
        // 城市名称
        "cf.city": event.event.request.cf?.city,
        // 地区名称（如 California）
        "cf.region": event.event.request.cf?.region,
        // 纬度
        "cf.latitude": event.event.request.cf?.latitude,
        // 经度
        "cf.longitude": event.event.request.cf?.longitude,
        // 时区
        "cf.timezone": event.event.request.cf?.timezone,

        // 性能指标
        // 请求耗时（毫秒）
        duration: event.wallTime,

        // 请求大小
        // 从 content-length 头获取请求体大小
        request_length: parseInt(event.event.request.headers["content-length"] ?? "0"),

        // 响应状态码
        status: event.event.response?.status ?? 0,

        // 客户端真实 IP
        ip: event.event.request.headers["x-real-ip"],
      }

      // 解析日志中的自定义指标
      // 应用代码可以通过 `console.log("_metric:" + JSON.stringify({...}))` 添加额外指标
      for (const log of event.logs) {
        // 遍历每条日志消息
        for (const message of log.message) {
          // 只处理以 "_metric:" 开头的消息
          if (!message.startsWith("_metric:")) continue

          // 解析 JSON 并合并到 metrics 对象
          // 这样应用可以添加自定义指标，如 model、tokens、cost 等
          metrics = { ...metrics, ...JSON.parse(message.slice(8)) }
        }
      }

      // 打印指标用于调试
      console.log(JSON.stringify(metrics, null, 2))

      // 发送指标到 Honeycomb
      const ret = await fetch("https://api.honeycomb.io/1/events/zen", {
        method: "POST",
        headers: {
          // 指定内容类型为 JSON
          "Content-Type": "application/json",
          // 设置事件时间（Honeycomb 用此时间索引事件）
          "X-Honeycomb-Event-Time": (event.eventTimestamp ?? Date.now()).toString(),
          // Honeycomb API Key（用于认证）
          "X-Honeycomb-Team": Resource.HONEYCOMB_API_KEY.value,
        },
        // 发送指标数据
        body: JSON.stringify(metrics),
      })

      // 打印响应状态用于调试
      console.log(ret.status)
      // 打印响应文本用于调试
      console.log(await ret.text())
    }
  },
}
