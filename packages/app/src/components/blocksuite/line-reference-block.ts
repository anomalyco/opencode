import { BlockComponent, BlockViewExtension, FlavourExtension } from "@blocksuite/block-std"
import { CodeIcon, DeleteIcon, DragHandleConfigExtension, HoverController } from "@blocksuite/blocks"
import { defineBlockSchema, type BlockSchemaType, type SchemaToModel } from "@blocksuite/store"
import { css, html } from "lit"
import { literal } from "lit/static-html.js"
import { lineRefSegments, lineRefTone } from "./line-reference-url"

export type LineReferenceBlockProps = {
  name: string
  path: string
  url: string
  start: number
  end: number
  side?: string
  endSide?: string
  additionStart?: number
  additionEnd?: number
  deletionStart?: number
  deletionEnd?: number
  label?: string
  preview?: string
  comment?: string
}

export const LineReferenceBlockSchema = defineBlockSchema({
  flavour: "opencode:line-reference",
  props: () => ({
    name: "",
    path: "",
    url: "",
    start: 0,
    end: 0,
    side: "",
    endSide: "",
    additionStart: 0,
    additionEnd: 0,
    deletionStart: 0,
    deletionEnd: 0,
    label: "",
    preview: "",
    comment: "",
  }),
  metadata: {
    version: 1,
    role: "content",
    parent: ["affine:note"],
    children: [],
  },
})

export type LineReferenceBlockModel = SchemaToModel<typeof LineReferenceBlockSchema>

export class LineReferenceBlockComponent extends BlockComponent<LineReferenceBlockModel> {
  static styles = css`
    opencode-line-reference {
      display: block;
      padding: 2px 0;
    }

    .wrap {
      position: relative;
    }

    .card {
      align-items: flex-start;
      background: var(--surface-raised-base);
      border: 1px solid var(--border-base);
      border-radius: 8px;
      color: var(--text-base);
      display: flex;
      gap: 10px;
      min-width: 0;
      padding: 8px 10px;
      text-decoration: none;
    }

    .wrap:hover .card,
    .wrap:focus-within .card {
      background: var(--surface-raised-base-hover);
    }

    .icon {
      align-items: center;
      background: var(--surface-base);
      border-radius: 6px;
      color: var(--text-weak);
      display: flex;
      flex: 0 0 auto;
      height: 28px;
      justify-content: center;
      width: 28px;
    }

    .icon svg {
      height: 18px;
      width: 18px;
    }

    .body {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .name {
      color: var(--text-strong);
      font-size: 13px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .meta {
      align-items: center;
      color: var(--text-weak);
      display: flex;
      font-size: 12px;
      gap: 4px;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .lines {
      flex: 0 0 auto;
      font-family: var(--font-family-mono);
      font-weight: 500;
    }

    .lines[data-tone="additions"] {
      color: var(--icon-diff-add-base);
    }

    .lines[data-tone="deletions"] {
      color: var(--icon-diff-delete-base);
    }

    .card[data-tone="additions"] .icon {
      color: var(--icon-diff-add-base);
    }

    .card[data-tone="deletions"] .icon {
      color: var(--icon-diff-delete-base);
    }

    .card[data-tone="mixed"] .icon {
      color: var(--text-weak);
    }

    .meta-sep {
      flex: 0 0 auto;
    }

    .comment {
      color: var(--text-base);
      font-size: 12px;
      line-height: 1.4;
      margin-top: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    editor-toolbar.line-reference-toolbar {
      display: flex;
    }
  `

  private hover = new HoverController(this, ({ abortController }) => {
    const selection = this.host.selection
    const text = selection.find("text")
    if (text && ("to" in text ? !!text.to : false)) return null
    const blocks = selection.filter("block")
    if (blocks.length > 1 || (blocks.length === 1 && blocks[0].blockId !== this.blockId)) return null
    return {
      template: this.toolbar(abortController),
      computePosition: {
        referenceElement: this,
        placement: "top-start",
        autoUpdate: true,
      },
    }
  })

  private select() {
    this.host.selection.setGroup("note", [
      this.host.selection.create("block", {
        blockId: this.blockId,
      }),
    ])
  }

