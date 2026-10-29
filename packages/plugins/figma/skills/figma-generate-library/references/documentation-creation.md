> Part of the [figma-generate-library skill](../SKILL.md).

# Documentation Creation Reference

This reference covers Phase 2 of the design system build: the cover page, foundations documentation page (color swatches, type specimens, spacing bars, shadow cards, radius demo), page layout dimensions, and inline component documentation. Every code block is complete `use_figma`-ready JavaScript (helper-function form — meant to be embedded in a larger script that uses `return` to send results back).

> **Every text mutation in this file follows the [canonical text-edit recipe](../../figma-use/references/gotchas.md#canonical-text-edit-recipe-font-load--await--mutate--return-ids):** load font → `await` → mutate → return affected IDs. Examples use `Inter` because it's available everywhere, but `loadFontAsync` is required for every (family, style) pair you mutate — not just Inter.

> **Design files only.** Every snippet here (including `figma.createPage()`) targets Figma Design files (`figma.com/design/...`). `figma.createPage()` throws in both FigJam (`figma.com/board/...`) and Slides (`figma.com/slides/...`).

---

## 1. Cover Page

The cover page is always the first page in the file. It is a branded title card that sets context for anyone opening the file.

### What to include

- File/system name as a large heading (48–72px)
- Version string or date
- Brief tagline (1 sentence)
- Optional: color block background using the primary brand color variable

### Cover page dimensions

The cover frame should be **1440 × 900px** — this matches the default Figma canvas and looks correct in the page thumbnail.

### use_figma for cover page

```javascript
async function createCoverPage(systemName, tagline, version, primaryColorVar) {
  // primaryColorVar: a Figma Variable object for the brand primary fill
  const page = figma.createPage();
  page.name = 'Cover';
  await figma.setCurrentPageAsync(page);

  // Batch the font loads — sequential awaits would serialize three IPC
  // round-trips that can run in parallel.
  await Promise.all([
    figma.loadFontAsync({ family: 'Inter', style: 'Bold' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Medium' }),
  ]);

  const frame = figma.createAutoLayout('VERTICAL');
  frame.name = 'Cover';
  frame.resize(1440, 900);
  frame.layoutSizingHorizontal = 'FIXED';
  frame.layoutSizingVertical = 'FIXED';
  frame.x = 0;
  frame.y = 0;
  frame.primaryAxisAlignItems = 'CENTER';
  frame.counterAxisAlignItems = 'CENTER';
  frame.itemSpacing = 16;

  // Background: bind to primary variable if provided, else solid dark
  if (primaryColorVar) {
    const bgPaint = figma.variables.setBoundVariableForPaint(
      { type: 'SOLID', color: { r: 0.05, g: 0.05, b: 0.05 } },
      'color',
      primaryColorVar
    );
    frame.fills = [bgPaint];
  } else {
    frame.fills = [{ type: 'SOLID', color: { r: 0.06, g: 0.06, b: 0.07 } }];
  }
  page.appendChild(frame);

  // System name heading
  const title = figma.createText();
  title.fontName = { family: 'Inter', style: 'Bold' };
  title.characters = systemName;
  title.fontSize = 64;
  title.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  title.textAlignHorizontal = 'CENTER';
  frame.appendChild(title);

  // Tagline
  const tag = figma.createText();
  tag.fontName = { family: 'Inter', style: 'Regular' };
  tag.characters = tagline;
  tag.fontSize = 20;
  tag.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 0.7 } }];
  tag.textAlignHorizontal = 'CENTER';
  frame.appendChild(tag);

  // Version
  const ver = figma.createText();
  ver.fontName = { family: 'Inter', style: 'Medium' };
  ver.characters = version;
  ver.fontSize = 13;
  ver.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 0.45 } }];
  ver.textAlignHorizontal = 'CENTER';
  frame.appendChild(ver);

  return { page, frameId: frame.id };
}
```

---

## 2. Foundations Page

The Foundations page is always placed **before any component pages**. It visually documents the design tokens — colors, typography, spacing, shadows, and border radii — so designers and engineers can see available primitives at a glance.

### Page layout dimensions

The outer documentation frame should be **1440px wide**. Sections stack vertically with **64–100px gaps** between them. Each section frame fills the full 1440px width and hugs its content vertically.

### Full Foundations page skeleton

```javascript
async function createFoundationsPage() {
  const page = figma.createPage();
  page.name = 'Foundations';
  await figma.setCurrentPageAsync(page);

  // Batch the font loads — sequential awaits would serialize three IPC
  // round-trips that can run in parallel.
  await Promise.all([
    figma.loadFontAsync({ family: 'Inter', style: 'Bold' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Medium' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
  ]);

  // Root scroll frame
  const root = figma.createAutoLayout('VERTICAL');
  root.name = 'Foundations';
  root.primaryAxisAlignItems = 'MIN';
  root.counterAxisAlignItems = 'MIN';
  root.itemSpacing = 80;
  root.paddingTop = 80;
  root.paddingBottom = 120;
  root.paddingLeft = 80;
  root.paddingRight = 80;
  root.resize(1440, 1);
  root.layoutSizingHorizontal = 'FIXED';
  root.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  page.appendChild(root);

  return { page, root };
}
```

---

## 3. Color Swatches (bound to variables)

Color swatches must be **bound to actual Figma variables** — never hardcode hex values in swatch fills. This keeps documentation in sync automatically when variable values change.

### Single color swatch

```javascript
/**
 * Creates a single color swatch card (rectangle + variable name label).
 * The swatch rectangle fill is bound to the provided variable.
 *
 * @param {FrameNode} parent - The auto-layout row to append to.
 * @param {string} varName - Display name (e.g. "color/bg/primary").
 * @param {Variable} variable - The Figma Variable object to bind to.
 * @returns {FrameNode} The swatch frame.
 */
async function createColorSwatch(parent, varName, variable) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });

  const swatchFrame = figma.createAutoLayout('VERTICAL');
  swatchFrame.name = `Swatch/${varName}`;
  swatchFrame.primaryAxisAlignItems = 'MIN';
  swatchFrame.counterAxisAlignItems = 'MIN';
  swatchFrame.itemSpacing = 6;
  swatchFrame.resize(88, 1);
  swatchFrame.layoutSizingHorizontal = 'FIXED';
  swatchFrame.fills = [];

  // Color rectangle — bound to variable
  const rect = figma.createRectangle();
  rect.resize(88, 88);
  rect.cornerRadius = 8;
  const paint = figma.variables.setBoundVariableForPaint(
    { type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } },
    'color',
    variable
  );
  rect.fills = [paint];
  swatchFrame.appendChild(rect);

  // Name label
  const label = figma.createText();
  label.fontName = { family: 'Inter', style: 'Regular' };
  label.characters = varName.split('/').pop(); // show leaf name only
  label.fontSize = 10;
  label.fills = [{ type: 'SOLID', color: { r: 0.35, g: 0.35, b: 0.35 } }];
  swatchFrame.appendChild(label);
  label.layoutSizingHorizontal = 'FILL';

  // Full path tooltip label (smaller, lighter)
  const pathLabel = figma.createText();
  pathLabel.fontName = { family: 'Inter', style: 'Regular' };
  pathLabel.characters = varName;
  pathLabel.fontSize = 9;
  pathLabel.fills = [{ type: 'SOLID', color: { r: 0.6, g: 0.6, b: 0.6 } }];
  swatchFrame.appendChild(pathLabel);
  pathLabel.layoutSizingHorizontal = 'FILL';

  parent.appendChild(swatchFrame);
  return swatchFrame;
}
```

### Color section builder (primitives row + semantic grid)

```javascript
/**
 * Creates a complete color documentation section with a section heading,
 * a row of primitive swatches, and a grid of semantic swatches.
 *
 * @param {FrameNode} root - The root vertical stack frame.
 * @param {Variable[]} primitiveVars - Variables from the Primitives collection.
 * @param {Variable[]} semanticVars - Variables from the semantic Color collection.
 */
async function createColorSection(root, primitiveVars, semanticVars) {
  await Promise.all([
    figma.loadFontAsync({ family: 'Inter', style: 'Bold' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
  ]);

  // Section container
  const section = figma.createAutoLayout('VERTICAL');
  section.name = 'Section/Colors';
  section.itemSpacing = 24;
  section.fills = [];
  root.appendChild(section);
  section.layoutSizingHorizontal = 'FILL';

  // Section heading
  const heading = figma.createText();
  heading.fontName = { family: 'Inter', style: 'Bold' };
  heading.characters = 'Colors';
  heading.fontSize = 32;
  heading.fills = [{ type: 'SOLID', color: { r: 0.07, g: 0.07, b: 0.07 } }];
  section.appendChild(heading);

  // Description
  const desc = figma.createText();
  desc.fontName = { family: 'Inter', style: 'Regular' };
  desc.characters = 'Primitive color palette and semantic color tokens. Semantic tokens reference primitives — always use semantic tokens in components.';
  desc.fontSize = 14;
  desc.fills = [{ type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.4 } }];
  section.appendChild(desc);
  desc.layoutSizingHorizontal = 'FILL';

  // Primitive swatches row
  const primLabel = figma.createText();
  primLabel.fontName = { family: 'Inter', style: 'Bold' };
  primLabel.characters = 'Primitives';
  primLabel.fontSize = 13;
  primLabel.fills = [{ type: 'SOLID', color: { r: 0.55, g: 0.55, b: 0.55 } }];
  section.appendChild(primLabel);

  const primRow = figma.createAutoLayout();
  primRow.name = 'Primitives/Row';
  primRow.itemSpacing = 12;
  primRow.fills = [];
  primRow.layoutWrap = 'WRAP';
  section.appendChild(primRow);
  primRow.layoutSizingHorizontal = 'FILL';

  for (const v of primitiveVars) {
    await createColorSwatch(primRow, v.name, v);
  }

  // Semantic swatches grid
  if (semanticVars.length > 0) {
    const semLabel = figma.createText();
    semLabel.fontName = { family: 'Inter', style: 'Bold' };
    semLabel.characters = 'Semantic';
    semLabel.fontSize = 13;
    semLabel.fills = [{ type: 'SOLID', color: { r: 0.55, g: 0.55, b: 0.55 } }];
    section.appendChild(semLabel);

    const semRow = figma.createAutoLayout();
    semRow.name = 'Semantic/Row';
    semRow.itemSpacing = 12;
    semRow.fills = [];
    semRow.layoutWrap = 'WRAP';
    section.appendChild(semRow);
    semRow.layoutSizingHorizontal = 'FILL';

    for (const v of semanticVars) {
      await createColorSwatch(semRow, v.name, v);
    }
  }

  return section;
}
```

---

## 4. Type Specimens

Typography specimens show each text style rendered at its actual size with a sample string, the style name, and its specifications.

### Single type specimen row

```javascript
/**
 * Creates a single type specimen row: style name (small label) + sample text +
 * specification line (family · style · size · line-height).
 *
 * @param {FrameNode} parent - The parent vertical stack.
 * @param {string} styleName - The text style name (e.g. "Display Large").
 * @param {string} fontFamily - Font family (e.g. "Inter").
 * @param {string} fontStyle - Font style (e.g. "Bold").
 * @param {number} fontSize - Font size in pixels.
 * @param {number} lineHeight - Line height in pixels.
 * @returns {FrameNode} The specimen row frame.
 */
async function createTypeSpecimen(parent, styleName, fontFamily, fontStyle, fontSize, lineHeight) {
  await Promise.all([
    figma.loadFontAsync({ family: fontFamily, style: fontStyle }),
    figma.loadFontAsync({ family: 'Inter', style: 'Medium' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
  ]);

  const row = figma.createAutoLayout('VERTICAL');
  row.name = `Type/${styleName}`;
  row.itemSpacing = 6;
  row.paddingTop = 16;
  row.paddingBottom = 16;
  row.fills = [];
  parent.appendChild(row);
  row.layoutSizingHorizontal = 'FILL';

  // Style name label (small, muted)
  const nameText = figma.createText();
  nameText.fontName = { family: 'Inter', style: 'Medium' };
  nameText.characters = styleName;
  nameText.fontSize = 11;
  nameText.fills = [{ type: 'SOLID', color: { r: 0.55, g: 0.55, b: 0.55 } }];
  row.appendChild(nameText);
  nameText.layoutSizingHorizontal = 'FILL';

  // Sample text rendered in the actual style
  const specimen = figma.createText();
  specimen.fontName = { family: fontFamily, style: fontStyle };
  specimen.characters = 'The quick brown fox jumps over the lazy dog';
  specimen.fontSize = fontSize;
  specimen.lineHeight = { value: lineHeight, unit: 'PIXELS' };
  specimen.fills = [{ type: 'SOLID', color: { r: 0.07, g: 0.07, b: 0.07 } }];
  row.appendChild(specimen);
  specimen.layoutSizingHorizontal = 'FILL';

  // Specification line
  const specs = figma.createText();
  specs.fontName = { family: 'Inter', style: 'Regular' };
  specs.characters = `${fontFamily} ${fontStyle} · ${fontSize}px · ${lineHeight}px line height`;
  specs.fontSize = 11;
  specs.fills = [{ type: 'SOLID', color: { r: 0.65, g: 0.65, b: 0.65 } }];
  row.appendChild(specs);
  specs.layoutSizingHorizontal = 'FILL';

  // Divider line
  const divider = figma.createRectangle();
  divider.resize(1280, 1);
  divider.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }];
  row.appendChild(divider);
  divider.layoutSizingHorizontal = 'FILL';

  return row;
}
```

### Typography section builder

```javascript
/**
 * Creates a complete typography documentation section.
 * Pass an array of style definitions; the function renders one specimen per entry.
 *
 * @param {FrameNode} root - Root vertical stack.
 * @param {Array<{name, family, style, size, lineHeight}>} typeStyles - Style definitions.
 */
async function createTypographySection(root, typeStyles) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });

  const section = figma.createAutoLayout('VERTICAL');
  section.name = 'Section/Typography';
  section.itemSpacing = 0;
  section.fills = [];
  root.appendChild(section);
  section.layoutSizingHorizontal = 'FILL';

  const heading = figma.createText();
  heading.fontName = { family: 'Inter', style: 'Bold' };
  heading.characters = 'Typography';
  heading.fontSize = 32;
  heading.fills = [{ type: 'SOLID', color: { r: 0.07, g: 0.07, b: 0.07 } }];
  section.appendChild(heading);

  for (const ts of typeStyles) {
    await createTypeSpecimen(section, ts.name, ts.family, ts.style, ts.size, ts.lineHeight);
  }

  return section;
}
```

---

## 5. Spacing Bars

Spacing bars show each spacing token as a filled rectangle whose width equals the spacing value. Shorter bars for small values, longer bars for large values — the visual encoding is immediate.

### Spacing bar row

```javascript
/**
 * Creates a single spacing bar: a colored rectangle sized to the spacing value,
 * with a label showing name + pixel value + code syntax.
 *
 * @param {FrameNode} parent - Parent vertical stack.
 * @param {string} name - Token name (e.g. "spacing/sm").
 * @param {number} value - Spacing value in pixels.
 * @param {Variable} variable - Figma Variable to bind the width to.
 * @param {string} codeSyntax - CSS variable string (e.g. "var(--spacing-sm)").
 */
async function createSpacingBar(parent, name, value, variable, codeSyntax) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });

  const row = figma.createAutoLayout();
  row.name = `Spacing/${name}`;
  row.counterAxisAlignItems = 'CENTER';
  row.itemSpacing = 16;
  row.fills = [];
  parent.appendChild(row);
  row.layoutSizingHorizontal = 'FILL';

  // The bar rectangle — width bound to spacing variable
  const bar = figma.createRectangle();
  bar.resize(value, 16);
  bar.cornerRadius = 3;
  bar.fills = [{ type: 'SOLID', color: { r: 0.22, g: 0.47, b: 0.98 } }];
  // Bind width to the spacing variable so it reflects the actual token value
  if (variable) {
    bar.setBoundVariable('width', variable);
  }
  row.appendChild(bar);

  // Label: "spacing/sm  8px  var(--spacing-sm)"
  const label = figma.createText();
  label.fontName = { family: 'Inter', style: 'Regular' };
  label.characters = `${name}  ${value}px  ${codeSyntax}`;
  label.fontSize = 12;
  label.fills = [{ type: 'SOLID', color: { r: 0.35, g: 0.35, b: 0.35 } }];
  row.appendChild(label);

  return row;
}
```

### Spacing section builder

```javascript
/**
 * Creates the full spacing documentation section.
 *
 * @param {FrameNode} root - Root vertical stack.
 * @param {Array<{name, value, variable, codeSyntax}>} spacingTokens - Token definitions.
 */
async function createSpacingSection(root, spacingTokens) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });

  const section = figma.createAutoLayout('VERTICAL');
  section.name = 'Section/Spacing';
  section.itemSpacing = 12;
  section.fills = [];
  root.appendChild(section);
  section.layoutSizingHorizontal = 'FILL';

  const heading = figma.createText();
  heading.fontName = { family: 'Inter', style: 'Bold' };
  heading.characters = 'Spacing';
  heading.fontSize = 32;
  heading.fills = [{ type: 'SOLID', color: { r: 0.07, g: 0.07, b: 0.07 } }];
  section.appendChild(heading);

  for (const tok of spacingTokens) {
    await createSpacingBar(section, tok.name, tok.value, tok.variable, tok.codeSyntax);
  }

  return section;
}
```

---

## 6. Shadow Cards (Elevation)

Elevation documentation shows cards with progressively stronger drop shadows, labeled with name and effect parameters.

### Single shadow card

```javascript
/**
 * Creates a shadow card: a white rectangle with a drop shadow effect,
 * labeled with the elevation name and shadow parameters.
 *
 * @param {FrameNode} parent - The horizontal row to append to.
 * @param {string} name - Elevation name (e.g. "Shadow/Medium").
 * @param {DropShadowEffect[]} effects - Array of Figma effect objects.
 */
async function createShadowCard(parent, name, effects) {
  await Promise.all([
    figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Medium' }),
  ]);

  const card = figma.createAutoLayout('VERTICAL');
  card.name = `ShadowCard/${name}`;
  card.primaryAxisAlignItems = 'CENTER';
  card.counterAxisAlignItems = 'CENTER';
  card.itemSpacing = 8;
  card.paddingTop = 16;
  card.paddingBottom = 16;
  card.resize(120, 120);
  card.layoutSizingHorizontal = 'FIXED';
  card.layoutSizingVertical = 'FIXED';
  card.cornerRadius = 8;
  card.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  card.effects = effects;
  parent.appendChild(card);

  // Elevation name
  const nameLabel = figma.createText();
  nameLabel.fontName = { family: 'Inter', style: 'Medium' };
  nameLabel.characters = name.split('/').pop();
  nameLabel.fontSize = 12;
  nameLabel.textAlignHorizontal = 'CENTER';
  nameLabel.fills = [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.2 } }];
  card.appendChild(nameLabel);

  // Effect parameters as small text
  if (effects.length > 0) {
    const e = effects[0];
    if (e.type === 'DROP_SHADOW') {
      const params = figma.createText();
      params.fontName = { family: 'Inter', style: 'Regular' };
      params.characters = `x:${e.offset.x} y:${e.offset.y}\nblur:${e.radius}`;
      params.fontSize = 10;
      params.textAlignHorizontal = 'CENTER';
      params.fills = [{ type: 'SOLID', color: { r: 0.55, g: 0.55, b: 0.55 } }];
      card.appendChild(params);
    }
  }

  return card;
}
```

### Shadow section builder

```javascript
/**
 * Creates the full elevation/shadow documentation section.
 *
 * @param {FrameNode} root - Root vertical stack.
 * @param {Array<{name, effects}>} shadowTokens - Shadow definitions.
 */
async function createShadowSection(root, shadowTokens) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });

  const section = figma.createAutoLayout('VERTICAL');
  section.name = 'Section/Elevation';
  section.itemSpacing = 24;
  section.fills = [];
  root.appendChild(section);
  section.layoutSizingHorizontal = 'FILL';

  const heading = figma.createText();
  heading.fontName = { family: 'Inter', style: 'Bold' };
  heading.characters = 'Elevation';
  heading.fontSize = 32;
  heading.fills = [{ type: 'SOLID', color: { r: 0.07, g: 0.07, b: 0.07 } }];
  section.appendChild(heading);

  // Cards row — extra top padding so shadows are visible
  const row = figma.createAutoLayout();
  row.name = 'Elevation/Row';
  row.itemSpacing = 32;
  row.paddingTop = 24;
  row.paddingBottom = 40;
  row.paddingLeft = 24;
  row.paddingRight = 24;
  row.fills = [{ type: 'SOLID', color: { r: 0.97, g: 0.97, b: 0.97 } }];
  row.cornerRadius = 8;
  section.appendChild(row);
  row.layoutSizingHorizontal = 'FILL';

  for (const tok of shadowTokens) {
    await createShadowCard(row, tok.name, tok.effects);
  }

  return section;
}
```

---

## 7. Border Radius Demo

Border radius documentation shows rectangles at each corner radius value, labeled with the token name and pixel value.

### Single radius card

```javascript
/**
 * Creates a single border radius card: a square with corner radius applied,
 * labeled with the token name and pixel value.
 *
 * @param {FrameNode} parent - The horizontal row to append to.
 * @param {string} name - Token name (e.g. "radius/md").
 * @param {number} value - Corner radius in pixels (0 for none, 9999 for full).
 * @param {Variable} [variable] - Optional Figma Variable to bind corner radius.
 */
async function createRadiusCard(parent, name, value, variable) {
  await Promise.all([
    figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Medium' }),
  ]);

  const wrapper = figma.createAutoLayout('VERTICAL');
  wrapper.name = `Radius/${name}`;
  wrapper.primaryAxisAlignItems = 'CENTER';
  wrapper.counterAxisAlignItems = 'CENTER';
  wrapper.itemSpacing = 8;
  wrapper.fills = [];
  wrapper.resize(96, 1);
  wrapper.layoutSizingHorizontal = 'FIXED';
  parent.appendChild(wrapper);

  const rect = figma.createRectangle();
  rect.resize(72, 72);
  rect.fills = [{ type: 'SOLID', color: { r: 0.22, g: 0.47, b: 0.98, a: 0.15 } }];
  rect.strokes = [{ type: 'SOLID', color: { r: 0.22, g: 0.47, b: 0.98 } }];
  rect.strokeWeight = 1.5;

  // Cap display value — 9999 is how Figma represents "full/pill"
  const displayRadius = Math.min(value, 36);
  rect.cornerRadius = displayRadius;

  // Bind to variable if provided
  if (variable) {
    rect.setBoundVariable('cornerRadius', variable);
  }
  wrapper.appendChild(rect);

  const nameLabel = figma.createText();
  nameLabel.fontName = { family: 'Inter', style: 'Medium' };
  nameLabel.characters = name.split('/').pop();
  nameLabel.fontSize = 11;
  nameLabel.textAlignHorizontal = 'CENTER';
  nameLabel.fills = [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.2 } }];
  wrapper.appendChild(nameLabel);

  const valueLabel = figma.createText();
  valueLabel.fontName = { family: 'Inter', style: 'Regular' };
  valueLabel.characters = value >= 9999 ? 'full' : `${value}px`;
  valueLabel.fontSize = 10;
  valueLabel.textAlignHorizontal = 'CENTER';
  valueLabel.fills = [{ type: 'SOLID', color: { r: 0.55, g: 0.55, b: 0.55 } }];
  wrapper.appendChild(valueLabel);

  return wrapper;
}
```

### Radius section builder

```javascript
/**
 * Creates the full border radius documentation section.
 *
 * @param {FrameNode} root - Root vertical stack.
 * @param {Array<{name, value, variable}>} radiusTokens - Radius token definitions.
 */
async function createRadiusSection(root, radiusTokens) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });

  const section = figma.createAutoLayout('VERTICAL');
  section.name = 'Section/Radius';
  section.itemSpacing = 24;
  section.fills = [];
  root.appendChild(section);
  section.layoutSizingHorizontal = 'FILL';

  const heading = figma.createText();
  heading.fontName = { family: 'Inter', style: 'Bold' };
  heading.characters = 'Border Radius';
  heading.fontSize = 32;
  heading.fills = [{ type: 'SOLID', color: { r: 0.07, g: 0.07, b: 0.07 } }];
  section.appendChild(heading);

  const row = figma.createAutoLayout();
  row.name = 'Radius/Row';
  row.itemSpacing = 24;
  row.paddingTop = 24;
  row.paddingBottom = 24;
  row.paddingLeft = 24;
  row.paddingRight = 24;
  row.fills = [{ type: 'SOLID', color: { r: 0.97, g: 0.97, b: 0.97 } }];
  row.cornerRadius = 8;
  section.appendChild(row);
  row.layoutSizingHorizontal = 'FILL';

  for (const tok of radiusTokens) {
    await createRadiusCard(row, tok.name, tok.value, tok.variable);
  }

  return section;
}
```

---

## 8. Documentation Alongside Components

Each component page should include a documentation frame directly on the canvas, placed to the left of the component set. This keeps docs and the component in sync without requiring a separate file.

### Component page documentation frame

```javascript
/**
 * Creates the documentation frame for a component page: title, description,
 * and usage notes, positioned at x=0 with the component set to its right.
 *
 * @param {PageNode} page - The component page (must already be current).
 * @param {string} componentName - The component name.
 * @param {string} description - What the component does and when to use it.
 * @param {string[]} usageNotes - Bullet points for usage guidance.
 * @returns {FrameNode} The documentation frame.
 */
async function createComponentDocFrame(page, componentName, description, usageNotes) {
  await Promise.all([
    figma.loadFontAsync({ family: 'Inter', style: 'Bold' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
  ]);

  const doc = figma.createAutoLayout('VERTICAL');
  doc.name = '_Doc';
  doc.itemSpacing = 16;
  doc.paddingTop = 40;
  doc.paddingBottom = 40;
  doc.paddingLeft = 40;
  doc.paddingRight = 40;
  doc.resize(360, 1);
  doc.layoutSizingHorizontal = 'FIXED';
  doc.fills = [];
  doc.x = 0;
  doc.y = 0;
  page.appendChild(doc);

  // Component name — large heading
  const title = figma.createText();
  title.fontName = { family: 'Inter', style: 'Bold' };
  title.characters = componentName;
  title.fontSize = 28;
  title.fills = [{ type: 'SOLID', color: { r: 0.07, g: 0.07, b: 0.07 } }];
  doc.appendChild(title);
  title.layoutSizingHorizontal = 'FILL';

  // Description
  const descText = figma.createText();
  descText.fontName = { family: 'Inter', style: 'Regular' };
  descText.characters = description;
  descText.fontSize = 13;
  descText.lineHeight = { value: 20, unit: 'PIXELS' };
  descText.fills = [{ type: 'SOLID', color: { r: 0.35, g: 0.35, b: 0.35 } }];
  doc.appendChild(descText);
  descText.layoutSizingHorizontal = 'FILL';

  // Divider
  const divider = figma.createRectangle();
  divider.resize(280, 1);
  divider.fills = [{ type: 'SOLID', color: { r: 0.88, g: 0.88, b: 0.88 } }];
  doc.appendChild(divider);
  divider.layoutSizingHorizontal = 'FILL';

  // Usage notes
  if (usageNotes.length > 0) {
    const usageHeading = figma.createText();
    usageHeading.fontName = { family: 'Inter', style: 'Bold' };
    usageHeading.characters = 'Usage';
    usageHeading.fontSize = 13;
    usageHeading.fills = [{ type: 'SOLID', color: { r: 0.07, g: 0.07, b: 0.07 } }];
    doc.appendChild(usageHeading);

    for (const note of usageNotes) {
      const noteText = figma.createText();
      noteText.fontName = { family: 'Inter', style: 'Regular' };
      noteText.characters = `• ${note}`;
      noteText.fontSize = 12;
      noteText.lineHeight = { value: 18, unit: 'PIXELS' };
      noteText.fills = [{ type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.4 } }];
      doc.appendChild(noteText);
      noteText.layoutSizingHorizontal = 'FILL';
    }
  }

  return doc;
}
```

---

## 9. Critical Rules

1. **Bind swatches to variables** — use `setBoundVariableForPaint` for color fills, `setBoundVariable('width', ...)` for spacing bars, and `setBoundVariable('cornerRadius', ...)` for radius cards. Never hardcode values that have corresponding variables.
2. **Foundations page comes before component pages** — always insert it between the file structure separators and the first component page.
3. **Show both primitive and semantic layers** — if the system has a Primitives collection and a semantic Color collection, document both on the Foundations page with clear section labels.
4. **Page frame width = 1440px** — this is the convention across Simple DS, Polaris, and Material 3. Use it unless you detect a different existing convention via `get_metadata`.
5. **Section spacing = 64–80px** — the gap between color / typography / spacing / shadow / radius sections should be at minimum 64px so the page is scannable.
6. **Match existing page style** — if the target file uses emoji page name prefixes or a decorative separator style, carry that through to the Foundations page name.
7. **Include code syntax in labels** — where variables have code syntax set, display the CSS variable name in the swatch/bar label so developers can copy it directly.
