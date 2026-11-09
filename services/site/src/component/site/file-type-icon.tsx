import { chooseIconName } from "@opencode/ui/icons/file-type-name"
import { For, Show } from "solid-js"
import { docsFileIcons } from "./docs-file-icons"

/**
 * The desktop app's icon for a file or folder (the shared mapping in @opencode/ui), from the docs'
 * subset (docs-file-icons.ts), drawn inline so the folders' currentColor takes the label grey.
 * Coloured, with the _light variant in light mode where there is one; inside
 * [data-file-icons="mono"] every fill is currentColor instead (docs-variants.css).
 */
export function FileTypeIcon(props: { path: string; directory?: boolean }) {
  const type = () => (props.directory ? "directory" : "file")
  const name = () => chooseIconName(props.path, type(), false)
  const svg = () => docsFileIcons[name()] ?? docsFileIcons[chooseIconName("", type(), false)] ?? ""
  const light = () => docsFileIcons[`${name()}_light` as keyof typeof docsFileIcons]
  return (
    <span data-slot="file-icon" data-icon={name()} aria-hidden="true">
      <span data-scheme={light() ? "dark" : undefined} innerHTML={svg()} />
      <Show when={light()}>{(markup) => <span data-scheme="light" innerHTML={markup()} />}</Show>
    </span>
  )
}

/**
 * A file tree from "├── name" lines, each file and folder with its icon; folders end in "/". Each
 * row carries its depth (--depth, one per four prefix characters) and whether it's a folder, so the
 * minimal File tree options can drop the box-drawing prefix and indent or draw guides instead.
 */
export function FileTree(props: { tree: string }) {
  const rows = () =>
    props.tree.split("\n").map((line) => {
      const at = line.search(/[^│├└─\s]/)
      const name = line.slice(at)
      return { prefix: line.slice(0, at), name, directory: name.endsWith("/"), depth: Math.round(at / 4) }
    })
  return (
    <pre data-component="file-tree" aria-label="Files" tabIndex={0}>
      <For each={rows()}>
        {(row, index) => (
          <span data-slot="tree-row" data-directory={row.directory ? "" : undefined} style={{ "--depth": row.depth }}>
            <span data-slot="tree-prefix">{row.prefix}</span>
            <FileTypeIcon path={row.name.replace(/\/$/, "")} directory={row.directory} />
            <span data-slot="tree-name">{row.name}</span>
            {index() < rows().length - 1 ? "\n" : ""}
          </span>
        )}
      </For>
    </pre>
  )
}
