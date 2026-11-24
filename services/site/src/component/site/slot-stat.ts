/**
 * Spins one digit of a slot stat (SlotStat in routes/index.tsx) at `start` (a performance.now()
 * time): a reel of random digits that begins and ends on the digit itself, so starting never jumps
 * or shows a zero, easing out in 1.1s, left to right and stat by stat (`place`, `stat`). The random
 * digits are drawn only now, so the server's markup (the digit alone) never differs. No framework
 * code, so the static pages' script spins the server's reels too. Returns its stop.
 */
export function spinReel(strip: HTMLElement, digit: number, place: number, stat: number, start: number) {
  const reel = strip.parentElement!
  // More turns for later digits, so the right of the number spins faster and lands last.
  const turns = 14 + place * 5 + stat * 3
  const digits = [digit, ...Array.from({ length: turns }, () => Math.floor(Math.random() * 10)), digit]
  // The reel's cells stay once added; only a spinning reel shows more than the first (index.css).
  // Removing them as each digit landed, a frame apart, restyled the whole page in each of those
  // frames (every :has() rule re-checks a removal), right while it scrolled.
  strip.replaceChildren(
    ...digits.map((value) => {
      const cell = document.createElement("span")
      cell.textContent = String(value)
      return cell
    }),
  )
  reel.toggleAttribute("data-spinning", true)
  const line = reel.getBoundingClientRect().height
  const animation = strip.animate(
    [{ transform: "translateY(0)" }, { transform: `translateY(${-(digits.length - 1) * line}px)` }],
    {
      duration: 1100,
      delay: Math.max(0, start - performance.now()) + stat * 120 + place * 70,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      fill: "both",
    },
  )
  animation.onfinish = () => {
    reel.removeAttribute("data-spinning")
    animation.cancel()
  }
  return () => animation.cancel()
}
