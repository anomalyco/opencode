import { Meta, MetaContext, MetaProvider } from "@solidjs/meta"
import { type JSX, Show } from "solid-js"
import { escape, isServer, ssr, useAssets } from "solid-js/web"

// MetaProvider, with the server's <head> tags grouped under label comments so View Source reads in
// sections. @solidjs/meta renders every tag as one string in call order and has no way to add a
// comment, so on the server this replaces its provider through the exported MetaContext. The
// browser keeps the stock provider: it finds the server's tags by their data-sm id, so their order
// and the comments between them do not matter to it. addTag and the tag markup match
// @solidjs/meta 0.29's server provider. Labels must not contain "--".

type Tag = {
  tag: string
  id: string
  props: Record<string, unknown>
  setting?: { close?: boolean; escape?: boolean }
}

const groups: [string, (tag: Tag) => boolean][] = [
  ["Page", (tag) => tag.tag === "title" || (tag.tag === "meta" && !social(tag) && !icon(tag)) || page(tag)],
  ["Sharing · Open Graph and X", social],
  ["Icons", icon],
  ["Fonts, loaded early so nothing jumps", (tag) => preload(tag, "font")],
  ["Hero images, loaded first", (tag) => preload(tag, "image")],
  ["More", () => true],
]

// The server's escape takes a second "attribute" flag (escape quotes, not <) that its types leave out.
const escapeHtml = escape as (value: unknown, attribute?: boolean) => string

/**
 * A meta tag whose content changes. @solidjs/meta keys a meta tag by its attributes and, when one
 * changes in place, files the tag under the wrong key, so a later change can remove it from the
 * <head>. This mounts a fresh tag for each value instead. The server renders one tag and reads the
 * content only when it writes the <head>, after the page has rendered.
 */
export function LiveMeta(props: { name: string; media?: string; content: string }) {
  // A function call, not a ternary in the prop: the compiler keeps it a lazy getter.
  const contentOf = (value: string | true) => (isServer ? props.content : String(value))
  return (
    <Show when={isServer || props.content} keyed>
      {(value) => (
        <Meta name={props.name} content={contentOf(value)} {...(props.media ? { media: props.media } : {})} />
      )}
    </Show>
  )
}

export function HeadMetaProvider(props: { children: JSX.Element }) {
  if (!isServer) return <MetaProvider>{props.children}</MetaProvider>
  return <ServerMetaProvider>{props.children}</ServerMetaProvider>
}

// A component of its own, so the server tree has the same depth as the browser's MetaProvider and
// hydration keys line up.
function ServerMetaProvider(props: { children: JSX.Element }) {
  const tags: Tag[] = []
  useAssets(() => ssr(render(tags)) as unknown as JSX.Element)
  return (
    <MetaContext.Provider
      value={{
        addTag(tag: Tag) {
          if (tag.tag === "title" || tag.tag === "meta") {
            const key = tagKey(tag)
            const index = tags.findIndex((prev) => prev.tag === tag.tag && tagKey(prev) === key)
            if (index !== -1) tags.splice(index, 1)
          }
          tags.push(tag)
          return tags.length
        },
        removeTag() {},
      }}
    >
      {props.children}
    </MetaContext.Provider>
  )
}

function render(tags: Tag[]) {
  const placed = new Set<Tag>()
  return groups
    .map((group) => {
      const members = tags.filter((tag) => !placed.has(tag) && group[1](tag))
      members.forEach((tag) => placed.add(tag))
      return members.length ? `\n<!-- ${group[0]} -->\n${members.map(markup).join("\n")}` : ""
    })
    .join("\n")
}

function markup(tag: Tag) {
  const attributes = Object.keys(tag.props)
    .map((key) => (key === "children" ? "" : ` ${key}="${escapeHtml(tag.props[key], true)}"`))
    .join("")
  if (!tag.setting?.close) return `<${tag.tag} data-sm="${tag.id}"${attributes}/>`
  const children = Array.isArray(tag.props.children) ? tag.props.children.join("") : tag.props.children
  return `<${tag.tag} data-sm="${tag.id}"${attributes}>${tag.setting.escape ? escapeHtml(children) : (children ?? "")}</${tag.tag}>`
}

/** The key @solidjs/meta uses to keep one title, and one meta per name, property, charset or http-equiv. */
function tagKey(tag: Tag) {
  const allowed = tag.tag === "title" ? [] : ["name", "http-equiv", "content", "charset", "media", "property"]
  const picked: Record<string, unknown> = Object.fromEntries(
    Object.entries(tag.props)
      .filter((entry) => allowed.includes(entry[0]))
      .sort(),
  )
  if (Object.hasOwn(picked, "name") || Object.hasOwn(picked, "property")) {
    picked.name = picked.name || picked.property
    delete picked.property
  }
  return tag.tag + JSON.stringify(picked)
}

function social(tag: Tag) {
  return tag.tag === "meta" && /^(og|twitter):/.test(String(tag.props.property ?? tag.props.name ?? ""))
}

function icon(tag: Tag) {
  if (tag.tag === "meta") return tag.props.name === "apple-mobile-web-app-title"
  return tag.tag === "link" && /^(icon|shortcut icon|apple-touch-icon|mask-icon|manifest)$/.test(String(tag.props.rel))
}

function page(tag: Tag) {
  return tag.tag === "link" && /^(canonical|alternate)$/.test(String(tag.props.rel))
}

function preload(tag: Tag, type: string) {
  return tag.tag === "link" && tag.props.rel === "preload" && tag.props.as === type
}
