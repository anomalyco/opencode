import { BlockComponent, BlockViewExtension, FlavourExtension } from "@blocksuite/block-std"
import { DeleteIcon, getAttachmentFileIcons, HoverController } from "@blocksuite/blocks"
import { defineBlockSchema, type BlockSchemaType, type SchemaToModel } from "@blocksuite/store"
import { css, html } from "lit"
import { literal } from "lit/static-html.js"

export type FileReferenceBlockProps = {
  name: string
  path: string
  url: string
}

export const FileReferenceBlockSchema = defineBlockSchema({
  flavour: "opencode:file-reference",
  props: () => ({
    name: "",
    path: "",
    url: "",
  }),
  metadata: {
    version: 1,
    role: "content",
    parent: ["affine:note"],
    children: [],
  },
})

export type FileReferenceBlockModel = SchemaToModel<typeof FileReferenceBlockSchema>

export class FileReferenceBlockComponent extends BlockComponent<FileReferenceBlockModel> {
  static styles = css`
    opencode-file-reference {
      display: block;
      padding: 2px 0;
    }

    .wrap {
      position: relative;
    }

    .card {
      align-items: center;
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

    .path {
      color: var(--text-weak);
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    editor-toolbar.file-reference-toolbar {
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

  private ext() {
    const name = this.model.name || this.model.path
    const idx = name.lastIndexOf(".")
    return idx === -1 ? "" : name.slice(idx + 1)
  }

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
        .file-reference-toolbar {
          display: flex;
        }

        .file-reference-delete {
          --affine-hover-color: var(--affine-background-error-color);
          width: max-content;
        }

        .file-reference-delete:hover {
          --affine-icon-color: var(--affine-error-color);
          color: var(--affine-error-color);
        }
      </style>
      <editor-toolbar class="file-reference-toolbar">
        <editor-icon-button
          class="file-reference-delete"
          aria-label="Delete file reference"
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

  override renderBlock() {
    return html`
      <div class="wrap" contenteditable="false">
        <a class="card" href=${this.model.url || this.model.path} title=${this.model.path}>
          <span class="icon">${getAttachmentFileIcons(this.ext())}</span>
          <span class="body">
            <span class="name">${this.model.name || this.model.path}</span>
            <span class="path">${this.model.path}</span>
          </span>
        </a>
      </div>
    `
  }
}

if (!customElements.get("opencode-file-reference")) {
  customElements.define("opencode-file-reference", FileReferenceBlockComponent)
}

export const FileReferenceBlockSpec = [
  FlavourExtension("opencode:file-reference"),
  BlockViewExtension("opencode:file-reference", literal`opencode-file-reference`),
]

export function withFileReferenceSchema(schemas: BlockSchemaType[]) {
  return [
    ...schemas.map((schema) => {
      if (schema.model.flavour !== "affine:note") return schema
      return {
        ...schema,
        model: {
          ...schema.model,
          children: [...(schema.model.children ?? []), "opencode:file-reference"],
        },
      }
    }),
    FileReferenceBlockSchema,
  ]
}

declare global {
  namespace BlockSuite {
    interface BlockModels {
      "opencode:file-reference": FileReferenceBlockModel
    }
  }
}
