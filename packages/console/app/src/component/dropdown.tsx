/**
 * ============================================================================
 * 文件名：dropdown.tsx
 * 所属包：packages/console/app/src/component
 * ============================================================================
 *
 * 文件作用：
 * 下拉菜单组件。提供可展开/收起的下拉菜单功能。
 *
 * 主要功能：
 * - 可受控或非受控的开关状态
 * - 点击外部自动关闭
 * - 左/右对齐支持
 * - 带有箭头图标的触发按钮
 *
 * 依赖关系：
 * - solid-js：SolidJS 核心库
 * - solid-js/store：SolidJS 状态管理
 * - ./icon：图标组件
 * - ./dropdown.css：组件样式
 *
 * 导出内容：
 * - Dropdown：下拉菜单组件
 * - DropdownItem：下拉菜单项组件
 *
 * @package console.app
 * @module dropdown
 */

// 导入 SolidJS 核心功能
import { JSX, Show, createEffect, onCleanup } from "solid-js"

// 导入 SolidJS Store（细粒度响应式状态）
import { createStore } from "solid-js/store"

// 导入箭头图标
import { IconChevron } from "./icon"

// 导入组件样式
import "./dropdown.css"

/**
 * Dropdown 组件属性
 */
interface DropdownProps {
  // 触发器内容（JSX 元素或字符串）
  trigger: JSX.Element | string
  // 下拉菜单内容
  children: JSX.Element
  // 可控的开关状态（可选）
  open?: boolean
  // 开关状态变化回调（可选）
  onOpenChange?: (open: boolean) => void
  // 对齐方式（左或右）
  align?: "left" | "right"
  // 自定义类名
  class?: string
}

/**
 * 下拉菜单组件
 *
 * 提供可展开/收起的下拉菜单功能。
 * 支持受控和非受控模式。
 *
 * @param props - 组件属性
 * @returns SolidJS 组件
 *
 * @example
 * ```tsx
 * <Dropdown trigger="菜单" align="right">
 *   <DropdownItem onClick={handleClick}>选项 1</DropdownItem>
 *   <DropdownItem>选项 2</DropdownItem>
 * </Dropdown>
 * ```
 */
export function Dropdown(props: DropdownProps) {
  // 创建本地状态存储
  const [store, setStore] = createStore({
    // 开关状态（如果 props.open 未定义，默认为关闭）
    isOpen: props.open ?? false,
  })
  // 下拉菜单容器引用
  let dropdownRef: HTMLDivElement | undefined

  // 同步 props.open 到本地状态
  createEffect(() => {
    if (props.open !== undefined) {
      setStore("isOpen", props.open)
    }
  })

  // 点击外部关闭下拉菜单
  createEffect(() => {
    // 点击外部事件处理器
    const handleClickOutside = (event: MouseEvent) => {
      // 如果点击的是下拉菜单外部，关闭菜单
      if (dropdownRef && !dropdownRef.contains(event.target as Node)) {
        setStore("isOpen", false)
        props.onOpenChange?.(false)
      }
    }

    // 添加全局点击监听
    document.addEventListener("click", handleClickOutside)
    // 清理时移除监听
    onCleanup(() => document.removeEventListener("click", handleClickOutside))
  })

  // 切换开关状态
  const toggle = () => {
    const newValue = !store.isOpen
    setStore("isOpen", newValue)
    props.onOpenChange?.(newValue)
  }

  return (
    <div data-component="dropdown" class={props.class} ref={dropdownRef}>
      {/* 触发按钮 */}
      <button data-slot="trigger" type="button" onClick={toggle}>
        {/* 如果触发器是字符串，用 span 包裹 */}
        {typeof props.trigger === "string" ? <span>{props.trigger}</span> : props.trigger}
        {/* 箭头图标 */}
        <IconChevron data-slot="chevron" />
      </button>

      {/* 下拉菜单内容 */}
      <Show when={store.isOpen}>
        <div data-slot="dropdown" data-align={props.align ?? "left"}>
          {props.children}
        </div>
      </Show>
    </div>
  )
}

/**
 * DropdownItem 组件属性
 */
interface DropdownItemProps {
  // 菜单项内容
  children: JSX.Element
  // 是否选中
  selected?: boolean
  // 点击事件处理器
  onClick?: () => void
  // 按钮类型
  type?: "button" | "submit" | "reset"
}

/**
 * 下拉菜单项组件
 *
 * 下拉菜单中的单个选项。
 *
 * @param props - 组件属性
 * @returns 按钮元素
 *
 * @example
 * ```tsx
 * <DropdownItem onClick={handleClick} selected>
 *   选项内容
 * </DropdownItem>
 * ```
 */
export function DropdownItem(props: DropdownItemProps) {
  return (
    <button
      data-slot="item"
      // 选中状态
      data-selected={props.selected ?? false}
      // 按钮类型（默认为 button）
      type={props.type ?? "button"}
      // 点击事件
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}
