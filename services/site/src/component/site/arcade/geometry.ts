import screenMask from "./screen-mask.json"
/**
 * One shared coordinate space for the arcade 404: "world" units are pixels of the straight-on
 * cabinet plate (front-3072, 3072×5504). Every other layer is registered into it from
 * measurements taken on the generated images, so the camera can move continuously across them.
 */

export type Rect = { x: number; y: number; w: number; h: number }
export type Point = { x: number; y: number }

export const front: Rect = { x: 0, y: 0, w: 3072, h: 5504 }

// The room shot (scene-2752, 2752×1536 px) is registered on the coin slot: its slot plate centre
// (1416, 918 px) sits on the front plate's slit (1530, 3558), and one scene pixel spans 6.58 world
// units (the mean of the slot-plate and door-width ratios, 0.159 and 0.146).
const sceneScale = 6.58
export const scene: Rect = {
  x: 1530 - 1416 * sceneScale,
  y: 3558 - 918 * sceneScale,
  w: 2752 * sceneScale,
  h: 1536 * sceneScale,
}
const fromScene = (x: number, y: number): Point => ({ x: scene.x + x * sceneScale, y: scene.y + y * sceneScale })

// The token lies on the floor where the scene painted one (1628, 1295 px, since removed). 25 mm is
// 1.4% of the 1.8 m cabinet (~4450 world units tall), and fits the 80-unit slit: 72 units.
export const coinHome = fromScene(1628, 1295)
export const coinSize = 72

// The coin door, cut from the front plate: the slot faceplate (overlaid above the coin so the coin
// can slide in behind it) and its slit.
export const faceplate: Rect = { x: 1430, y: 3448, w: 202, h: 214 }
export const slit: Point = { x: 1530, y: 3558 }

// Dropping the coin anywhere on the cabinet (in the scene's perspective) starts the zoom to the door.
export const cabinetZone: Rect = (() => {
  const a = fromScene(1105, 414)
  const b = fromScene(1680, 1234)
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }
})()

// The CRT glass on the front plate: the box round the painted opening traced by
// arcade-layers/work/screen-mask.py (screen-mask.json), with a pixel to spare. The screen is laid out
// in this box and clipped to the traced opening.
export const glass: Rect = { x: 921, y: 1751, w: 1230, h: 840 }

// The hybrid's coin door close-up (slot-neutral-2048: the room shot's 512 × 384 px around the slot,
// upscaled 4×, with the slot plate repainted as a steel plate and slit), its slit and the token's
// size there: about 85% of the slit's length (19 room px).
export const slotCloseup: Rect = {
  x: scene.x + 1160 * sceneScale,
  y: scene.y + 700 * sceneScale,
  w: 512 * sceneScale,
  h: 384 * sceneScale,
}
export const slotSlit = fromScene(1416.3, 921.5)
export const slotCoinSize = 104
// Screen pixels per room-shot pixel.
export const scenePixel = sceneScale

// The same glass as four corners (top-left, top-right, bottom-right, bottom-left): in the room shot,
// where it is painted in perspective (measured on scene-2752), and on the straight-on front plate.
// The hybrid pins its code-drawn screen between the two (homography.ts).
type Quad = [Point, Point, Point, Point]
// The room corners sit on the inside of the bezel's dark lip (re-measured at 15× on poster-2752 and
// scene-neutral-2752, which agree), half a pixel into the lip so no painted glass shows around it.
export const sceneGlass: Quad = [
  fromScene(1254.6, 585.4),
  fromScene(1435.6, 589.6),
  fromScene(1457.4, 741),
  fromScene(1274.8, 741),
]

export const frontGlass: Quad = [
  { x: glass.x, y: glass.y },
  { x: glass.x + glass.w, y: glass.y },
  { x: glass.x + glass.w, y: glass.y + glass.h },
  { x: glass.x, y: glass.y + glass.h },
]

// Camera framings, as world rectangles to fit into the viewport.
export const framing = {
  sceneWide: scene,
  // Portrait phones crop the room to the cabinet and the token beside it (full height, so it covers).
  sceneTall: (() => {
    const a = fromScene(1045, 0)
    const b = fromScene(1755, 1536)
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }
  })(),
  door: { x: 1110, y: 3290, w: 840, h: 900 },
  // Halfway up the front, as close as the screen framing, so the climb is a pan.
  climb: { x: 820, y: 2500, w: 1436, h: 1200 },
  screen: { x: 820, y: 1560, w: 1436, h: 1200 },
  play: { x: 914, y: 1744, w: 1248, h: 853 },
} satisfies Record<string, Rect>

/**
 * The painted glass openings (screen-mask.json): traced from the paintings with sub-pixel accuracy
 * by arcade-layers/work/screen-mask.py, 1.5 px under the bezel lip. `plate` is in front-plate (world)
 * units, `room` in room-shot pixels.
 */
export const plateMask = screenMask.plate.points as [number, number][]
export const roomMask = (screenMask.room.points as [number, number][]).map(([x, y]) => fromScene(x, y))

/** The plate's opening as a CSS polygon, relative to the glass box. */
export const glassClip = `polygon(${plateMask
  .map(([x, y]) => `${(((x - glass.x) / glass.w) * 100).toFixed(3)}% ${(((y - glass.y) / glass.h) * 100).toFixed(3)}%`)
  .join(", ")})`
