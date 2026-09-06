# Animation Cookbook for Premium Web Design

Ready-to-use animation patterns. Copy, adapt, deploy.

## Easing Curves Reference

```css
:root {
  --ease-out-expo:     cubic-bezier(0.16, 1, 0.3, 1);     /* Reveals, entrances */
  --ease-out-quart:    cubic-bezier(0.25, 1, 0.5, 1);     /* General UI */
  --ease-out-cubic:    cubic-bezier(0.33, 1, 0.68, 1);     /* Gentle deceleration */
  --ease-in-out-expo:  cubic-bezier(0.87, 0, 0.13, 1);    /* Apple-like symmetric */
  --ease-out-back:     cubic-bezier(0.34, 1.56, 0.64, 1); /* Playful overshoot */
}
```

NEVER use `linear` for UI animations. It feels robotic.

## Duration Guide

| Interaction | Duration | Easing |
|------------|----------|--------|
| Checkbox/toggle | 100ms | ease-out |
| Hover state | 150-200ms | ease-out |
| Tooltip show | 150-200ms | ease-out |
| Menu open/close | 250-300ms | ease-out-expo |
| Modal appear | 200-300ms | ease-out |
| Modal dismiss | 150-200ms | ease-in |
| Scroll reveal | 500-600ms | ease-out-expo |
| Page transition | 300-500ms | ease-in-out |

## Scroll Reveal (Intersection Observer)

```javascript
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  });
}, { rootMargin: '0px 0px -100px 0px', threshold: 0.1 });

document.querySelectorAll('[data-animate]').forEach(el => observer.observe(el));
```

```css
[data-animate] {
  opacity: 0; transform: translateY(30px);
  transition: opacity 0.6s var(--ease-out-expo), transform 0.6s var(--ease-out-expo);
}
[data-animate].is-visible { opacity: 1; transform: translateY(0); }

/* Stagger children */
[data-animate-stagger].is-visible > * {
  opacity: 1; transform: translateY(0);
  transition-delay: calc(var(--index, 0) * 75ms);
}
```

```javascript
// Set stagger indices
document.querySelectorAll('[data-animate-stagger]').forEach(container => {
  container.querySelectorAll(':scope > *').forEach((child, i) => {
    child.style.setProperty('--index', i);
  });
});
```

## CSS Scroll-Driven Animations (No JS)

```css
/* Reading progress bar */
.progress-bar {
  animation: grow-progress linear;
  animation-timeline: scroll();
}
@keyframes grow-progress { from { transform: scaleX(0); } to { transform: scaleX(1); } }

/* Fade-in on scroll */
.reveal {
  animation: fade-in linear;
  animation-timeline: view();
  animation-range: entry 0% entry 100%;
}
@keyframes fade-in {
  from { opacity: 0; transform: translateY(50px); }
  to { opacity: 1; transform: translateY(0); }
}
```

## Premium Button

```css
.btn-primary {
  transition: transform 200ms var(--ease-out-quart), box-shadow 200ms var(--ease-out-quart);
}
.btn-primary:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
.btn-primary:active { transform: translateY(0) scale(0.98); transition-duration: 100ms; }

/* Background sweep effect */
.btn-primary::before {
  content: ''; position: absolute; inset: 0;
  background: rgba(255,255,255,0.1); transform: translateX(-100%);
  transition: transform 300ms var(--ease-out-expo);
}
.btn-primary:hover::before { transform: translateX(0); }
```

## Card Hover

```css
.card {
  transition: transform 300ms var(--ease-out-quart), box-shadow 300ms var(--ease-out-quart);
}
.card:hover { transform: translateY(-8px); box-shadow: var(--shadow-xl); }
```

## Link Underline Animation

```css
.link::after {
  content: ''; position: absolute; bottom: -2px; left: 0;
  width: 100%; height: 1px; background: currentColor;
  transform: scaleX(0); transform-origin: right;
  transition: transform 300ms var(--ease-out-expo);
}
.link:hover::after { transform: scaleX(1); transform-origin: left; }
```

## Mobile Menu Slide-In

