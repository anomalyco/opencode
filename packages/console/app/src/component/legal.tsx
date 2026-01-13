/**
 * ============================================================================
 * 文件名：legal.tsx
 * 所属包：packages/console/app/src/component
 * ============================================================================
 *
 * 文件作用：
 * 法律信息组件。显示版权、品牌、隐私政策和服务条款链接。
 *
 * 主要功能：
 * - 显示当前年份的版权信息
 * - 显示品牌、隐私政策、服务条款链接
 *
 * 依赖关系：
 * - @solidjs/router：路由组件
 *
 * 导出内容：
 * - Legal：法律信息组件
 *
 * @package console.app
 * @module legal
 */

// 导入链接组件
import { A } from "@solidjs/router"

/**
 * 法律信息组件
 *
 * 显示网站底部的法律相关信息和链接。
 *
 * @returns SolidJS 组件
 */
export function Legal() {
  return (
    <div data-component="legal">
      {/* 版权信息 */}
      <span>
        ©{new Date().getFullYear()} <a href="https://anoma.ly">Anomaly</a>
      </span>
      {/* 品牌资源链接 */}
      <span>
        <A href="/brand">Brand</A>
      </span>
      {/* 隐私政策链接 */}
      <span>
        <A href="/legal/privacy-policy">Privacy</A>
      </span>
      {/* 服务条款链接 */}
      <span>
        <A href="/legal/terms-of-service">Terms</A>
      </span>
    </div>
  )
}
