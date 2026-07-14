import { Children, isValidElement, type ComponentProps, type ReactNode } from "react"
import { Callout } from "fumadocs-ui/components/callout"
import { Card, Cards } from "fumadocs-ui/components/card"
import { Tab as FumadocsTab, Tabs as FumadocsTabs } from "fumadocs-ui/components/tabs"
import defaultMdxComponents from "fumadocs-ui/mdx"
import type { MDXComponents } from "mdx/types"

function Tip(props: { children: ReactNode }) {
  return <Callout type="idea">{props.children}</Callout>
}

function Note(props: { children: ReactNode }) {
  return <Callout>{props.children}</Callout>
}

function Warning(props: { children: ReactNode }) {
  return <Callout type="warn">{props.children}</Callout>
}

function Tab(props: { title?: string; value?: string; children: ReactNode }) {
  return <FumadocsTab value={props.value ?? props.title}>{props.children}</FumadocsTab>
}

function Tabs(props: { children: ReactNode }) {
  const items = Children.toArray(props.children).flatMap((child) => {
    if (!isValidElement<ComponentProps<typeof Tab>>(child)) return []
    const value = child.props.value ?? child.props.title
    return value ? [value] : []
  })
  return <FumadocsTabs items={items}>{props.children}</FumadocsTabs>
}

function CardGroup(props: { children: ReactNode; cols?: number }) {
  return <Cards>{props.children}</Cards>
}

export function getMdxComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Tip,
    Note,
    Warning,
    Tabs,
    Tab,
    CardGroup,
    Card,
    ...components,
  } satisfies MDXComponents
}

export const useMDXComponents = getMdxComponents

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMdxComponents>
}
