export interface SpringOptions {
  omega?: number
  zeta?: number
}

export interface DurationOptions {
  duration: number
  bounce: number
}

const matrix = new Float64Array(7)

function coefficients(w: number, z: number, t: number) {
  matrix[0] = w
  matrix[1] = z
  matrix[2] = t
  const zw = z * w
  const e = Math.exp(-zw * t)
  const near = Math.abs(z - 1) < 1e-7
  const wd = near ? 0 : w * Math.sqrt(Math.abs(1 - z * z))
  const wdt = wd * t
  const c = near ? 1 : z < 1 ? Math.cos(wdt) : Math.cosh(wdt)
  const s = near ? t : (z < 1 ? Math.sin(wdt) : Math.sinh(wdt)) / wd
  matrix[3] = e * (c + zw * s)
  matrix[4] = e * s
  matrix[5] = -e * w * w * s
  matrix[6] = e * (c - zw * s)
}

/** Unit-mass spring. Exact analytic damped-harmonic step. */
export class Spring {
  value = 0
  target = 0
  velocity = 0
  omega = 26
  zeta = 0.86

  constructor(value: number, { omega = 26, zeta = 0.86 }: SpringOptions = {}) {
    if (
      !Number.isFinite(value) ||
      !Number.isFinite(omega) ||
      omega <= 0 ||
      omega > 240 ||
      !Number.isFinite(zeta) ||
      zeta < 0 ||
      zeta > 2 ||
      omega / 480 >= 2 * (Math.sqrt(1 + zeta * zeta) - zeta)
    ) {
      throw new RangeError(
        "Spring requires a finite value, omega in (0, 240], zeta in [0, 2], and stable 480 Hz coefficients",
      )
    }

    this.value = this.target = value
    this.omega = omega
    this.zeta = zeta
  }

  /** SwiftUI's nonnegative bounce mapping: omega = 2π / duration; zeta = 1 − bounce. */
  static fromDuration(value: number, { duration, bounce }: DurationOptions): Spring {
    if (
      !Number.isFinite(duration) ||
      duration < (2 * Math.PI) / 240 ||
      !Number.isFinite(bounce) ||
      bounce < 0 ||
      bounce >= 1
    ) {
      throw new RangeError("duration must be >= 2π/240 seconds; bounce must be in [0, 1)")
    }

    return new Spring(value, { omega: (2 * Math.PI) / duration, zeta: 1 - bounce })
  }

  set(target: number, options?: { velocity?: number }): this {
    if (!Number.isFinite(target) || (options?.velocity !== undefined && !Number.isFinite(options.velocity)))
      throw new RangeError("Non-finite spring target or velocity")
    this.target = target

    if (options?.velocity !== undefined) this.velocity = options.velocity

    return this
  }

  snap(value: number): this {
    if (!Number.isFinite(value)) throw new RangeError("Non-finite spring value")
    this.value = this.target = value
    this.velocity = 0

    return this
  }

  step(dt: number): number {
    const target = this.target
    const x0 = this.value - target
    const v0 = this.velocity

    if (x0 === 0 && v0 === 0) return target
    const t = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0

    if (t === 0) return this.value
    const w = this.omega
    const z = this.zeta

    if (w !== matrix[0] || z !== matrix[1] || t !== matrix[2]) coefficients(w, z, t)
    const d = matrix[3]! * x0 + matrix[4]! * v0
    const velocity = matrix[5]! * x0 + matrix[6]! * v0

    if (Math.abs(d) < 0.005 && Math.abs(velocity) < 0.02) {
      this.value = target
      this.velocity = 0

      return target
    }

    const value = target + d
    this.value = value
    this.velocity = velocity

    return value
  }

  get resting(): boolean {
    return Math.abs(this.value - this.target) < 0.005 && Math.abs(this.velocity) < 0.02
  }
}
