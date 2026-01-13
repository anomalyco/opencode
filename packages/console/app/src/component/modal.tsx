/**
 * ============================================================================
 * 文件名：modal.tsx
 * 所属包：packages/console/app/src/component
 * ============================================================================
 *
 * 文件作用：
 * 模态对话框组件。提供可覆盖层显示的弹窗功能。
 *
 * 主要功能：
 * - 受控的显示/隐藏状态
 * - 点击遮罩层关闭
 * - 可选的标题
 * - 点击内容区阻止冒泡
 *
 * 依赖关系：
 * - solid-js：SolidJS 核心库
 * - ./modal.css：组件样式
 *
 * 导出内容：
 * - Modal：模态对话框组件
 *
 * @package console.app
 * @module modal
 */

// 导入 SolidJS 核心功能
import { JSX, Show } from "solid-js"

// 导入组件样式
import "./modal.css"

/**
 * Modal 组件属性
 */
interface ModalProps {
  // 是否打开
  open: boolean
  // 关闭回调
  onClose: () => void
  // 可选标题
  title?: string
  // 对话框内容
  children: JSX.Element
}

/**
 * 模态对话框组件
 *
 * 提供可覆盖层显示的弹窗功能。
 * 点击遮罩层可关闭，点击内容区不会关闭。
 *
 * @param props - 组件属性
 * @returns SolidJS 组件
 *
 * @example
 * ```tsx
 * <Modal open={isOpen} onClose={() => setIsOpen(false)} title="标题">
 *   <p>对话框内容</p>
 * </Modal>
 * ```
 */
export function Modal(props: ModalProps) {
  return (
    <Show when={props.open}>
      {/* 遮罩层 */}
      <div data-component="modal" data-slot="overlay" onClick={props.onClose}>
        {/* 内容区 */}
        <div data-slot="content" onClick={(e) => e.stopPropagation()}>
          {/* 可选标题 */}
          <Show when={props.title}>
            <h2 data-slot="title">{props.title}</h2>
          </Show>
          {/* 对话框内容 */}
          {props.children}
        </div>
      </div>
    </Show>
  )
}
