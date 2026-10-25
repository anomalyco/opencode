import { MacOSScrollAccel, type ScrollAcceleration } from "@opentui/core"

export type ScrollConfig = {
  scroll?: {
    acceleration?: boolean
    speed?: number
  }
}

export class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private speed: number) {}

  tick(_now?: number): number {
    return this.speed
  }

  reset(): void {}
}

export function getScrollAcceleration(config?: ScrollConfig): ScrollAcceleration {
  if (config?.scroll?.acceleration) {
    return new MacOSScrollAccel()
  }
  if (config?.scroll?.speed !== undefined) {
    return new CustomSpeedScroll(config.scroll.speed)
  }

  return new CustomSpeedScroll(3)
}
