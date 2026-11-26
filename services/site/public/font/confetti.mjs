export const CONFETTI_DURATION = 6200;
export const LETTER_PERSPECTIVE = 3.2;

export function letterCelebrationAt(index, elapsed) {
  const idle = { rotation: 0, lift: 0, scale: 1 };
  if (index < 0 || index >= 8 || elapsed < 0) return idle;
  // Forward flips travel left-to-right, then return in the opposite order.
  for (const [start, order] of [[40, index], [1300, 7 - index]]) {
    const progress = (elapsed - start - order * 70) / 550;
    if (progress < 0 || progress >= 1) continue;
    const eased = progress * progress * (3 - 2 * progress);
    const bounce = Math.sin(progress * Math.PI);
    return {
      rotation: -Math.PI * 2 * eased,
      lift: -.26 * bounce,
      scale: 1 + .18 * bounce,
    };
  }
  return idle;
}

export function projectLetterSlice(y, height, motion) {
  const scaledY = y * motion.scale;
  const perspective = height * LETTER_PERSPECTIVE;
  const depth = scaledY * Math.sin(motion.rotation);
  const projection = perspective / (perspective - depth);
  return {
    y: scaledY * Math.cos(motion.rotation) * projection,
    widthScale: motion.scale * projection,
  };
}

export function isPerfectAnagram(text) {
  const letters = text.toLowerCase().replace(/\s/gu, '');
  return letters !== 'opencode' && letters.length === 8 && [...letters].sort().join('') === 'cdeenoop';
}

export function confettiColors() {
  // The site's palette: its link blues, ink and greys.
  return ['#3b5cf6', '#4f8bff', '#141414', '#8a8a8a', '#cecece'];
}

export function createConfetti(seed) {
  // A seeded particle field lets the GIF replay the same burst as the screen.
  let state = seed >>> 0;
  function random() {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  }
  return Array.from({ length: 1600 }, (_, index) => {
    const left = index % 2 === 0;
    const shower = index >= 1280;
    const burst = Math.floor(index / 320);
    const centerBurst = !shower && burst === 2;
    return {
      x: shower ? random() : centerBurst ? .4 + random() * .2 : left ? .03 : .97,
      y: shower ? -.05 - random() * .2 : centerBurst ? .62 : .86 + random() * .1,
      vx: shower ? (random() - .5) * .2 : (left ? 1 : -1) * (.35 + random() * .7),
      vy: shower ? .12 + random() * .2 : -1.05 - random() * .6,
      gravity: shower ? .12 + random() * .05 : .42 + random() * .12,
      delay: shower ? .8 + random() * 2.6 : burst * .8 + random() * .24,
      size: 7 + random() * 9,
      rotation: random() * Math.PI * 2,
      spin: (random() - .5) * 12,
      phase: random() * Math.PI * 2,
      color: index % 5,
      shape: index % 11 === 0 ? 'star' : index % 7 === 0 ? 'ribbon' : index % 5 === 0 ? 'round' : 'paper',
    };
  });
}

export function drawConfetti(context, particles, elapsed, width, height) {
  if (elapsed < 0 || elapsed >= CONFETTI_DURATION) return;
  const colors = confettiColors();
  const sizeScale = Math.min(width, height) / 900;
  const opacity = Math.min(1, (CONFETTI_DURATION - elapsed) / 900);
  context.save();
  context.globalAlpha = opacity;
  for (const particle of particles) {
    const time = elapsed / 1000 - particle.delay;
    if (time < 0) continue;
    const x = (particle.x + particle.vx * time / (1 + .5 * time)) * width;
    const y = (particle.y + particle.vy * time + particle.gravity * time * time) * height;
    const size = particle.size * sizeScale;
    if (x < -size * 4 || x > width + size * 4 || y < -size * 4 || y > height + size * 4) continue;
    context.save();
    context.translate(x + Math.sin(time * 5 + particle.phase) * size, y);
    context.rotate(particle.rotation + particle.spin * time);
    context.scale(1, .25 + .75 * Math.abs(Math.cos(time * 7 + particle.phase)));
    context.fillStyle = colors[particle.color];
    if (particle.shape === 'round') {
      context.beginPath();
      context.arc(0, 0, size * .42, 0, Math.PI * 2);
      context.fill();
    } else if (particle.shape === 'star') {
      context.beginPath();
      for (let point = 0; point < 10; point++) {
        const radius = size * (point % 2 === 0 ? .7 : .3);
        const angle = point * Math.PI / 5 - Math.PI / 2;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (point === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.fill();
    } else if (particle.shape === 'ribbon') {
      context.fillRect(-size * .16, -size * 1.4, size * .32, size * 2.8);
    } else {
      context.fillRect(-size / 2, -size * .35, size, size * .7);
    }
    context.restore();
  }
  context.restore();
}
