// Renderable constructors produce the same virtual nodes as JSX. The host owns layout and painting.
import { setProp, VNode } from "./render"

type Options = Record<string, unknown> | undefined

class Built extends VNode {
  constructor(tag: string, options: Options) {
    super(tag)
    for (const [name, value] of Object.entries(options ?? {})) setProp(this, name, value)
  }

  // The host frees what it built for the node once no tree holds it.
  destroy() {}

  destroyRecursively() {}
}

export class BoxRenderable extends Built {
  constructor(_renderer: unknown, options?: Options) {
    super("box", options)
  }
}

export class TextRenderable extends Built {
  constructor(_renderer: unknown, options?: Options) {
    super("text", options)
  }
}

export class MarkdownRenderable extends Built {
  constructor(_renderer: unknown, options?: Options) {
    super("markdown", options)
  }
}

export class CodeRenderable extends Built {
  constructor(_renderer: unknown, options?: Options) {
    super("code", options)
  }
}

export class ScrollBoxRenderable extends Built {
  constructor(_renderer: unknown, options?: Options) {
    super("scrollbox", options)
  }
}

export class InputRenderable extends Built {
  constructor(_renderer: unknown, options?: Options) {
    super("input", options)
  }
}

// What a code block's `defaultRender()` returns: the host's own code view of the fence (`Node::Fence`), whose `bg` the
// renderer may set.
export class FenceRenderable extends VNode {
  constructor() {
    super("fence")
  }
}
