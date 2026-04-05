import { Component, ParentProps, createEffect, onCleanup, useRef } from "solid-js"

export interface FocusTrapProps extends ParentProps {
  active?: boolean
  initialFocus?: string | HTMLElement
  returnFocus?: HTMLElement
}

export function FocusTrap(props: FocusTrapProps) {
  const containerRef = useRef<HTMLElement>(null)
  const lastFocusedElement = useRef<HTMLElement | null>(null)

  const focusableElements = (container: HTMLElement) => {
    return Array.from(
      container.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])' as const
      )
    ).filter((el) => {
      return (
        !el.hasAttribute('disabled') &&
        el.offsetWidth > 0 &&
        el.offsetHeight > 0 &&
        getComputedStyle(el).visibility !== 'hidden'
      )
    })
  }

  const trapFocus = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return
    if (!containerRef.current) return

    const focusables = focusableElements(containerRef.current)
    if (focusables.length === 0) {
      event.preventDefault()
      return
    }

    const firstFocusable = focusables[0]
    const lastFocusable = focusables[focusables.length - 1]

    if (event.shiftKey) {
      if (document.activeElement === firstFocusable) {
        event.preventDefault()
        lastFocusable.focus()
      }
    } else {
      if (document.activeElement === lastFocusable) {
        event.preventDefault()
        firstFocusable.focus()
      }
    }
  }

  createEffect(() => {
    if (!props.active || !containerRef.current) return

    lastFocusedElement.current = document.activeElement as HTMLElement

    if (props.initialFocus) {
      if (typeof props.initialFocus === 'string') {
        const element = containerRef.current.querySelector(props.initialFocus)
        element?.focus()
      } else {
        props.initialFocus.focus()
      }
    } else {
      const focusables = focusableElements(containerRef.current)
      focusables[0]?.focus()
    }

    document.addEventListener('keydown', trapFocus)

    onCleanup(() => {
      document.removeEventListener('keydown', trapFocus)
      if (props.returnFocus) {
        props.returnFocus.focus()
      } else if (lastFocusedElement.current) {
        lastFocusedElement.current.focus()
      }
    })
  })

  return (
    <div ref={containerRef} data-component="focus-trap">
      {props.children}
    </div>
  )
}
