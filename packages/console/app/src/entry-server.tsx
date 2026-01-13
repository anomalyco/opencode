/**
 * ============================================================================
 * 文件名：entry-server.tsx
 * 所属包：packages/console/app/src
 * ============================================================================
 *
 * 文件作用：
 * 服务端入口文件。配置 SolidJS 应用的服务端渲染（SSR）。
 *
 * 主要功能：
 * - 创建服务端渲染处理器
 * - 定义 HTML 文档结构
 * - 注入关键 CSS（减少布局偏移）
 * - 配置异步模式
 *
 * 依赖关系：
 * - @solidjs/start/server：SolidJS Start 服务端工具
 *
 * 配置说明：
 * - mode: "async"：启用异步渲染模式
 * - criticalCSS：关键样式内联（提高首屏加载性能）
 *
 * @package console.app
 * @module entry-server
 */

// @refresh reload
// 这个注释告诉 Vite 启用热模块替换（HMR）

// 导入服务端处理器创建工具和启动服务器组件
import { createHandler, StartServer } from "@solidjs/start/server"

/**
 * 关键 CSS
 *
 * 内联的关键样式，在页面加载前立即应用。
 * 这有助于减少布局偏移（CLS），提高 Lighthouse 分数。
 */
const criticalCSS = `[data-component="top"]{min-height:80px;display:flex;align-items:center}`

/**
 * 默认导出：服务端处理器
 *
 * 创建并配置 SolidJS Start 的服务端渲染处理器。
 *
 * 配置项：
 * - mode: "async"：使用异步渲染模式（支持流式渲染）
 */
export default createHandler(
  // 返回 StartServer 组件
  () => (
    <StartServer
      // 文档结构配置
      document={({ assets, children, scripts }) => (
        <html lang="en">
          <head>
            {/* 字符编码声明 */}
            <meta charset="utf-8" />
            {/* 视口配置（响应式设计） */}
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            {/* Open Graph 图片（社交分享预览） */}
            <meta property="og:image" content="/social-share.png" />
            {/* Twitter 卡片图片 */}
            <meta property="twitter:image" content="/social-share.png" />
            {/* 内联关键 CSS */}
            <style>{criticalCSS}</style>
            {/* 资源标签（样式、脚本等） */}
            {assets}
          </head>
          <body>
            {/* 应用挂载点 */}
            <div id="app">{children}</div>
            {/* 客户端脚本 */}
            {scripts}
          </body>
        </html>
      )}
    />
  ),
  // 处理器配置
  {
    // 异步模式（支持流式渲染）
    mode: "async",
  },
)
