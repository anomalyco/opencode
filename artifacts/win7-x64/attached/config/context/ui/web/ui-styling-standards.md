<!-- Context: development/ui-styling-standards | Priority: high | Version: 1.0 | Updated: 2025-12-09 -->
# UI Styling Standards

## Overview

Standards and conventions for CSS frameworks, responsive design, and styling best practices in frontend development.

## Quick Reference

**Framework**: Tailwind CSS + Flowbite (default)
**Approach**: Mobile-first responsive
**Format**: Utility-first CSS
**Specificity**: Use `!important` for overrides when needed

---

## CSS Framework Conventions

### Tailwind CSS

**Loading Method** (Preferred):

```html
<!-- ✅ Use CDN script tag -->
<script src="https://cdn.tailwindcss.com"></script>
```

**Avoid**:

```html
<!-- ❌ Don't use stylesheet link -->
<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
```

**Why**: Script tag allows for JIT compilation and configuration

### Flowbite

**Loading Method**:

```html
<!-- Flowbite CSS -->
<link href="https://cdn.jsdelivr.net/npm/flowbite@2.0.0/dist/flowbite.min.css" rel="stylesheet">

<!-- Flowbite JS -->
<script src="https://cdn.jsdelivr.net/npm/flowbite@2.0.0/dist/flowbite.min.js"></script>
```

**Usage**: Flowbite is the default component library unless user specifies otherwise

**Components Available**:
- Buttons, forms, modals
- Navigation, dropdowns, tabs
- Cards, alerts, badges
- Tables, pagination
- Tooltips, popovers

---

## Responsive Design Requirements

### Mobile-First Approach

**Rule**: ALL designs MUST be responsive

**Breakpoints** (Tailwind defaults):

```css
/* Mobile first - base styles apply to mobile */
.element { }

/* Small devices (640px and up) */
@media (min-width: 640px) { }  /* sm: */

/* Medium devices (768px and up) */
@media (min-width: 768px) { }  /* md: */

/* Large devices (1024px and up) */
@media (min-width: 1024px) { } /* lg: */

/* Extra large devices (1280px and up) */
@media (min-width: 1280px) { } /* xl: */

/* 2XL devices (1536px and up) */
@media (min-width: 1536px) { } /* 2xl: */
```

**Tailwind Syntax**:

```html
<!-- Mobile: stack, Desktop: side-by-side -->
<div class="flex flex-col md:flex-row">
  <div class="w-full md:w-1/2">Left</div>
  <div class="w-full md:w-1/2">Right</div>
</div>

<!-- Mobile: full width, Desktop: constrained -->
<div class="w-full lg:w-3/4 xl:w-1/2 mx-auto">
  Content
</div>
```

### Testing Requirements

✅ Test at minimum breakpoints: 375px, 768px, 1024px, 1440px
✅ Verify touch targets (min 44x44px)
✅ Check text readability at all sizes
✅ Ensure images scale properly
✅ Test navigation on mobile

---

## Color Palette Guidelines

### Avoid Bootstrap Blue

