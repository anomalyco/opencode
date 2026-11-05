---
title: CSS
description: Bun's bundler has built-in support for CSS with modern features
---

Bun's bundler has built-in support for CSS with the following features:

- Transpiling modern/future features to work on all browsers (including vendor prefixing)
- Minification
- CSS Modules
- Tailwind (via a native bundler plugin)

## Transpiling

Bun's CSS bundler lets you use modern/future CSS features without having to worry about browser compatibility — all thanks to its transpiling and vendor prefixing features which are enabled by default.

Bun's CSS parser and bundler is a direct Rust → Zig port of LightningCSS, with a bundling approach inspired by esbuild. The transpiler converts modern CSS syntax into backwards-compatible equivalents that work across browsers.

<Note>A huge thanks goes to the amazing work from the authors of LightningCSS and esbuild.</Note>

## Browser Compatibility

By default, Bun's CSS bundler targets the following browsers:

- ES2020
- Edge 88+
- Firefox 78+
- Chrome 87+
- Safari 14+

## Syntax Lowering

### Nesting

The CSS Nesting specification allows you to write more concise and intuitive stylesheets by nesting selectors inside one another. Instead of repeating parent selectors across your CSS file, you can write child styles directly within their parent blocks.

```scss title="styles.css" icon="file-code"
/* With nesting */
.card {
  background: white;
  border-radius: 4px;

  .title {
    font-size: 1.2rem;
    font-weight: bold;
  }

  .content {
    padding: 1rem;
  }
}
```

Bun's CSS bundler automatically converts this nested syntax into traditional flat CSS that works in all browsers:

```css title="styles.css" icon="file-code"
/* Compiled output */
.card {
  background: white;
  border-radius: 4px;
}

.card .title {
  font-size: 1.2rem;
  font-weight: bold;
}

.card .content {
  padding: 1rem;
}
```

You can also nest media queries and other at-rules inside selectors, eliminating the need to repeat selector patterns:

```scss title="styles.css" icon="file-code"
.responsive-element {
  display: block;

  @media (min-width: 768px) {
    display: flex;
  }
}
```

This compiles to:

```css title="styles.css" icon="file-code"
.responsive-element {
  display: block;
}

@media (min-width: 768px) {
  .responsive-element {
    display: flex;
  }
}
```

### Color mix

The `color-mix()` function blends two colors together according to a specified ratio in a chosen color space. Use it to create color variations without manually calculating the resulting values.

```scss title="styles.css" icon="file-code"
.button {
  /* Mix blue and red in the RGB color space with a 30/70 proportion */
  background-color: color-mix(in srgb, blue 30%, red);

  /* Create a lighter variant for hover state */
  &:hover {
    background-color: color-mix(in srgb, blue 30%, red, white 20%);
  }
}
```

Bun's CSS bundler evaluates these color mixes at build time when all color values are known (not CSS variables), generating static color values that work in all browsers:

```css title="styles.css" icon="file-code"
.button {
  /* Computed to the exact resulting color */
  background-color: #b31a1a;
}

.button:hover {
  background-color: #c54747;
}
```

This feature is particularly useful for creating color systems with programmatically derived shades, tints, and accents without needing preprocessors or custom tooling.

### Relative colors

CSS allows you to modify individual components of a color using relative color syntax. Create color variations by adjusting specific attributes like lightness, saturation, or individual channels without having to recalculate the entire color.

```css title="styles.css" icon="file-code"
.theme-color {
  /* Start with a base color and increase lightness by 15% */
  --accent: lch(from purple calc(l + 15%) c h);

  /* Take our brand blue and make a desaturated version */
  --subtle-blue: oklch(from var(--brand-blue) l calc(c * 0.8) h);
}
```

Bun's CSS bundler computes these relative color modifications at build time (when not using CSS variables) and generates static color values for browser compatibility:

```css
.theme-color {
  --accent: lch(69.32% 58.34 328.37);
  --subtle-blue: oklch(60.92% 0.112 240.01);
}
```

This approach is extremely useful for theme generation, creating accessible color variants, or building color scales based on mathematical relationships instead of hard-coding each value.

### LAB colors

