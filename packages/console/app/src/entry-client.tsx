/**
 * ============================================================================
 * 文件名：entry-client.tsx
 * 所属包：packages/console/app/src
 * ============================================================================
 *
 * 文件作用：
 * 客户端入口文件。在浏览器中启动 SolidJS 应用。
 *
 * 主要功能：
 * - 将 SolidJS 应用挂载到 DOM
 * - 启用热模块替换（HMR）
 *
 * 依赖关系：
 * - @solidjs/start/client：SolidJS Start 客户端启动工具
 *
 * 使用说明：
 * - 由 Vite 在开发模式下加载
 * - 通过 @refresh reload 注释启用 HMR
 * - 在 app 元素上挂载应用
 *
 * @package console.app
 * @module entry-client
 */

// @refresh reload
// 这个注释告诉 Vite 启用热模块替换（HMR）
// 开发模式下代码更改时自动刷新浏览器

// 导入挂载函数和启动客户端组件
import { mount, StartClient } from "@solidjs/start/client"

/**
 * 挂载应用到 DOM
 *
 * 将 SolidJS Start 应用挂载到 HTML 中的 app 元素。
 * - mount：挂载函数
 * - StartClient：客户端启动组件（处理路由、hydration 等）
 * - document.getElementById("app")!：获取挂载点（! 表示非空断言）
 */
mount(() => <StartClient />, document.getElementById("app")!)