**Rule**: NEVER use generic Bootstrap blue (#007bff) unless explicitly requested

**Why**: Overused, lacks personality, feels dated

**Alternatives**:

```css
/* Instead of Bootstrap blue */
--bootstrap-blue: #007bff; /* ❌ Avoid */

/* Use contextual colors */
--primary: oklch(0.6489 0.2370 26.9728);    /* Vibrant orange */
--accent: oklch(0.5635 0.2408 260.8178);     /* Rich purple */
--info: oklch(0.6200 0.1900 260);            /* Modern blue */
--success: oklch(0.7323 0.2492 142.4953);    /* Fresh green */
```

### Color Usage Rules

1. **Semantic naming**: Use `--primary`, `--accent`, not `--blue`, `--red`
2. **Brand alignment**: Choose colors that match project personality
3. **Contrast testing**: Ensure WCAG AA compliance (4.5:1 minimum)
4. **Consistency**: Use theme variables throughout

---

## Background/Foreground Contrast

### Contrast Rule

**When designing components or posters**:

- **Light component** → Dark background
- **Dark component** → Light background

**Why**: Ensures visibility and creates visual hierarchy

**Examples**:

```html
<!-- Light card on dark background -->
<div class="bg-gray-900 p-8">
  <div class="bg-white text-gray-900 p-6 rounded-lg">
    Light card content
  </div>
</div>

<!-- Dark card on light background -->
<div class="bg-gray-50 p-8">
  <div class="bg-gray-900 text-white p-6 rounded-lg">
    Dark card content
  </div>
</div>
```

### Component-Specific Rules

**Posters/Hero Sections**:
- Use high contrast for readability
- Consider overlay gradients for text on images
- Test with actual content

**Cards/Panels**:
- Subtle elevation with shadows
- Clear boundary between card and background
- Consistent padding

---

## CSS Specificity & Overrides

### Using !important

**Rule**: Use `!important` for properties that might be overwritten by Tailwind or Flowbite

**Common Cases**:

```css
/* Typography overrides */
h1 {
  font-size: 2.5rem !important;
  font-weight: 700 !important;
  line-height: 1.2 !important;
}

body {
  font-family: 'Inter', sans-serif !important;
  color: var(--foreground) !important;
}

/* Component overrides */
.custom-button {
  background-color: var(--primary) !important;
  border-radius: var(--radius) !important;
}
```

**When NOT to use**:

```css
/* ❌ Don't use for everything */
.element {
  margin: 1rem !important;
  padding: 1rem !important;
  display: flex !important;
}

/* ✅ Use Tailwind utilities instead */
<div class="m-4 p-4 flex">
```

### Specificity Best Practices

1. **Prefer utility classes** over custom CSS
2. **Use !important sparingly** - only for framework overrides
3. **Scope custom styles** to avoid conflicts
4. **Use CSS custom properties** for theming

---

## Layout Patterns

### Flexbox (Preferred for 1D layouts)

```html
<!-- Horizontal layout -->
<div class="flex items-center gap-4">
  <div>Item 1</div>
  <div>Item 2</div>
</div>

<!-- Vertical layout -->
<div class="flex flex-col gap-4">
  <div>Item 1</div>
  <div>Item 2</div>
</div>

<!-- Centered content -->
<div class="flex items-center justify-center min-h-screen">
  <div>Centered content</div>
</div>
```

### Grid (Preferred for 2D layouts)

```html
<!-- Responsive grid -->
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  <div>Card 1</div>
  <div>Card 2</div>
  <div>Card 3</div>
</div>

<!-- Dashboard layout -->
<div class="grid grid-cols-12 gap-4">
  <aside class="col-span-12 lg:col-span-3">Sidebar</aside>
  <main class="col-span-12 lg:col-span-9">Content</main>
</div>
```

### Container Patterns

```html
<!-- Centered container with max width -->
<div class="container mx-auto px-4 max-w-7xl">
  Content
</div>

<!-- Full-width section with contained content -->
<section class="w-full bg-gray-50">
  <div class="container mx-auto px-4 py-12 max-w-6xl">
    Content
  </div>
</section>
```

---

## Typography Standards

### Hierarchy

```html
<!-- Heading scale -->
<h1 class="text-4xl md:text-5xl lg:text-6xl font-bold">Main Heading</h1>
<h2 class="text-3xl md:text-4xl font-semibold">Section Heading</h2>
<h3 class="text-2xl md:text-3xl font-semibold">Subsection</h3>
<h4 class="text-xl md:text-2xl font-medium">Minor Heading</h4>

<!-- Body text -->
<p class="text-base md:text-lg leading-relaxed">Body text</p>
<p class="text-sm text-gray-600">Secondary text</p>
<p class="text-xs text-gray-500">Caption text</p>
```

### Font Loading

**Always use Google Fonts**:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

**Apply in CSS**:

```css
body {
  font-family: 'Inter', sans-serif !important;
}
```

### Readability

- **Line length**: 60-80 characters optimal
- **Line height**: 1.5-1.75 for body text
- **Font size**: Minimum 16px for body text
- **Contrast**: 4.5:1 minimum for normal text

---

## Component Styling Patterns

### Buttons

```html
<!-- Primary button -->
<button class="bg-primary text-primary-foreground px-6 py-3 rounded-lg font-medium hover:opacity-90 transition-opacity">
  Primary Action
</button>

<!-- Secondary button -->
<button class="bg-secondary text-secondary-foreground px-6 py-3 rounded-lg font-medium hover:bg-secondary/80 transition-colors">
  Secondary Action
</button>

<!-- Outline button -->
<button class="border-2 border-primary text-primary px-6 py-3 rounded-lg font-medium hover:bg-primary hover:text-primary-foreground transition-all">
  Outline Action
</button>
```

### Cards

```html
<!-- Basic card -->
<div class="bg-card text-card-foreground rounded-lg shadow-md p-6">
  <h3 class="text-xl font-semibold mb-2">Card Title</h3>
  <p class="text-muted-foreground">Card content</p>
</div>

<!-- Interactive card -->
<div class="bg-card text-card-foreground rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer">
  <h3 class="text-xl font-semibold mb-2">Interactive Card</h3>
  <p class="text-muted-foreground">Hover for effect</p>
</div>
```

### Forms

```html
<!-- Input field -->
<div class="space-y-2">
  <label class="block text-sm font-medium">Email</label>
  <input 
    type="email" 
    class="w-full px-4 py-2 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
    placeholder="you@example.com"
  >
</div>

<!-- Textarea -->
<div class="space-y-2">
  <label class="block text-sm font-medium">Message</label>
  <textarea 
    class="w-full px-4 py-2 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent transition-all resize-none"
    rows="4"
    placeholder="Your message..."
  ></textarea>
</div>
```

---

## Accessibility Standards

### ARIA Labels

```html
<!-- Button with icon -->
<button aria-label="Close dialog">
  <svg>...</svg>
</button>

<!-- Navigation -->
<nav aria-label="Main navigation">
  <ul>...</ul>
</nav>
```

### Semantic HTML

```html
<!-- ✅ Use semantic elements -->
<header>...</header>
<nav>...</nav>
<main>...</main>
<article>...</article>
<aside>...</aside>
<footer>...</footer>

<!-- ❌ Avoid div soup -->
<div class="header">...</div>
<div class="nav">...</div>
<div class="main">...</div>
```

### Focus States

```css
/* Always provide visible focus states */
button:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

/* Tailwind utility */
<button class="focus:ring-2 focus:ring-ring focus:ring-offset-2">
  Button
</button>
```

---

## Performance Optimization

### CSS Loading

```html
<!-- Preconnect to font sources -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>

<!-- Preload critical fonts -->
<link rel="preload" href="/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
```

### Image Optimization

```html
<!-- Responsive images -->
<img 
  src="image-800.jpg" 
  srcset="image-400.jpg 400w, image-800.jpg 800w, image-1200.jpg 1200w"
  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
  alt="Description"
  loading="lazy"
>
```

### Critical CSS

```html
<!-- Inline critical CSS -->
<style>
  /* Above-the-fold styles */
  body { margin: 0; font-family: system-ui; }
  .hero { min-height: 100vh; }
</style>

<!-- Load full CSS async -->
<link rel="stylesheet" href="styles.css" media="print" onload="this.media='all'">
```

---

## Best Practices

### Do's ✅

- Use Tailwind utility classes for rapid development
- Load Tailwind via script tag for JIT compilation
- Use Flowbite as default component library
- Ensure all designs are mobile-first responsive
- Test at multiple breakpoints
- Use semantic HTML elements
- Provide ARIA labels for interactive elements
- Use CSS custom properties for theming
- Apply `!important` for framework overrides
- Ensure proper color contrast (WCAG AA)

### Don'ts ❌

- Don't use Bootstrap blue without explicit request
- Don't load Tailwind as a stylesheet
- Don't skip responsive design
- Don't use div soup (use semantic HTML)
- Don't forget focus states
- Don't hardcode colors (use theme variables)
- Don't skip accessibility testing
- Don't use tiny touch targets (<44px)
- Don't mix color formats
- Don't over-use `!important`

---

## Framework Alternatives

If user requests a different framework:

**Bootstrap**:
```html
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
```

**Bulma**:
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bulma@0.9.4/css/bulma.min.css">
```

**Foundation**:
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/foundation-sites@6.7.5/dist/css/foundation.min.css">
<script src="https://cdn.jsdelivr.net/npm/foundation-sites@6.7.5/dist/js/foundation.min.js"></script>
```

---

## References

- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Flowbite Components](https://flowbite.com/docs/getting-started/introduction/)
- [WCAG Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [MDN Web Accessibility](https://developer.mozilla.org/en-US/docs/Web/Accessibility)
