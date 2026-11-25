import type { ContextMenuParams, MenuItemConstructorOptions } from "electron"
import { externalAction } from "./address"
import { destinationOrigin, type Policy } from "./policy"
import { previewFile } from "./preview"

/** `local`: the server runs on this machine, so its loopback addresses are this machine's too. */
export type MenuPolicy = Policy & { previewHost?: string; local: boolean; resource?: (url: string) => boolean }

/**
 * Raw native file: links never acquire a preview grant. Only a document of this binding can offer its own files, as
 * their display address: `file:` for this machine's workspace, `workspace:` for a remote server's.
 */
export function menuAddress(raw: string, frame: string, policy: MenuPolicy) {
  if (destinationOrigin(raw) || policy.resource?.(raw)) return raw

  if (!policy.previewHost || !frame.startsWith(`oc-preview://${policy.previewHost}/`)) return

  return previewFile(raw, policy.previewHost, policy.fileRoots ?? [], policy.remote)
}

type Params = Pick<
  ContextMenuParams,
  | "linkURL"
  | "srcURL"
  | "frameURL"
  | "pageURL"
  | "mediaType"
  | "hasImageContents"
  | "editFlags"
  | "isEditable"
  | "selectionText"
  | "misspelledWord"
  | "dictionarySuggestions"
>

export type MenuAction =
  | {
      type:
        | "back"
        | "forward"
        | "reload"
        | "hardReload"
        | "openPage"
        | "copyImage"
        | "cut"
        | "copy"
        | "paste"
        | "pastePlain"
        | "selectAll"
        | "spellcheck"
    }
  | { type: "open" | "external" | "address" | "saveImage"; raw: string }
  | { type: "replace" | "language" | "dictionary"; value: string }

export function pageMenu(
  params: Params,
  options: {
    policy: MenuPolicy
    openPage: boolean
    back: boolean
    forward: boolean
    spellcheck: boolean
    languages: readonly string[]
    dictionaries: readonly string[]
    t: (key: string) => string
    run: (action: MenuAction) => void
    extensions: readonly MenuItemConstructorOptions[]
  },
): MenuItemConstructorOptions[] {
  const item = (key: string, action: MenuAction, enabled = true): MenuItemConstructorOptions => ({
    label: options.t(`menu.${key}`),
    enabled,
    click: () => options.run(action),
  })

  const frame = params.frameURL || params.pageURL
  const link = menuAddress(params.linkURL, frame, options.policy)
  const image = params.mediaType === "image" && menuAddress(params.srcURL, frame, options.policy)
  const flags = params.editFlags

  const navigation = [
    item("back", { type: "back" }, options.back),
    item("forward", { type: "forward" }, options.forward),
    item("reload", { type: "reload" }),
    item("hardReload", { type: "hardReload" }),
  ]

  const links = link
    ? [
        item("openLink", { type: "open", raw: params.linkURL }),
        ...(externalAction(link, options.policy.local) === "browser"
          ? [item("external", { type: "external", raw: params.linkURL })]
          : []),
        item("copyLink", { type: "address", raw: params.linkURL }),
      ]
    : []

  const images = image
    ? [
        item("openImage", { type: "open", raw: params.srcURL }),
        item("saveImage", { type: "saveImage", raw: params.srcURL }, params.hasImageContents),
        item("copyImage", { type: "copyImage" }, params.hasImageContents),
        item("copyImageAddress", { type: "address", raw: params.srcURL }),
      ]
    : []

  const edit = params.isEditable
    ? [
        item("cut", { type: "cut" }, flags.canCut),
        item("copy", { type: "copy" }, flags.canCopy),
        item("paste", { type: "paste" }, flags.canPaste),
        item("pastePlain", { type: "pastePlain" }, flags.canPaste),
        item("selectAll", { type: "selectAll" }, flags.canSelectAll),
      ]
    : params.selectionText
      ? [item("copy", { type: "copy" }, flags.canCopy)]
      : []

  const spelling =
    params.isEditable && params.misspelledWord && options.spellcheck
      ? [
          ...params.dictionarySuggestions.map((value) => ({
            label: value,
            click: () => options.run({ type: "replace", value }),
          })),
          item("addWord", { type: "dictionary", value: params.misspelledWord }),
        ]
      : []

  const spell: MenuItemConstructorOptions[] = params.isEditable
    ? [
        { ...item("spellcheck", { type: "spellcheck" }), type: "checkbox", checked: options.spellcheck },
        ...(options.dictionaries.length
          ? [
              {
                label: options.t("menu.languages"),
                enabled: options.spellcheck,
                submenu: options.dictionaries.map(
                  (value): MenuItemConstructorOptions => ({
                    label: value,
                    type: "checkbox",
                    checked: options.languages.includes(value),
                    enabled: !(options.languages.length === 1 && options.languages[0] === value),
                    click: () => options.run({ type: "language", value }),
                  }),
                ),
              },
            ]
          : []),
      ]
    : []

  const handoff = [options.openPage ? item("openPage", { type: "openPage" }) : { label: options.t("menu.pageUnavailable"), enabled: false }]

  return [navigation, handoff, links, images, spelling, edit, spell, options.extensions]
    .filter((group) => group.length)
    .flatMap((group, index) => (index ? [{ type: "separator" }, ...group] : group))
}
