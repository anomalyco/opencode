import { createSignal, onCleanup } from "solid-js"

export interface ScrollToElementOptions {
  block?: "center" | "nearest" | "start" | "end"
  behavior?: ScrollBehavior
}

export interface UseScrollContainerOptions {
  /**
   * Callback when scroll position changes
   */
  onScroll?: (event: Event) => void
}

export interface UseScrollContainerReturn {
  /**
   * Ref to attach to the scrollable container
   */
  setScrollRef: (el: HTMLElement | undefined) => void
  
  /**
   * Get the current scroll container element
   */
  scrollRef: () => HTMLElement | undefined
  
  /**
   * Scroll to a specific element within the container
   */
  scrollToElement: (element: HTMLElement, options?: ScrollToElementOptions) => void
  
  /**
   * Scroll to the top of the container
   */
  scrollToTop: (behavior?: ScrollBehavior) => void
  
  /**
   * Scroll to the bottom of the container
   */
  scrollToBottom: (behavior?: ScrollBehavior) => void
  
  /**
   * Find an element by data-key attribute
   */
  findByKey: (key: string) => HTMLElement | undefined
}

/**
 * Hook for managing scroll container behavior
 * 
 * Provides common scroll operations like scrolling to elements,
 * scrolling to top/bottom, and finding elements by key.
 * 
 * @example
 * ```tsx
 * const { setScrollRef, scrollToElement, scrollToTop } = useScrollContainer({
 *   onScroll: (e) => console.log('scrolled', e)
 * })
 * 
 * <div ref={setScrollRef} style={{ "overflow-y": "auto" }}>
 *   {children}
 * </div>
 * ```
 */
export function useScrollContainer(options?: UseScrollContainerOptions): UseScrollContainerReturn {
  const [scrollRef, setScrollRef] = createSignal<HTMLElement>()
  
  const scrollToElement = (element: HTMLElement, opts?: ScrollToElementOptions) => {
    const container = scrollRef()
    if (!container) return
    
    const block = opts?.block ?? "center"
    const behavior = opts?.behavior ?? "smooth"
    
    if (block === "center") {
      // Custom center scrolling for better control
      const containerRect = container.getBoundingClientRect()
      const elementRect = element.getBoundingClientRect()
      const top = elementRect.top - containerRect.top + container.scrollTop
      const targetScrollTop = top - container.clientHeight / 2 + elementRect.height / 2
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
      
      container.scrollTo({
        top: Math.max(0, Math.min(targetScrollTop, maxScrollTop)),
        behavior,
      })
    } else {
      // Use native scrollIntoView for other cases
      element.scrollIntoView({ block, behavior })
    }
  }
  
  const scrollToTop = (behavior: ScrollBehavior = "smooth") => {
    const container = scrollRef()
    if (!container) return
    container.scrollTo({ top: 0, behavior })
  }
  
  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const container = scrollRef()
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior })
  }
  
  const findByKey = (key: string): HTMLElement | undefined => {
    const container = scrollRef()
    if (!container) return undefined
    
    const nodes = container.querySelectorAll<HTMLElement>('[data-key]')
    for (const node of nodes) {
      if (node.getAttribute("data-key") === key) return node
    }
    return undefined
  }
  
  // Attach scroll listener if provided
  if (options?.onScroll) {
    const handleScroll = (e: Event) => options.onScroll?.(e)
    
    const container = scrollRef()
    if (container) {
      container.addEventListener("scroll", handleScroll, { passive: true })
      onCleanup(() => container.removeEventListener("scroll", handleScroll))
    }
  }
  
  return {
    setScrollRef,
    scrollRef,
    scrollToElement,
    scrollToTop,
    scrollToBottom,
    findByKey,
  }
}
