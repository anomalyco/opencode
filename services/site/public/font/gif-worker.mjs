import { GIFEncoder, applyPalette } from './vendor/gifenc.js';
import { CONFETTI_DURATION, confettiColors, createConfetti, drawConfetti, letterCelebrationAt, projectLetterSlice } from './confetti.mjs';

function rgb(color) {
  if (color.startsWith('#')) {
    return [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
  }
  return color.match(/[\d.]+/g).slice(0, 3).map(Number);
}

function createPalette(composition) {
  const background = rgb(composition.background);
  const shadow = rgb(composition.shadow);
  const ink = rgb(composition.ink);
  const caret = rgb(composition.caret);
  const palette = [background, shadow, ink, caret];
  // Include anti-aliasing shades without changing the exact theme colours.
  for (const [from, to] of [[background, shadow], [background, ink], [shadow, ink], [background, caret]]) {
    for (let step = 1; step < 16; step++) {
      palette.push(from.map((value, channel) => Math.round(value + (to[channel] - value) * step / 16)));
    }
  }
  if (composition.confettiEnabled) {
    for (const color of confettiColors()) {
      const target = rgb(color);
      palette.push(target);
      for (let step = 1; step < 8; step++) {
        palette.push(background.map((value, channel) => Math.round(value + (target[channel] - value) * step / 8)));
      }
    }
  }
  return palette;
}

self.onmessage = ({ data: composition }) => {
  try {
    const { width, height } = composition;
    const particles = createConfetti(composition.confettiSeed);
    const frames = [];
    let time = 0;
    let celebrationStart = null;
    function appendFrame(frame) {
      if (composition.confettiEnabled && frame.anagram && celebrationStart === null) celebrationStart = time;
      let remaining = frame.delay;
      while (remaining > 0) {
        const celebrating = celebrationStart !== null && time < celebrationStart + CONFETTI_DURATION;
        const delay = celebrating ? Math.min(50, remaining) : remaining;
        frames.push({ ...frame, delay, confettiTime: celebrating ? time - celebrationStart + delay / 2 : -1 });
        time += delay;
        remaining -= delay;
      }
    }
    composition.frames.forEach(appendFrame);
    // Let the full burst play before holding the finished composition and looping.
    if (celebrationStart !== null && time < celebrationStart + CONFETTI_DURATION + 650) {
      appendFrame({ ...composition.frames.at(-1), delay: celebrationStart + CONFETTI_DURATION + 650 - time });
    }
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const paths = Object.fromEntries(Object.entries(composition.paths).map(([letter, glyph]) => [letter, {
      ink: new Path2D(glyph.ink),
      shadow: new Path2D(glyph.shadow),
    }]));
    const palette = createPalette(composition);
    const gif = GIFEncoder();
    const textures = new Map();

    function letterTexture(letter) {
      if (textures.has(letter)) return textures.get(letter);
      const texture = new OffscreenCanvas(192, 336);
      const ctx = texture.getContext('2d');
      ctx.scale(8, 8);
      ctx.fillStyle = composition.shadow;
      ctx.fill(paths[letter].shadow);
      ctx.fillStyle = composition.ink;
      ctx.fill(paths[letter].ink);
      textures.set(letter, texture);
      return texture;
    }

    function drawFlippingLetter(glyph, motion) {
      const texture = letterTexture(glyph.letter);
      // Project horizontal strips through the same perspective used by CSS
      // rotateX, including the vertically reversed back face of the letter.
      const strips = 84;
      const stripHeight = texture.height / strips;
      for (let strip = 0; strip < strips; strip++) {
        // Overlap the samples slightly to avoid hairline seams when the face
        // becomes almost edge-on and several strips share a destination pixel.
        const sourceY = Math.max(0, strip * stripHeight - 2);
        const sourceEnd = Math.min(texture.height, (strip + 1) * stripHeight + 2);
        const sourceHeight = sourceEnd - sourceY;
        const top = projectLetterSlice((sourceY / texture.height - .5) * glyph.height, glyph.height, motion);
        const bottom = projectLetterSlice((sourceEnd / texture.height - .5) * glyph.height, glyph.height, motion);
        const projectedHeight = bottom.y - top.y;
        if (Math.abs(projectedHeight) < .0001) continue;
        const projectedWidth = glyph.width * (top.widthScale + bottom.widthScale) / 2;
        context.save();
        context.translate(-projectedWidth / 2, top.y);
        context.scale(projectedWidth / texture.width, projectedHeight / sourceHeight);
        context.drawImage(texture, 0, sourceY, texture.width, sourceHeight, 0, 0, texture.width, sourceHeight);
        context.restore();
      }
    }

    function draw(layout, showCaret, celebrationTime) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = composition.background;
      context.fillRect(0, 0, width, height);
      const scale = Math.min(composition.scale, (height - composition.padding * 2) / layout.height);
      context.setTransform(scale, 0, 0, scale, width / 2, height / 2);
      let letterIndex = 0;
      for (const glyph of layout.glyphs) {
        if (!glyph.letter) continue;
        const motion = letterCelebrationAt(letterIndex++, celebrationTime);
        context.save();
        context.translate(glyph.x + glyph.width / 2, glyph.y + glyph.height / 2 + motion.lift * glyph.height);
        if (motion.rotation !== 0) {
          drawFlippingLetter(glyph, motion);
        } else {
          context.translate(-glyph.width / 2, -glyph.height / 2);
          context.scale(glyph.width / 24, glyph.height / 42);
          context.fillStyle = composition.shadow;
          context.fill(paths[glyph.letter].shadow);
          context.fillStyle = composition.ink;
          context.fill(paths[glyph.letter].ink);
        }
        context.restore();
      }
      if (showCaret) {
        context.fillStyle = composition.caret;
        // Match the editor's 2px caret regardless of the frame's text scale.
        context.fillRect(layout.caret.x, layout.caret.y, 2 / scale, layout.caret.height);
      }
    }

    frames.forEach((frame, index) => {
      draw(frame.layout, frame.caret, frame.confettiTime);
      context.setTransform(1, 0, 0, 1, 0, 0);
      drawConfetti(context, particles, frame.confettiTime, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      const indexed = applyPalette(pixels, palette);
      gif.writeFrame(indexed, width, height, {
        palette: index === 0 ? palette : undefined,
        delay: frame.delay,
        repeat: 0,
        dispose: 1,
      });
      self.postMessage({ type: 'progress', percent: Math.round((index + 1) / frames.length * 100) });
    });
    gif.finish();
    const buffer = gif.bytes().buffer;
    self.postMessage({ type: 'done', buffer }, [buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