```css
.nav-mobile {
  position: fixed; top: 0; right: 0; width: min(400px, 85vw); height: 100vh;
  transform: translateX(100%);
  transition: transform 400ms var(--ease-out-expo);
}
.nav-mobile.is-open { transform: translateX(0); }

/* Staggered items */
.nav-item { opacity: 0; transform: translateX(20px); transition: opacity 300ms ease, transform 300ms ease; }
.nav-mobile.is-open .nav-item:nth-child(1) { transition-delay: 100ms; }
.nav-mobile.is-open .nav-item:nth-child(2) { transition-delay: 150ms; }
.nav-mobile.is-open .nav-item:nth-child(3) { transition-delay: 200ms; }
.nav-mobile.is-open .nav-item { opacity: 1; transform: translateX(0); }
```

## Hamburger to X Morphing

```css
.hamburger span {
  display: block; position: absolute; height: 2px; width: 100%; background: var(--color-text);
  transition: all 250ms var(--ease-out-quart);
}
.hamburger span:nth-child(1) { top: 0; }
.hamburger span:nth-child(2) { top: 9px; }
.hamburger span:nth-child(3) { top: 18px; }
.hamburger.is-active span:nth-child(1) { top: 9px; transform: rotate(45deg); }
.hamburger.is-active span:nth-child(2) { opacity: 0; transform: translateX(10px); }
.hamburger.is-active span:nth-child(3) { top: 9px; transform: rotate(-45deg); }
```

## Header Hide/Show on Scroll

```css
.header { position: fixed; top: 0; width: 100%; transition: transform 300ms var(--ease-out-expo); }
.header.is-hidden { transform: translateY(-100%); }
```

## Skeleton Loading

```css
.skeleton {
  background: linear-gradient(90deg, var(--color-skeleton) 0%, var(--color-skeleton-highlight) 50%, var(--color-skeleton) 100%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: 4px;
}
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
```

## Floating Label Form Input

```css
.form-label {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  transition: all 200ms var(--ease-out-expo); transform-origin: left;
}
.form-input:focus + .form-label,
.form-input:not(:placeholder-shown) + .form-label {
  top: 8px; transform: translateY(0); font-size: 12px; color: var(--color-primary);
}
.form-input:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(var(--color-primary-rgb), 0.15); }
```

## View Transitions API

```css
@view-transition { navigation: auto; }
::view-transition-old(root) { animation: fade-out 0.3s ease-in forwards; }
::view-transition-new(root) { animation: fade-in 0.3s ease-out forwards; }
.hero-image { view-transition-name: hero; }
```

## GSAP Scroll Reveal

```javascript
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
gsap.registerPlugin(ScrollTrigger);

gsap.utils.toArray('.reveal').forEach(el => {
  gsap.from(el, {
    y: 60, opacity: 0, duration: 1, ease: 'power3.out',
    scrollTrigger: { trigger: el, start: 'top 85%', toggleActions: 'play none none none' }
  });
});
```

## Framer Motion / Motion for React

```jsx
import { motion } from 'motion/react';

function FadeUp({ children, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-100px' }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
```

## Spring Animation Presets (Framer Motion)

```javascript
// Gentle (smooth, no overshoot) -- subtle UI
{ type: 'spring', stiffness: 120, damping: 20, mass: 1 }

// Snappy (responsive, slight bounce) -- buttons, toggles
{ type: 'spring', stiffness: 300, damping: 20, mass: 1 }

// Bouncy (playful overshoot) -- notifications, badges
{ type: 'spring', stiffness: 400, damping: 10, mass: 1 }

// Heavy (deliberate, weighty) -- modals, large panels
{ type: 'spring', stiffness: 100, damping: 15, mass: 2 }
```

## Accessibility: prefers-reduced-motion

```css
/* Progressive enhancement approach (preferred) */
.element { opacity: 1; transform: none; }

@media (prefers-reduced-motion: no-preference) {
  .element {
    opacity: 0; transform: translateY(20px);
    transition: opacity 0.5s ease, transform 0.5s ease;
  }
  .element.is-visible { opacity: 1; transform: translateY(0); }
}
```

```javascript
// JS detection
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
if (prefersReducedMotion.matches) {
  // Disable or simplify animations
}
```

## Performance Rules

1. ONLY animate `transform` and `opacity` -- GPU-composited, no layout/paint
2. NEVER animate `width`, `height`, `top`, `left`, `margin`, `padding`, `border`
3. Use `will-change` sparingly -- apply before animation, remove after
4. Target 16.66ms per frame (60fps), 8.33ms for 120Hz
5. Test on low-end devices, not just your development machine
6. Use Intersection Observer to disable off-screen animations