Modern CSS supports perceptually uniform color spaces like LAB, LCH, OKLAB, and OKLCH that offer significant advantages over traditional RGB. These color spaces can represent colors outside the standard RGB gamut, resulting in more vibrant and visually consistent designs.

```css title="styles.css" icon="file-code"
.vibrant-element {
  /* A vibrant red that exceeds sRGB gamut boundaries */
  color: lab(55% 78 35);

  /* A smooth gradient using perceptual color space */
  background: linear-gradient(to right, oklch(65% 0.25 10deg), oklch(65% 0.25 250deg));
}
```

Bun's CSS bundler automatically converts these advanced color formats to backwards-compatible alternatives for browsers that don't yet support them:

```css title="styles.css" icon="file-code"
.vibrant-element {
  /* Fallback to closest RGB approximation */
  color: #ff0f52;
  /* P3 fallback for browsers with wider gamut support */
  color: color(display-p3 1 0.12 0.37);
  /* Original value preserved for browsers that support it */
  color: lab(55% 78 35);

  background: linear-gradient(to right, #cd4e15, #3887ab);
  background: linear-gradient(to right, oklch(65% 0.25 10deg), oklch(65% 0.25 250deg));
}
```

This layered approach ensures optimal color rendering across all browsers while allowing you to use the latest color technologies in your designs.

### Color function

The `color()` function provides a standardized way to specify colors in various predefined color spaces, expanding your design options beyond the traditional RGB space. This allows you to access wider color gamuts and create more vibrant designs.

```css title="styles.css" icon="file-code"
.vivid-element {
  /* Using the Display P3 color space for wider gamut colors */
  color: color(display-p3 1 0.1 0.3);

  /* Using A98 RGB color space */
  background-color: color(a98-rgb 0.44 0.5 0.37);
}
```

For browsers that don't support these advanced color functions yet, Bun's CSS bundler provides appropriate RGB fallbacks:

```css title="styles.css" icon="file-code"
.vivid-element {
  /* RGB fallback first for maximum compatibility */
  color: #fa1a4c;
  /* Keep original for browsers that support it */
  color: color(display-p3 1 0.1 0.3);

  background-color: #6a805d;
  background-color: color(a98-rgb 0.44 0.5 0.37);
}
```

This functionality lets you use modern color spaces immediately while ensuring your designs remain functional across all browsers, with optimal colors displayed in supporting browsers and reasonable approximations elsewhere.

### HWB colors

The HWB (Hue, Whiteness, Blackness) color model expresses colors based on how much white or black is mixed with a pure hue. Many designers find this approach more natural for creating color variations compared to manipulating RGB or HSL values.

```css title="styles.css" icon="file-code"
.easy-theming {
  /* Pure cyan with no white or black added */
  --primary: hwb(180 0% 0%);

  /* Same hue, but with 20% white added (tint) */
  --primary-light: hwb(180 20% 0%);

  /* Same hue, but with 30% black added (shade) */
  --primary-dark: hwb(180 0% 30%);

  /* Muted version with both white and black added */
  --primary-muted: hwb(180 30% 20%);
}
```

Bun's CSS bundler automatically converts HWB colors to RGB for compatibility with all browsers:

```css title="styles.css" icon="file-code"
.easy-theming {
  --primary: #00ffff;
  --primary-light: #33ffff;
  --primary-dark: #00b3b3;
  --primary-muted: #339999;
}
```

The HWB model is well-suited for creating systematic color variations for design systems, providing a more direct approach to creating consistent tints and shades than working with RGB or HSL values.

### Color notation

Modern CSS has introduced more concise ways to express colors. Space-separated color syntax eliminates the need for commas in RGB and HSL values, while hex colors with alpha channels provide a compact way to specify transparency.

```css title="styles.css" icon="file-code"
.modern-styling {
  /* Space-separated RGB notation (no commas) */
  color: rgb(50 100 200);

  /* Space-separated RGB with alpha */
  border-color: rgba(100 50 200 / 75%);

  /* Hex with alpha channel (8 digits) */
  background-color: #00aaff80;

  /* HSL with simplified notation */
  box-shadow: 0 5px 10px hsl(200 50% 30% / 40%);
}
```

Bun's CSS bundler automatically converts these modern color formats to ensure compatibility with older browsers:

