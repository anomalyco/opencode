<!-- Context: ui/building-scrollytelling-pages | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

---
description: "Step-by-step implementation of scroll-linked image sequence animations"
---

# Guide: Building Scrollytelling Pages

**Purpose**: Step-by-step implementation of scroll-linked image sequence animations

**Last Updated**: 2026-01-07

---

## Prerequisites

- Next.js 14+ project with App Router
- Framer Motion installed (`npm i framer-motion`)
- Tailwind CSS configured
- Image sequence ready (60-240 WebP frames)

---

## Step 1: Generate Image Sequences

Use nano banana or AI image tools to create start/end frames, then generate interpolation:

**Start frame prompt**:
```
Ultra-premium product photography of [product] on matte black surface,
minimalistic studio shoot, deep black background with subtle gradient,
soft rim lighting, cinematic, high contrast, luxury aesthetic, sharp focus,
no clutter, DSLR 85mm f/1.8, photorealistic
```

**End frame prompt**:
```
Exploded technical diagram of same [product], every component separated
and floating in alignment, against deep black studio background, visible
internal structure, hyper-realistic, studio rim lighting, cinematic,
high contrast, no labels, photorealistic
```

**Generate video**: Use AI video tools (Runway, Pika) to interpolate between frames.

**Export frames**: Use ffmpeg or ezgif to split video into 120+ WebP images.

```bash
ffmpeg -i animation.mp4 -vf fps=30 frame_%04d.webp
```

---

## Step 2: Project Structure

```
app/
├── page.tsx                    # Main landing page
├── components/
│   └── HeadphoneScroll.tsx    # Scroll animation component
└── globals.css                 # Dark theme, Inter font
public/
└── frames/
    ├── frame_0001.webp        # 120+ frames
    ├── frame_0002.webp
    └── ...
```

---

## Step 3: Setup globals.css

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    @apply bg-[#050505] text-white antialiased;
    font-family: 'Inter', -apple-system, sans-serif;
  }
}
```

---

## Step 4: Create Scroll Component

**Key patterns**:
- Container with `h-[400vh]` for long scroll
- Canvas with `sticky top-0` stays fixed
- `useScroll` tracks scroll progress (0-1)
- `useTransform` maps progress to frame index
- `useEffect` preloads all images

**Core logic**:
```tsx
const { scrollYProgress } = useScroll({ target: containerRef })
const frameIndex = useTransform(scrollYProgress, [0, 1], [0, 119])
```

---

## Step 5: Implement Preloader

Always preload images before starting animation:

```tsx
useEffect(() => {
  const loadImages = async () => {
    const promises = Array.from({ length: 120 }, (_, i) => {
      return new Promise((resolve) => {
        const img = new Image()
        img.src = `/frames/frame_${String(i + 1).padStart(4, '0')}.webp`
        img.onload = () => resolve(img)
      })
    })
    
    const loaded = await Promise.all(promises)
    setImages(loaded)
    setLoading(false)
  }
  
  loadImages()
}, [])
```

---

## Step 6: Canvas Rendering

Draw current frame to canvas on every scroll update:

```tsx
useEffect(() => {
  if (!canvasRef.current || !images.length) return
  
  const canvas = canvasRef.current
  const ctx = canvas.getContext('2d')
  const img = images[Math.round(currentFrame)]
  
  // Scale canvas to window
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  
  // Draw centered
  ctx.drawImage(img, 
    (canvas.width - img.width) / 2, 
    (canvas.height - img.height) / 2
  )
}, [currentFrame, images])
```

---

## Step 7: Add Text Overlays

Fade text in/out at specific scroll positions:

```tsx
<motion.div
  style={{
    opacity: useTransform(scrollYProgress, 
      [0.25, 0.30, 0.35], // Fade in 25-30%, out 35%
      [0, 1, 0]
    )
  }}
  className="absolute left-20 text-4xl font-bold"
>
  Precision Engineering.
</motion.div>
```

---

## Step 8: Match Backgrounds

**CRITICAL**: Page background MUST match image background exactly.

1. Open first frame in image editor
2. Use eyedropper tool on background (e.g., `#050505`)
3. Set page background to exact same color in globals.css
4. Test: Image edges should be invisible

---

## Step 9: Optimize Performance

```tsx
// Add GPU hint
<canvas 
  ref={canvasRef}
  className="sticky top-0 h-screen w-full"
  style={{ willChange: 'transform' }}
/>

// Throttle redraws on mobile
useEffect(() => {
  let rafId
  const render = () => {
    // Draw logic here
    rafId = requestAnimationFrame(render)
  }
  render()
  return () => cancelAnimationFrame(rafId)
}, [])
```

---

## Step 10: Add Loading State

Show spinner while frames load:

```tsx
{loading && (
  <div className="fixed inset-0 flex items-center justify-center bg-[#050505]">
    <div className="animate-spin h-12 w-12 border-4 border-white/20 border-t-white rounded-full" />
  </div>
)}
```

---

## Common Issues & Fixes

### Images not loading
- Check file paths match exactly (case-sensitive)
- Verify all frames exist in `/public/frames/`
- Open browser console for 404 errors

### Stuttering animation
- Ensure all images preloaded before starting
- Use WebP (not PNG/JPEG)
- Check canvas size isn't too large

### Visible image edges
- Background colors don't match exactly
- Use eyedropper tool, not guessing
- Check for gradients in image background

### Mobile performance
- Reduce frame count (use every 2nd frame)
- Debounce with requestAnimationFrame
- Consider disabling on small screens

---

## Testing Checklist

- [ ] All frames load without 404s
- [ ] Animation smooth from 0-100% scroll
- [ ] Text fades in/out at correct positions
- [ ] Background seamlessly blends with images
- [ ] Loading spinner shows before animation
- [ ] Works on mobile (or gracefully disabled)
- [ ] No console errors

---

## Related

- concepts/scroll-linked-animations.md - Understanding the technique
- examples/headphone-scrollytelling.md - Full code example
- lookup/animation-image-prompts.md - Prompts for frame generation

---

## References

- [Next.js Image Optimization](https://nextjs.org/docs/app/building-your-application/optimizing/images)
- [Framer Motion useScroll](https://www.framer.com/motion/use-scroll/)
