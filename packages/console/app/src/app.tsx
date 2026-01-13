/**
 * ============================================================================
 * 文件名：app.tsx
 * 所属包：packages/console/app/src
 * ============================================================================
 *
 * 文件作用：
 * SolidJS 应用的根组件。定义应用的整体结构和路由配置。
 *
 * 主要功能：
 * - 配置路由系统
 * - 设置全局 Meta 标签（标题、描述、图标）
 * - 提供字体和样式
 * - 包裹 Suspense 以支持异步加载
 *
 * 依赖关系：
 * - @solidjs/meta：Meta 标签管理
 * - @solidjs/router：路由管理
 * - @solidjs/start/router：文件系统路由
 * - solid-js：SolidJS 核心库
 * - @opencode-ai/ui/favicon：网站图标
 * - @opencode-ai/ui/font：字体配置
 * - @ibm/plex/css：IBM Plex 字体样式
 * - ./app.css：应用全局样式
 *
 * 导出内容：
 * - 默认导出 App 组件
 *
 * @package console.app
 * @module app
 */

// 导入 Meta 标签相关组件（用于 SEO 和页面元数据）
import { MetaProvider, Title, Meta } from "@solidjs/meta"

// 导入路由组件
import { Router } from "@solidjs/router"

// 导入文件系统路由（自动从 routes 目录生成路由）
import { FileRoutes } from "@solidjs/start/router"

// 导入 Suspense 组件（用于异步组件加载）
import { Suspense } from "solid-js"

// 导入网站图标组件
import { Favicon } from "@opencode-ai/ui/favicon"

// 导入字体组件
import { Font } from "@opencode-ai/ui/font"

// 导入 IBM Plex 字体 CSS
import "@ibm/plex/css/ibm-plex.css"

// 导入应用全局样式
import "./app.css"

/**
 * 应用根组件
 *
 * 定义 SolidJS 应用的整体结构，包括：
 * - 路由配置
 * - Meta 标签
 * - 全局样式和字体
 * - 异步加载支持
 *
 * @returns SolidJS 组件
 */
export default function App() {
  return (
    <Router
      // 启用显式链接（明确标记内部链接）
      explicitLinks={true}
      // 根组件配置（包裹所有路由）
      root={(props) => (
        <MetaProvider>
          {/* 页面标题 */}
          <Title>opencode</Title>
          {/* 页面描述（用于 SEO） */}
          <Meta name="description" content="OpenCode - The open source coding agent." />
          {/* 网站图标 */}
          <Favicon />
          {/* 字体配置 */}
          <Font />
          {/* 异步加载包裹器 */}
          <Suspense>{props.children}</Suspense>
        </MetaProvider>
      )}
    >
      {/* 文件系统路由 */}
      <FileRoutes />
    </Router>
  )
}
