/**
 * Taken from https://www.solid-ui.com/docs/components/drawer
 * Only used in one place hence not a v2 component yet... can be promoted to ui/v2 later
 */

import type { Component, ComponentProps, JSX, ValidComponent } from "solid-js"
import { splitProps } from "solid-js"
import type { ContentProps, DescriptionProps, DynamicProps, LabelProps, OverlayProps } from "@corvu/drawer"
import DrawerPrimitive from "@corvu/drawer"
import { cn } from "@/lib/utils"

const Drawer = DrawerPrimitive

const DrawerTrigger = DrawerPrimitive.Trigger

const DrawerPortal = DrawerPrimitive.Portal

const DrawerClose = DrawerPrimitive.Close

type DrawerOverlayProps<T extends ValidComponent = "div"> = OverlayProps<T> & { class?: string }

const DrawerOverlay = <T extends ValidComponent = "div">(props: DynamicProps<T, DrawerOverlayProps<T>>) => {
  const [, rest] = splitProps(props as DrawerOverlayProps, ["class"])
  const drawerContext = DrawerPrimitive.useContext()
  const overlayStyle = () => {
    const state = drawerContext.transitionState()
    if (state === "opening" || state === "closing") return undefined
    const open = drawerContext.openPercentage()
    return {
      opacity: open,
      "backdrop-filter": `blur(${4 * open}px)`,
    }
  }
  return (
    <DrawerPrimitive.Overlay
      class={cn(
        "fixed inset-0 z-[100] bg-v2-overlay-simple-overlay-scrim opacity-0 backdrop-blur-none transition-[opacity,backdrop-filter] duration-300 data-[opening]:opacity-100 data-[opening]:backdrop-blur-[4px] data-[closing]:opacity-0 data-[closing]:backdrop-blur-none",
        props.class,
      )}
      style={overlayStyle()}
      {...rest}
    />
  )
}

type DrawerContentProps<T extends ValidComponent = "div"> = ContentProps<T> & {
  class?: string
  children?: JSX.Element
}

const DrawerContent = <T extends ValidComponent = "div">(props: DynamicProps<T, DrawerContentProps<T>>) => {
  const [, rest] = splitProps(props as DrawerContentProps, ["class", "children"])
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        class={cn(
          "group/drawer-content fixed z-[100] flex flex-col items-start p-0 data-[transitioning]:transition-transform data-[transitioning]:duration-300 md:select-none",
          "data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:mt-24 data-[side=bottom]:h-auto data-[side=bottom]:rounded-t-[10px] data-[side=bottom]:border-t data-[side=bottom]:border-v2-border-border-muted data-[side=bottom]:bg-v2-background-bg-base data-[side=bottom]:shadow-[var(--v2-elevation-overlay)] data-[side=bottom]:after:absolute data-[side=bottom]:after:inset-x-0 data-[side=bottom]:after:top-full data-[side=bottom]:after:h-1/2 data-[side=bottom]:after:bg-inherit",
          "data-[side=right]:top-[6px] data-[side=right]:right-[6px] data-[side=right]:bottom-[6px] data-[side=right]:left-auto data-[side=right]:h-auto data-[side=right]:max-h-[calc(100vh-12px)] data-[side=right]:w-[560px] data-[side=right]:max-w-[calc(100vw-12px)] data-[side=right]:rounded-[8px] data-[side=right]:bg-[#FFFFFF] data-[side=right]:shadow-[var(--v2-elevation-overlay)]",
          props.class,
        )}
        {...rest}
      >
        {props.children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  )
}

const DrawerHeader: Component<ComponentProps<"div">> = (props) => {
  const [, rest] = splitProps(props, ["class"])
  return <div class={cn("grid gap-1.5 p-4 text-center sm:text-left", props.class)} {...rest} />
}

const DrawerFooter: Component<ComponentProps<"div">> = (props) => {
  const [, rest] = splitProps(props, ["class"])
  return <div class={cn("mt-auto flex flex-col gap-2 p-4", props.class)} {...rest} />
}

type DrawerTitleProps<T extends ValidComponent = "div"> = LabelProps<T> & { class?: string }

const DrawerTitle = <T extends ValidComponent = "div">(props: DynamicProps<T, DrawerTitleProps<T>>) => {
  const [, rest] = splitProps(props as DrawerTitleProps, ["class"])
  return (
    <DrawerPrimitive.Label
      class={cn("text-base font-[530] leading-none tracking-[-0.04px] text-v2-text-text-base", props.class)}
      {...rest}
    />
  )
}

type DrawerDescriptionProps<T extends ValidComponent = "div"> = DescriptionProps<T> & {
  class?: string
}

const DrawerDescription = <T extends ValidComponent = "div">(
  props: DynamicProps<T, DrawerDescriptionProps<T>>,
) => {
  const [, rest] = splitProps(props as DrawerDescriptionProps, ["class"])
  return (
    <DrawerPrimitive.Description
      class={cn("text-[13px] font-[440] leading-[140%] tracking-[-0.04px] text-v2-text-text-muted", props.class)}
      {...rest}
    />
  )
}

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
