import { createEffect, onCleanup, useRef } from "solid-js"

/**
 * 用于管理 ARIA live regions
 * @param politeness - assertive 或 polite
 * @param message - 要播报的消息
 */
export function useAriaLive(politeness: 'assertive' | 'polite' = 'polite') {
  const regionRef = useRef<HTMLDivElement>(null)

  const announce = (message: string) => {
    if (!regionRef.current) return
    
    regionRef.current.textContent = ''
    // 触发重排
    regionRef.current.offsetHeight
    regionRef.current.textContent = message
  }

  return {
    region: (
      <div
        ref={regionRef}
        aria-live={politeness}
        aria-atomic="true"
        class="sr-only"
      />
    ),
    announce
  }
}

/**
 * 用于处理键盘导航
 * @param callback - 键盘事件回调
 * @param keys - 要监听的按键
 */
export function useKeyboardNavigation(
  callback: (event: KeyboardEvent) => void,
  keys: string[] = ['Enter', 'Space']
) {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (keys.includes(event.key)) {
      callback(event)
    }
  }

  createEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyDown)
    })
  })
}

/**
 * 用于管理焦点可见性
 */
export function useFocusVisible() {
  const ref = useRef<HTMLElement>(null)

  createEffect(() => {
    if (!ref.current) return

    const handleMouseDown = () => {
      document.documentElement.classList.add('focus-visible--mouse')
    }

    const handleKeyDown = () => {
      document.documentElement.classList.remove('focus-visible--mouse')
    }

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)

    onCleanup(() => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    })
  })

  return ref
}

/**
 * 用于生成唯一的 ARIA ID
 */
export function generateAriaId(prefix: string = 'a11y') {
  return `${prefix}-${Math.random().toString(36).substring(2, 11)}`
}
