# Palette generation

Producing the values once the structure is decided. For which ramps to build and what each step is for, see [palette-structure.md](palette-structure.md).

## Start from the brand color

A brand color arrives as one value, usually a hex. Two decisions come before any ramp exists:

**Which step does it occupy?** A brand color meant for buttons and links belongs on the solid-fill step: `500` in Tailwind, `9` in Radix. Then `bg-brand-500` renders the actual brand color, not an approximation.

**Is it pinned or snapped?** Pin a contractually fixed brand color. It stays exact, the ramp builds outward from it and that one step spaces slightly unevenly. Otherwise snap it onto the ramp so every step spaces evenly. That looks better almost always, and nobody notices without a swatch held to the screen.

A brand color that fails contrast behind white text is still the brand color, just not the solid-fill step. Put it where it lands and use a darker step for interactive fills. Never quietly darken the brand.

## What a correct ramp looks like

Properties of the finished ramp, checkable against any output in any notation:

- **Steps are evenly spaced in perceived lightness.** Not in the number your format calls "lightness". HSL's is not perceptual, and evenly spaced HSL values bunch at one end.
- **Hue is constant end to end.** Every step is recognisably the same color. A wandering hue reads as two colors blended and will not sit correctly against a neutral built on a different hue.
- **Vividness peaks in the middle and falls off at both ends.** The lightest and darkest steps are nearly neutral; the middle carries the color. Holding full vividness into the extremes gives a `50` that glows and a `950` like ink spilled on the brand.
- **Steps are denser at the light end.** Light backgrounds need finer distinctions than dark ones. Keep `50` to `200` close together and `800` to `950` further apart. Even spacing across the whole range makes the pale end unusable, because `50` and `100` stop reading as two surfaces.
- **No two adjacent steps are indistinguishable.** If `200` and `300` look identical on a calibrated screen, the ramp has more steps than decisions. Drop one.
- **Both ends stop short of pure black and white.** A ramp that reaches them loses its identity exactly where the page background lives.

## Use a color library

Never compute these by hand or by eye. `culori`, `colorjs.io` and `chroma.js` all convert between notations, measure perceived lightness and interpolate perceptually. Read the brand color in whatever format it arrives, do the math in a perceptual space and emit the project's notation:

```js
import { formatHex, interpolate, samples } from 'culori'

// Perceptual interpolation, hex in and hex out.
const ramp = interpolate(['#eff6ff', '#3b82f6', '#172554'], 'lab')
const steps = samples(11).map((t) => formatHex(ramp(t)))
```

The output format is the project's choice. For a ramp the interpolation space is not, because the steps have to land evenly in perceived lightness and sRGB interpolation produces muddy mid-steps. Decorative gradients are the opposite case, where the space is a deliberate look ([color-usage.md](color-usage.md)).

```css
:root {
  --brand-50: #eff6ff;
  --brand-100: #dbeafe;
  --brand-200: #bfdbfe;
  --brand-300: #93c5fd;
  --brand-400: #60a5fa;
  --brand-500: #3b82f6;
  --brand-600: #2563eb;
  --brand-700: #1d4ed8;
  --brand-800: #1e40af;
  --brand-900: #1e3a8a;
  --brand-950: #172554;
}
```

## Several hues at once

With an accent plus status ramps, the ramps must agree step for step. `danger-500` and `brand-500` should read as equally bright and vivid, or a red button looks heavier than a blue one at the same step.

- **Match perceived lightness exactly.** Same step, same brightness, across every hue.
- **Match vividness relatively, not absolutely.** Hues do not share a maximum vividness. A saturated yellow and a saturated blue are not equally far from gray, and no format makes them so. Set each ramp to the same *proportion* of what its own hue reaches. Copying a saturation number across hues leaves one washed out.

Yellows and cyans are the usual casualties, peaking much lower than reds and blues. Copy the numbers across and the warning color looks weak beside the danger one.

## Dark mode

A dark palette is not the light one reversed. Reversal is the starting point, not the output.

Swap the semantic roles first, then tune the values:

```css
:root {
  --color-bg: var(--brand-50);
  --color-text: var(--brand-950);
}

.dark {
  --color-bg: var(--brand-950);
  --color-text: var(--brand-50);
}
```

Three things almost always need hand-tuning after the swap:

- **Vividness comes down.** A color that reads as confident on white reads as neon on near-black. Dark appearances need the accent a step or two less vivid.
- **The dark end needs more separation.** Steps distinguishable as pale backgrounds collapse into each other as dark surfaces.
- **Contrast does not survive the mirror.** A pair passing in light mode can fail reversed, because contrast is not symmetric. Recheck every foreground against its real background in both appearances ([contrast.md](contrast.md)).

### Choosing the switching mechanism

Pick one and use it throughout:

- **`prefers-color-scheme` alone** is correct with no theme toggle. Nothing to persist, nothing to hydrate.
- **A `.dark` class** is required as soon as users can override the system setting. The media query then sets only the initial value.
- **`light-dark()`** collapses both values into one declaration, the least code when the project also sets `color-scheme`. It reads that property rather than a class, so a class-based toggle must set `color-scheme` too.

```css
:root {
  color-scheme: light dark;
  --color-bg: light-dark(#ffffff, #172554);
}
```

Mixing mechanisms is the common failure. A media query setting some tokens and a class setting others gives a half-themed interface the moment a user overrides their system preference.
