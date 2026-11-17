// The OpenTUI renderables a plugin builds with `new` (contract 2.x, step D): each is the node its JSX intrinsic makes,
// with its options as its props, `add`, `insertBefore`, `remove` and the option setters of a node (`render.ts`). A
// code block's renderer returns one (good-fences: a box of a label and the default render), and a render may return one
// or add one by a ref (CT-15), which draws as the JSX would. What OpenTUI does with the renderer it is given (its
// layout, its own drawing) is the host's.
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
