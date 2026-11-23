import { For, Match, Show, Switch, type JSX } from "solid-js"

// Release items are single-line markdown; only inline code, links and bold appear in practice.
function inline(text: string) {
  const matches = [...text.matchAll(/`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g)]
  const end = matches.reduce(
    (acc, match) => ({
      index: match.index + match[0].length,
      parts: [
        ...acc.parts,
        { type: "text" as const, value: text.slice(acc.index, match.index) },
        match[1] !== undefined
          ? { type: "code" as const, value: match[1] }
          : match[4] !== undefined
            ? { type: "strong" as const, value: match[4] }
            : { type: "link" as const, value: match[2], href: match[3] },
      ],
    }),
    { index: 0, parts: [] as { type: "text" | "code" | "link" | "strong"; value: string; href?: string }[] },
  )
  return [...end.parts, { type: "text" as const, value: text.slice(end.index) }].filter((part) => part.value)
}

export function Inline(props: { text: string }) {
  return (
    <For each={inline(props.text)}>
      {(part) => (
        <Switch fallback={part.value}>
          <Match when={part.type === "code"}>
            <code>{part.value}</code>
          </Match>
          <Match when={part.type === "strong"}>
            <strong>{part.value}</strong>
          </Match>
          <Match when={part.type === "link"}>
            <a href={part.href} target="_blank" rel="noopener noreferrer">
              {part.value}
            </a>
          </Match>
        </Switch>
      )}
    </For>
  )
}

/** A release note line, with an optional label (the sections it was listed under) before it and `children` (its links) after it. */
export function ReleaseItem(props: { item: string; label?: string; children?: JSX.Element }) {
  const parts = () => {
    const match = props.item.match(/^(.+?)(\s*\(@([\w-]+)\))?$/)
    if (match) return { text: match[1], username: match[3] }
    return { text: props.item, username: undefined }
  }

  // Notes are in English on every locale; dir="auto" keeps them left to right in an Arabic page.
  return (
    <li lang="en" dir="auto">
      <Show when={props.label}>
        <span data-slot="area">{props.label}</span>
      </Show>
      <span data-slot="text">
        <Inline text={parts().text} />
        <Show when={parts().username}>
          {" "}
          <a
            data-slot="author"
            href={`https://github.com/${parts().username}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            @{parts().username}
          </a>
        </Show>
        {props.children}
      </span>
    </li>
  )
}
