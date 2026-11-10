import { detectPlatform, isMobile } from "~/lib/platform"

/**
 * Touch phones get the arcade as the painted still only: no three.js, no cabinet plate, and a
 * screen that tells the visitor to play on a desktop. Tablets keep the full experience. Client only
 * (the device preview's frames report their platform, so they count too).
 */
export function isPhone() {
  const touch = isMobile(detectPlatform()) || matchMedia("(hover: none) and (pointer: coarse)").matches
  return touch && Math.min(innerWidth, innerHeight) < 600
}
