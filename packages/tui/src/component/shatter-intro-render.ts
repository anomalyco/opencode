import { OptimizedBuffer } from "@opentui/core"

export type Rgb = [number, number, number]

const FULL_BLOCK = "█".codePointAt(0)!
const SPACE = " ".codePointAt(0)!

const HOLD_MS = 400
const SHATTER_MS = 1600
const TOTAL_MS = HOLD_MS + SHATTER_MS
const BASE_SPEED = 0.06
const SHARDS_X = 16

// Triangle type: which corner of the shard rectangle
// 0=top-left, 1=top-right, 2=bottom-left, 3=bottom-right
type Shard = {
  originX: number
  originY: number
  w: number
  h: number
  x: number
  y: number
  vx: number
  vy: number
  tri: number
}

function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

export class ShatterPainter {
  private elapsed = 0
  private shards: Shard[] = []
  private dirty = true
  private screenWidth = 0
  private screenHeight = 0
  private animationDone = false
  onComplete: (() => void) | undefined

  render(frameBuffer: OptimizedBuffer, deltaTime: number) {
    if (this.animationDone) return

    this.elapsed += deltaTime
    const width = frameBuffer.width
    const height = frameBuffer.height

    if (this.dirty || width !== this.screenWidth || height !== this.screenHeight) {
      this.screenWidth = width
      this.screenHeight = height
      this.initShards(width, height)
      this.dirty = false
      this.elapsed = 0
      this.animationDone = false
    }

    const buffers = frameBuffer.buffers
    buffers.char.fill(SPACE)
    buffers.attributes.fill(0)
    buffers.fg.fill(0)
    buffers.bg.fill(0)

    if (this.elapsed < HOLD_MS) {
      this.renderHold(frameBuffer)
    } else if (this.elapsed < TOTAL_MS) {
      this.renderShatter(frameBuffer)
    } else {
      this.animationDone = true
      this.onComplete?.()
    }
  }

  private initShards(width: number, height: number) {
    this.shards = []
    const rand = seededRandom(42)
    const shardW = Math.max(1, Math.ceil(width / SHARDS_X))
    const shardsY = Math.max(1, Math.ceil(height / shardW))
    const shardH = Math.max(1, Math.ceil(height / shardsY))

    const cx = width / 2
    const cy = height / 2

    for (let row = 0; row < shardsY; row++) {
      for (let col = 0; col < SHARDS_X; col++) {
        const originX = col * shardW
        const originY = row * shardH
        const shardCx = originX + shardW / 2
        const shardCy = originY + shardH / 2

        let dx = shardCx - cx
        let dy = shardCy - cy
        const dist = Math.hypot(dx, dy) || 1
        dx /= dist
        dy /= dist

        const angle = Math.atan2(dy, dx) + (rand() - 0.5) * 0.5
        const speed = BASE_SPEED * (1 + dist / 15) * (0.6 + rand() * 0.5)

        this.shards.push({
          originX,
          originY,
          w: shardW,
          h: shardH,
          x: originX,
          y: originY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          tri: Math.floor(rand() * 4),
        })
      }
    }
  }

  private renderHold(fb: OptimizedBuffer) {
    const { buffers, width } = fb
    for (let y = 0; y < this.screenHeight; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x
        buffers.char[index] = FULL_BLOCK
        const offset = index * 4
        buffers.fg[offset] = 0
        buffers.fg[offset + 1] = 0
        buffers.fg[offset + 2] = 0
        buffers.fg[offset + 3] = 255
        buffers.bg[offset] = 0
        buffers.bg[offset + 1] = 0
        buffers.bg[offset + 2] = 0
        buffers.bg[offset + 3] = 255
      }
    }
  }

  private triangleMask(dc: number, dr: number, shard: Shard): boolean {
    switch (shard.tri) {
      case 0: return dc * shard.h < dr * shard.w
      case 1: return (shard.w - 1 - dc) * shard.h < dr * shard.w
      case 2: return dc * shard.h > (shard.h - 1 - dr) * shard.w
      case 3: return (shard.w - 1 - dc) * shard.h > (shard.h - 1 - dr) * shard.w
      default: return true
    }
  }

  private renderShatter(fb: OptimizedBuffer) {
    const { buffers, width } = fb
    const t = this.elapsed - HOLD_MS
    const progress = Math.min(1, t / SHATTER_MS)
    const eased = 1 - (1 - progress) ** 3

    const alpha = Math.max(0, 1 - eased * 1.05)

    for (const shard of this.shards) {
      shard.x = shard.originX + shard.vx * t
      shard.y = shard.originY + shard.vy * t

      const px = Math.round(shard.x)
      const py = Math.round(shard.y)

      for (let dr = 0; dr < shard.h; dr++) {
        for (let dc = 0; dc < shard.w; dc++) {
          if (!this.triangleMask(dc, dr, shard)) continue
          const rx = px + dc
          const ry = py + dr
          if (rx < 0 || ry < 0 || rx >= this.screenWidth || ry >= this.screenHeight) continue
          const index = ry * width + rx
          buffers.char[index] = FULL_BLOCK
          const offset = index * 4
          const a = Math.round(alpha * 255)
          buffers.fg[offset] = 0
          buffers.fg[offset + 1] = 0
          buffers.fg[offset + 2] = 0
          buffers.fg[offset + 3] = a
          buffers.bg[offset] = 0
          buffers.bg[offset + 1] = 0
          buffers.bg[offset + 2] = 0
          buffers.bg[offset + 3] = a
        }
      }
    }
  }

  reset() {
    this.elapsed = 0
    this.animationDone = false
    this.dirty = true
  }
}
