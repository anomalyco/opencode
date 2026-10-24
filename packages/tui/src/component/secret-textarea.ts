import { TextareaRenderable, type OptimizedBuffer, type RenderContext, type TextareaOptions } from "@opentui/core"
import { extend } from "@opentui/solid"

const ASTERISK = "*".codePointAt(0)!
const SPACE = " ".codePointAt(0)!
const CONTINUATION = 0xc0000000 | 0

type SecretTextareaOptions = TextareaOptions & {
  secret?: boolean
}

/**
 * Textarea that masks its drawn content with `*` while the real text stays in the
 * edit buffer, so cursor movement, backspace, selection and undo keep operating on
 * the actual secret and `plainText` still resolves it for the caller.
 */
class SecretTextareaRenderable extends TextareaRenderable {
  private _secret = false

  constructor(ctx: RenderContext, options: SecretTextareaOptions) {
    super(ctx, options)
    this.secret = options.secret
  }

  set secret(value: boolean | undefined) {
    const enabled = value === true
    if (enabled === this._secret) return
    this._secret = enabled
    this.requestRender()
  }

  override getSelectedText(): string {
    // Copy-on-select and Ctrl+C resolve the selection through this method, so a
    // masked field must never hand out its value there.
    if (this._secret) return ""
    return super.getSelectedText()
  }

  protected override renderSelf(buffer: OptimizedBuffer) {
    super.renderSelf(buffer)
    if (!this._secret) return
    // An empty field only draws its placeholder, which is a hint rather than a secret.
    if (this.plainText === "") return
    const cells = buffer.buffers.char
    const stride = buffer.width
    const originX = Math.floor(this.screenX)
    const originY = Math.floor(this.screenY)
    const width = Math.floor(this.width)
    const height = Math.floor(this.height)
    for (let row = 0; row < height; row++) {
      const line = (originY + row) * stride + originX
      let last = -1
      for (let column = 0; column < width; column++) {
        // Wide glyphs flag their continuation cells, so they always count as drawn content.
        const cell = cells[line + column]
        if (cell !== SPACE && cell !== 0) last = column
      }
      // Masking the span up to the final glyph hides spaces inside the secret too,
      // while the trailing padding keeps the field background.
      for (let column = 0; column <= last; column++) {
        const index = line + column
        // Blank the continuation cell behind a masked wide glyph so its width, and
        // with it the cursor column, is preserved.
        cells[index] = (cells[index] & CONTINUATION) === CONTINUATION ? SPACE : ASTERISK
      }
    }
  }
}

extend({ secret_textarea: SecretTextareaRenderable })

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    secret_textarea: typeof SecretTextareaRenderable
  }
}
