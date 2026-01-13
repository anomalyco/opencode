/**
 * ============================================================================
 * 文件名：faq.tsx
 * 所属包：packages/console/app/src/component
 * ============================================================================
 *
 * 文件作用：
 * FAQ（常见问题）组件。提供可折叠的问答列表。
 *
 * 主要功能：
 * - 可折叠展开的问答项
 * - 带有加减号图标指示状态
 *
 * 依赖关系：
 * - @kobalte/core/collapsible：Kobalt 折叠组件
 * - solid-js：SolidJS 核心库
 *
 * 导出内容：
 * - Faq：FAQ 组件
 *
 * @package console.app
 * @module faq
 */

// 导入 Kobalt 折叠组件
import { Collapsible } from "@kobalte/core/collapsible"

// 导入父组件属性类型
import { ParentProps } from "solid-js"

/**
 * FAQ 组件
 *
 * 可折叠的常见问题组件。
 *
 * @param props.question - 问题文本
 * @param props.children - 答案内容
 * @returns SolidJS 组件
 */
export function Faq(props: ParentProps & { question: string }) {
  return (
    <Collapsible data-slot="faq-item">
      {/* 触发器（问题区域） */}
      <Collapsible.Trigger data-slot="faq-question">
        {/* 加号图标（展开时显示） */}
        <svg
          data-slot="faq-icon-plus"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="currentColor"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M12.5 11.5H19V12.5H12.5V19H11.5V12.5H5V11.5H11.5V5H12.5V11.5Z" fill="currentColor" />
        </svg>
        {/* 减号图标（折叠时显示） */}
        <svg
          data-slot="faq-icon-minus"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="currentColor"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M5 11.5H19V12.5H5Z" fill="currentColor" />
        </svg>
        {/* 问题文本 */}
        <div data-slot="faq-question-text">{props.question}</div>
      </Collapsible.Trigger>
      {/* 内容区域（答案） */}
      <Collapsible.Content data-slot="faq-answer">{props.children}</Collapsible.Content>
    </Collapsible>
  )
}
