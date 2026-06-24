const MULBERRY32_A = 0xcc9e2d51
const MULBERRY32_B = 0x1b873593

export class SeededRandom {
  private state: number

  constructor(seed: number = 0xdeadbeef) {
    this.state = seed | 0
  }

  next(): number {
    let z = (this.state += 0x6d2b79f5) | 0
    z = Math.imul(z ^ (z >>> 15), z | 1)
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61)
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min
  }

  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!
  }

  string(length: number, chars: string): string {
    let out = ""
    for (let i = 0; i < length; i++) out += chars[Math.floor(this.next() * chars.length)]!
    return out
  }
}