  private press = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    this.select()
  }

  private keys = (event: KeyboardEvent) => {
    if (this.doc.readonly) return
    if (event.key !== "Backspace" && event.key !== "Delete") return
    const active = document.activeElement
    if (!this.selected && active !== this && !(active instanceof Element && this.contains(active))) return
    event.preventDefault()
    event.stopPropagation()
    this.del()
  }

  private del() {
    if (this.doc.readonly) return
    this.doc.deleteBlock(this.model)
  }

  private toolbar(abort: AbortController) {
    if (this.doc.readonly) return html``
    return html`
      <style>
        .line-reference-toolbar {
          display: flex;
        }

        .line-reference-delete {
          --affine-hover-color: var(--affine-background-error-color);
          width: max-content;
        }

        .line-reference-delete:hover {
          --affine-icon-color: var(--affine-error-color);
          color: var(--affine-error-color);
        }
      </style>
      <editor-toolbar class="line-reference-toolbar">
        <editor-icon-button
          class="line-reference-delete"
          aria-label="Delete line reference"
          .labelHeight=${"20px"}
          .tooltip=${"Delete"}
          @click=${(event: MouseEvent) => {
            event.preventDefault()
            event.stopPropagation()
            abort.abort()
            this.del()
          }}
        >
          ${DeleteIcon}<span class="label">Delete</span>
        </editor-icon-button>
      </editor-toolbar>
    `
  }

  override connectedCallback() {
    super.connectedCallback()
    this.setAttribute("contenteditable", "false")
    this.tabIndex = 0
    this.hover.setReference(this)
    this.addEventListener("click", this.press)
    this.addEventListener("keydown", this.keys)
    document.addEventListener("keydown", this.keys, true)
  }

  override disconnectedCallback() {
    this.removeEventListener("click", this.press)
    this.removeEventListener("keydown", this.keys)
    document.removeEventListener("keydown", this.keys, true)
    super.disconnectedCallback()
  }

  private spans() {
    const pick = (value: number) => (value > 0 ? value : undefined)
    return lineRefSegments({
      start: this.model.start,
      end: this.model.end,
      side: this.model.side,
      endSide: this.model.endSide,
      additionStart: pick(this.model.additionStart),
      additionEnd: pick(this.model.additionEnd),
      deletionStart: pick(this.model.deletionStart),
      deletionEnd: pick(this.model.deletionEnd),
    })
  }

  override renderBlock() {
    const comment = this.model.comment?.trim()
    const path = this.model.path
    const parts = this.spans()
    const tone = lineRefTone(this.model.side, this.model.endSide)
    return html`
      <div class="wrap" contenteditable="false">
        <a
          class="card"
          href=${this.model.url || path}
          title=${path}
          data-tone=${tone ?? ""}
        >
          <span class="icon">${CodeIcon}</span>
          <span class="body">
            <span class="name">${this.model.name || path}</span>
            <span class="meta">
              ${parts.map((part, index) =>
                index === 0
                  ? html`<span class="lines" data-tone=${part.tone ?? ""}>${part.label}</span>`
                  : html`<span class="meta-sep"> </span
                      ><span class="lines" data-tone=${part.tone ?? ""}>${part.label}</span>`,
              )}
              <span class="meta-sep"> · </span><span>${path}</span>
            </span>
            ${comment ? html`<span class="comment">${comment}</span>` : ""}
          </span>
        </a>
      </div>
    `
  }
}

if (!customElements.get("opencode-line-reference")) {
  customElements.define("opencode-line-reference", LineReferenceBlockComponent)
}

const drag = DragHandleConfigExtension({
  flavour: "opencode:line-reference",
})

export const LineReferenceBlockSpec = [
  FlavourExtension("opencode:line-reference"),
  BlockViewExtension("opencode:line-reference", literal`opencode-line-reference`),
  drag,
]

export function withLineReferenceSchema(schemas: BlockSchemaType[]) {
  return [
    ...schemas.map((schema) => {
      if (schema.model.flavour !== "affine:note") return schema
      const children = schema.model.children ?? []
      const next = children.includes("opencode:line-reference")
        ? children
        : [...children, "opencode:line-reference"]
      return {
        ...schema,
        model: {
          ...schema.model,
          children: next,
        },
      }
    }),
    LineReferenceBlockSchema,
  ]
}

declare global {
  namespace BlockSuite {
    interface BlockModels {
      "opencode:line-reference": LineReferenceBlockModel
    }
  }
}