```css title="styles.css" icon="file-code"
.modern-styling {
  /* Converted to comma format for older browsers */
  color: rgb(50, 100, 200);

  /* Alpha channels handled appropriately */
  border-color: rgba(100, 50, 200, 0.75);

  /* Hex+alpha converted to rgba when needed */
  background-color: rgba(0, 170, 255, 0.5);

  box-shadow: 0 5px 10px rgba(38, 115, 153, 0.4);
}
```

This conversion process lets you write cleaner, more modern CSS while ensuring your styles work correctly across all browsers.

### light-dark() color function

The `light-dark()` function implements color schemes that respect the user's system preference without requiring media queries. This function accepts two color values and automatically selects the appropriate one based on the current color scheme context.

```css title="styles.css" icon="file-code"
:root {
  /* Define color scheme support */
  color-scheme: light dark;
}

.themed-component {
  /* Automatically picks the right color based on system preference */
  background-color: light-dark(#ffffff, #121212);
  color: light-dark(#333333, #eeeeee);
  border-color: light-dark(#dddddd, #555555);
}

/* Override system preference when needed */
.light-theme {
  color-scheme: light;
}

.dark-theme {
  color-scheme: dark;
}
```

For browsers that don't support this feature yet, Bun's CSS bundler converts it to use CSS variables with proper fallbacks:

```css title="styles.css" icon="file-code"
:root {
  --lightningcss-light: initial;
  --lightningcss-dark: ;
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :root {
    --lightningcss-light: ;
    --lightningcss-dark: initial;
  }
}

.light-theme {
  --lightningcss-light: initial;
  --lightningcss-dark: ;
  color-scheme: light;
}

.dark-theme {
  --lightningcss-light: ;
  --lightningcss-dark: initial;
  color-scheme: dark;
}

.themed-component {
  background-color: var(--lightningcss-light, #ffffff) var(--lightningcss-dark, #121212);
  color: var(--lightningcss-light, #333333) var(--lightningcss-dark, #eeeeee);
  border-color: var(--lightningcss-light, #dddddd) var(--lightningcss-dark, #555555);
}
```

This approach gives you a clean way to handle light and dark themes without duplicating styles or writing complex media queries, while maintaining compatibility with browsers that don't yet support the feature natively.

### Logical properties

CSS logical properties let you define layout, spacing, and sizing relative to the document's writing mode and text direction rather than physical screen directions. This is crucial for creating truly international layouts that automatically adapt to different writing systems.

```css title="styles.css" icon="file-code"
.multilingual-component {
  /* Margin that adapts to writing direction */
  margin-inline-start: 1rem;

  /* Padding that makes sense regardless of text direction */
  padding-block: 1rem 2rem;

  /* Border radius for the starting corner at the top */
  border-start-start-radius: 4px;

  /* Size that respects the writing mode */
  inline-size: 80%;
  block-size: auto;
}
```

For browsers that don't fully support logical properties, Bun's CSS bundler compiles them to physical properties with appropriate directional adjustments:

```css title="styles.css" icon="file-code"
/* For left-to-right languages */
.multilingual-component:dir(ltr) {
  margin-left: 1rem;
  padding-top: 1rem;
  padding-bottom: 2rem;
  border-top-left-radius: 4px;
  width: 80%;
  height: auto;
}

/* For right-to-left languages */
.multilingual-component:dir(rtl) {
  margin-right: 1rem;
  padding-top: 1rem;
  padding-bottom: 2rem;
  border-top-right-radius: 4px;
  width: 80%;
  height: auto;
}
```

If the `:dir()` selector isn't supported, additional fallbacks are automatically generated to ensure your layouts work properly across all browsers and writing systems. This makes creating internationalized designs much simpler while maintaining compatibility with older browsers.

### :dir() selector

The `:dir()` pseudo-class selector allows you to style elements based on their text direction (RTL or LTR), letting you create direction-aware designs without JavaScript. This selector matches elements based on their directionality as determined by the document or explicit direction attributes.

