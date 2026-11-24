/**
 * The arcade 404's reusable parts, for every version of the page (the image-based Arcade404 and
 * the three.js one):
 * - ArcadeChrome: the site's logo and nav where they sit on every page, the hidden h1, ⌘K search,
 *   tooltips and the sound switch.
 * - Sound: startAudio() on mount, play(name), duckAmbience(), mute state; manifest-driven with
 *   synthesised fallbacks; preferredVariant holds the chosen takes.
 * - Screen: drawScreen() draws the CRT (404, glitch, boot, start, select) into any 2D canvas;
 *   ArcadeScreen is the DOM version with real buttons; bootDuration, glitchDuration and bootFrame time them.
 * - GameFrame: a live anoma.ly/arcade game (dev proxy, WebGPU check, click to focus).
 * - ArcadePanel: the touch control panel that drives the game frame.
 * - games: the games, their covers and controls; gameUrl, sendKey and sendMouse.
 */
export { Arcade404 } from "./arcade"
export { dropOutcome, escapeAction, powerDownDuration, type ArcadeMoment } from "./flow"
export { ArcadeChrome } from "./chrome"
export { arcadeTone, backdropColor, toneInputs, toneScript } from "./tone"
export { SoundToggle, SpeakerIcon } from "./sound-toggle"
export {
  audible,
  duckAmbience,
  muted,
  play,
  preferredVariant,
  setMuted,
  startAudio,
  unlockAudio,
  type SoundName,
} from "./sound"
export { ArcadeScreen, type ScreenState } from "./screen"
export {
  drawScreen,
  glitchDuration,
  loadCovers,
  phosphor,
  phosphorHot,
  type CanvasScreenOptions,
  type CanvasScreenState,
} from "./screen-canvas"
export { bootDuration, bootFrame } from "./boot"
export { GameFrame } from "./game-frame"
export { ArcadePanel } from "./panel"
export { games, gameUrl, publicGameUrl, sendKey, sendMouse, type ButtonAction, type Game } from "./games"
export { PixelText } from "./pixel-text"
export { drawPixelText, pixelCells, pixelWidth } from "./pixel-font"
