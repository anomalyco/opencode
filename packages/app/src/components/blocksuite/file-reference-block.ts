import { BlockComponent, BlockViewExtension, FlavourExtension } from "@blocksuite/block-std"
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

    .card:hover {
      background: var(--surface-raised-base-hover);
    }

    .icon {
      align-items: center;
      background: var(--surface-base);
      border-radius: 6px;
      color: var(--text-weak);
      display: flex;
      flex: 0 0 auto;
      font-size: 12px;
      height: 28px;
      justify-content: center;
      width: 28px;
    }

    .body {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .name {
      color: var(--text-strong);
      font-size: 13px;
      font-weight: 500;
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
  `

  override renderBlock() {
    return html`
      <a class="card" href=${this.model.url} title=${this.model.path}>
        <span class="icon">file</span>
        <span class="body">
          <span class="name">${this.model.name || this.model.path}</span>
          <span class="path">${this.model.path}</span>
        </span>
      </a>
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