```css title="styles.css" icon="file-code"
/* Apply different styles based on text direction */
.nav-arrow:dir(ltr) {
  transform: rotate(0deg);
}

.nav-arrow:dir(rtl) {
  transform: rotate(180deg);
}

/* Position elements based on text flow */
.sidebar:dir(ltr) {
  border-right: 1px solid #ddd;
}

.sidebar:dir(rtl) {
  border-left: 1px solid #ddd;
}
```

For browsers that don't support the `:dir()` selector yet, Bun's CSS bundler converts it to the more widely supported `:lang()` selector with appropriate language mappings:

```css title="styles.css" icon="file-code"
/* Converted to use language-based selectors as fallback */
.nav-arrow:lang(en, fr, de, es, it, pt, nl) {
  transform: rotate(0deg);
}

.nav-arrow:lang(ar, he, fa, ur) {
  transform: rotate(180deg);
}

.sidebar:lang(en, fr, de, es, it, pt, nl) {
  border-right: 1px solid #ddd;
}

.sidebar:lang(ar, he, fa, ur) {
  border-left: 1px solid #ddd;
}
```

This conversion lets you write direction-aware CSS that works reliably across browsers, even those that don't yet support the `:dir()` selector natively. If multiple arguments to `:lang()` aren't supported, further fallbacks are automatically provided.

### :lang() selector

The `:lang()` pseudo-class selector targets elements based on the language they're in, enabling language-specific styling. Modern CSS supports passing multiple language codes to `:lang()`, letting you group language-specific rules more efficiently.

```css title="styles.css" icon="file-code"
/* Typography adjustments for CJK languages */
:lang(zh, ja, ko) {
  line-height: 1.8;
  font-size: 1.05em;
}

/* Different quote styles by language group */
blockquote:lang(fr, it, es, pt) {
  font-style: italic;
}

blockquote:lang(de, nl, da, sv) {
  font-weight: 500;
}
```

For browsers that don't support multiple arguments in the `:lang()` selector, Bun's CSS bundler converts this syntax to use the `:is()` selector to maintain the same behavior:

```css title="styles.css" icon="file-code"
/* Multiple languages grouped with :is() for better browser support */
:is(:lang(zh), :lang(ja), :lang(ko)) {
  line-height: 1.8;
  font-size: 1.05em;
}

blockquote:is(:lang(fr), :lang(it), :lang(es), :lang(pt)) {
  font-style: italic;
}

blockquote:is(:lang(de), :lang(nl), :lang(da), :lang(sv)) {
  font-weight: 500;
}
```

If needed, Bun can provide additional fallbacks for `:is()` as well, ensuring your language-specific styles work across all browsers. This approach simplifies creating internationalized designs with distinct typographic and styling rules for different language groups.

### :is() selector

The `:is()` pseudo-class function (formerly `:matches()`) allows you to create more concise and readable selectors by grouping multiple selectors together. It accepts a selector list as its argument and matches if any of the selectors in that list match, significantly reducing repetition in your CSS.

```css title="styles.css" icon="file-code"
/* Instead of writing these separately */
/* 
.article h1,
.article h2,
.article h3 {
  margin-top: 1.5em;
}
*/

/* You can write this */
.article :is(h1, h2, h3) {
  margin-top: 1.5em;
}

/* Complex example with multiple groups */
:is(header, main, footer) :is(h1, h2, .title) {
  font-family: "Heading Font", sans-serif;
}
```

For browsers that don't support `:is()`, Bun's CSS bundler provides fallbacks using vendor-prefixed alternatives:

```css
/* Fallback using -webkit-any */
.article :-webkit-any(h1, h2, h3) {
  margin-top: 1.5em;
}

/* Fallback using -moz-any */
.article :-moz-any(h1, h2, h3) {
  margin-top: 1.5em;
}

/* Original preserved for modern browsers */
.article :is(h1, h2, h3) {
  margin-top: 1.5em;
}

/* Complex example with fallbacks */
:-webkit-any(header, main, footer) :-webkit-any(h1, h2, .title) {
  font-family: "Heading Font", sans-serif;
}

:-moz-any(header, main, footer) :-moz-any(h1, h2, .title) {
  font-family: "Heading Font", sans-serif;
}

:is(header, main, footer) :is(h1, h2, .title) {
  font-family: "Heading Font", sans-serif;
}
```

<Warning>
  The vendor-prefixed versions have some limitations compared to the standardized `:is()` selector, particularly with
  complex selectors. Bun handles these limitations intelligently, only using prefixed versions when they'll work
  correctly.
</Warning>

### :not() selector

The `:not()` pseudo-class allows you to exclude elements that match a specific selector. The modern version of this selector accepts multiple arguments, letting you exclude multiple patterns with a single, concise selector.

```css title="styles.css" icon="file-code"
/* Select all buttons except primary and secondary variants */
button:not(.primary, .secondary) {
  background-color: #f5f5f5;
  border: 1px solid #ddd;
}

/* Apply styles to all headings except those inside sidebars or footers */
h2:not(.sidebar *, footer *) {
  margin-top: 2em;
}
```

For browsers that don't support multiple arguments in `:not()`, Bun's CSS bundler converts this syntax to a more compatible form while preserving the same behavior:

```css title="styles.css" icon="file-code"
/* Converted to use :not with :is() for compatibility */
button:not(:is(.primary, .secondary)) {
  background-color: #f5f5f5;
  border: 1px solid #ddd;
}

h2:not(:is(.sidebar *, footer *)) {
  margin-top: 2em;
}
```

And if `:is()` isn't supported, Bun can generate further fallbacks:

```css title="styles.css" icon="file-code"
/* Even more fallbacks for maximum compatibility */
button:not(:-webkit-any(.primary, .secondary)) {
  background-color: #f5f5f5;
  border: 1px solid #ddd;
}

button:not(:-moz-any(.primary, .secondary)) {
  background-color: #f5f5f5;
  border: 1px solid #ddd;
}

button:not(:is(.primary, .secondary)) {
  background-color: #f5f5f5;
  border: 1px solid #ddd;
}
```

This conversion ensures your negative selectors work correctly across all browsers while maintaining the correct specificity and behavior of the original selector.

### Math functions

CSS now includes a rich set of mathematical functions that let you perform complex calculations directly in your stylesheets. These include standard math functions (`round()`, `mod()`, `rem()`, `abs()`, `sign()`), trigonometric functions (`sin()`, `cos()`, `tan()`, `asin()`, `acos()`, `atan()`, `atan2()`), and exponential functions (`pow()`, `sqrt()`, `exp()`, `log()`, `hypot()`).

```css title="styles.css" icon="file-code"
.dynamic-sizing {
  /* Clamp a value between minimum and maximum */
  width: clamp(200px, 50%, 800px);

  /* Round to the nearest multiple */
  padding: round(14.8px, 5px);

  /* Trigonometry for animations or layouts */
  transform: rotate(calc(sin(45deg) * 50deg));

  /* Complex math with multiple functions */
  --scale-factor: pow(1.25, 3);
  font-size: calc(16px * var(--scale-factor));
}
```

Bun's CSS bundler evaluates these mathematical expressions at build time when all values are known constants (not variables), resulting in optimized output:

```css title="styles.css" icon="file-code"
.dynamic-sizing {
  width: clamp(200px, 50%, 800px);
  padding: 15px;
  transform: rotate(35.36deg);
  --scale-factor: 1.953125;
  font-size: calc(16px * var(--scale-factor));
}
```

This approach lets you write more expressive and maintainable CSS with meaningful mathematical relationships, which then gets compiled to optimized values for maximum browser compatibility and performance.

### Media query ranges

Modern CSS supports range syntax for media queries, allowing you to specify breakpoints using comparison operators like `<`, `>`, `<=`, and `>=` instead of the more verbose `min-` and `max-` prefixes. This syntax is more readable and matches how you typically think about values and ranges.

```css title="styles.css" icon="file-code"
/* Modern syntax with comparison operators */
@media (width >= 768px) {
  .container {
    max-width: 720px;
  }
}

/* Inclusive range using <= and >= */
@media (768px <= width <= 1199px) {
  .sidebar {
    display: flex;
  }
}

/* Exclusive range using < and > */
@media (width > 320px) and (width < 768px) {
  .mobile-only {
    display: block;
  }
}
```

Bun's CSS bundler converts these modern range queries to traditional media query syntax for compatibility with all browsers:

```css title="styles.css" icon="file-code"
/* Converted to traditional min/max syntax */
@media (min-width: 768px) {
  .container {
    max-width: 720px;
  }
}

@media (min-width: 768px) and (max-width: 1199px) {
  .sidebar {
    display: flex;
  }
}

@media (min-width: 321px) and (max-width: 767px) {
  .mobile-only {
    display: block;
  }
}
```

This lets you write more readable media queries while ensuring your stylesheets work correctly across all browsers, including those that don't support the modern range syntax.

### Shorthands

CSS has introduced several modern shorthand properties that improve code readability and maintainability. Bun's CSS bundler ensures these convenient shorthands work on all browsers by converting them to their longhand equivalents when needed.

```css title="styles.css" icon="file-code"
/* Alignment shorthands */
.flex-container {
  /* Shorthand for align-items and justify-items */
  place-items: center start;

  /* Shorthand for align-content and justify-content */
  place-content: space-between center;
}

.grid-item {
  /* Shorthand for align-self and justify-self */
  place-self: end center;
}

/* Two-value overflow */
.content-box {
  /* First value for horizontal, second for vertical */
  overflow: hidden auto;
}

/* Enhanced text-decoration */
.fancy-link {
  /* Combines multiple text decoration properties */
  text-decoration: underline dotted blue 2px;
}

/* Two-value display syntax */
.component {
  /* Outer display type + inner display type */
  display: inline flex;
}
```

For browsers that don't support these modern shorthands, Bun converts them to their component longhand properties:

```css title="styles.css" icon="file-code"
.flex-container {
  /* Expanded alignment properties */
  align-items: center;
  justify-items: start;

  align-content: space-between;
  justify-content: center;
}

.grid-item {
  align-self: end;
  justify-self: center;
}

.content-box {
  /* Separate overflow properties */
  overflow-x: hidden;
  overflow-y: auto;
}

.fancy-link {
  /* Individual text decoration properties */
  text-decoration-line: underline;
  text-decoration-style: dotted;
  text-decoration-color: blue;
  text-decoration-thickness: 2px;
}

.component {
  /* Single value display */
  display: inline-flex;
}
```

This conversion ensures your stylesheets remain clean and maintainable while providing the broadest possible browser compatibility.

### Double position gradients

The double position gradient syntax is a modern CSS feature that allows you to create hard color stops in gradients by specifying the same color at two adjacent positions. This creates a sharp transition rather than a smooth fade, which is useful for creating stripes, color bands, and other multi-color designs.

```css title="styles.css" icon="file-code"
.striped-background {
  /* Creates a sharp transition from green to red at 30%-40% */
  background: linear-gradient(
    to right,
    yellow 0%,
    green 20%,
    green 30%,
    red 30%,
    /* Double position creates hard stop */ red 70%,
    blue 70%,
    blue 100%
  );
}

.progress-bar {
  /* Creates distinct color sections */
  background: linear-gradient(
    to right,
    #4caf50 0% 25%,
    /* Green from 0% to 25% */ #ffc107 25% 50%,
    /* Yellow from 25% to 50% */ #2196f3 50% 75%,
    /* Blue from 50% to 75% */ #9c27b0 75% 100% /* Purple from 75% to 100% */
  );
}
```

For browsers that don't support this syntax, Bun's CSS bundler automatically converts it to the traditional format by duplicating color stops:

```css title="styles.css" icon="file-code"
.striped-background {
  background: linear-gradient(
    to right,
    yellow 0%,
    green 20%,
    green 30%,
    red 30%,
    /* Split into two color stops */ red 70%,
    blue 70%,
    blue 100%
  );
}

.progress-bar {
  background: linear-gradient(
    to right,
    #4caf50 0%,
    #4caf50 25%,
    /* Two stops for green section */ #ffc107 25%,
    #ffc107 50%,
    /* Two stops for yellow section */ #2196f3 50%,
    #2196f3 75%,
    /* Two stops for blue section */ #9c27b0 75%,
    #9c27b0 100% /* Two stops for purple section */
  );
}
```

This conversion lets you use the cleaner double position syntax in your source code while ensuring gradients display correctly in all browsers.

### system-ui font

The `system-ui` generic font family lets you use the device's native UI font, creating interfaces that feel more integrated with the operating system. This provides a more native look and feel without having to specify different font stacks for each platform.

```css title="styles.css" icon="file-code"
.native-interface {
  /* Use the system's default UI font */
  font-family: system-ui;
}

.fallback-aware {
  /* System UI font with explicit fallbacks */
  font-family: system-ui, sans-serif;
}
```

For browsers that don't support `system-ui`, Bun's CSS bundler automatically expands it to a comprehensive cross-platform font stack:

```css title="styles.css" icon="file-code"
.native-interface {
  /* Expanded to support all major platforms */
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    "Noto Sans",
    Ubuntu,
    Cantarell,
    "Helvetica Neue";
}

.fallback-aware {
  /* Preserves the original fallback after the expanded stack */
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    "Noto Sans",
    Ubuntu,
    Cantarell,
    "Helvetica Neue",
    sans-serif;
}
```

This approach gives you the simplicity of writing just `system-ui` in your source code while ensuring your interface adapts correctly to all operating systems and browsers. The expanded font stack includes appropriate system fonts for macOS/iOS, Windows, Android, Linux, and fallbacks for older browsers.

## CSS Modules

Bun's bundler also supports bundling CSS modules in addition to regular CSS with support for the following features:

- Automatically detecting CSS module files (`.module.css`) with zero configuration
- Composition (`composes` property)
- Importing CSS modules into JSX/TSX
- Warnings/errors for invalid usages of CSS modules

A CSS module is a CSS file (with the `.module.css` extension) where are all class names and animations are scoped to the file. This helps you avoid class name collisions as CSS declarations are globally scoped by default.

Under the hood, Bun's bundler transforms locally scoped class names into unique identifiers.

### Getting started

Create a CSS file with the `.module.css` extension:

```css title="styles.module.css" icon="file-code"
.button {
  color: red;
}
```

```css title="other-styles.module.css" icon="file-code"
.button {
  color: blue;
}
```

You can then import this file, for example into a TSX file:

```tsx title="app.tsx" icon="/icons/typescript.svg"
import styles from "./styles.module.css";
import otherStyles from "./other-styles.module.css";

export default function App() {
  return (
    <>
      <button className={styles.button}>Red button!</button>
      <button className={otherStyles.button}>Blue button!</button>
    </>
  );
}
```

The styles object from importing the CSS module file will be an object with all class names as keys and their unique identifiers as values:

```ts title="app.tsx" icon="/icons/typescript.svg"
import styles from "./styles.module.css";
import otherStyles from "./other-styles.module.css";

console.log(styles);
console.log(otherStyles);
```

This will output:

```ts title="app.tsx" icon="/icons/typescript.svg"
{
  button: "button_123";
}

{
  button: "button_456";
}
```

As you can see, the class names are unique to each file, avoiding any collisions!

### Composition

CSS modules allow you to compose class selectors together. This lets you reuse style rules across multiple classes.

For example:

```css title="styles.module.css" icon="file-code"
.button {
  composes: background;
  color: red;
}

.background {
  background-color: blue;
}
```

Would be the same as writing:

```css title="styles.module.css" icon="file-code"
.button {
  background-color: blue;
  color: red;
}

.background {
  background-color: blue;
}
```

There are a couple rules to keep in mind when using `composes`:

<Info>
  **Composition Rules:** - A `composes` property must come before any regular CSS properties or declarations - You can
  only use `composes` on a simple selector with a single class name
</Info>

```css title="styles.module.css" icon="file-code"
#button {
  /* Invalid! `#button` is not a class selector */
  composes: background;
}

.button,
.button-secondary {
  /* Invalid! `.button, .button-secondary` is not a simple selector */
  composes: background;
}
```

### Composing from a separate CSS module file

You can also compose from a separate CSS module file:

```css title="background.module.css" icon="file-code"
.background {
  background-color: blue;
}
```

```css title="styles.module.css" icon="file-code"
.button {
  composes: background from "./background.module.css";
  color: red;
}
```

<Warning>
When composing classes from separate files, be sure that they do not contain the same properties.

The CSS module spec says that composing classes from separate files with conflicting properties is undefined behavior, meaning that the output may differ and be unreliable.

</Warning>
