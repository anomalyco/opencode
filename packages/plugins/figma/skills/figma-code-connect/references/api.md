# Code Connect Template API Reference

## Overview

Code Connect uses template files (`.figma.js`) to connect your code components to Figma designs. This API reference covers the complete template system for creating these mappings.

## Quick Start

A minimal Code Connect template:

```javascript
// url=https://www.figma.com/file/abc123/MyFile?node-id=123-456
// source=src/components/Button.tsx
// component=Button
const figma = require('figma')
const instance = figma.selectedInstance

const label = instance.getString('Label')

export default {
  example: figma.code`<Button label="${label}" />`,
  imports: ['import { Button } from "./Button"'],
  id: 'button'
}
```

## Table of Contents

1. [Project Configuration](#project-configuration)
2. [Template File Structure](#template-file-structure)
3. [Core API Reference](#core-api-reference)
4. [Working with Properties](#working-with-properties)
5. [Working with Nested Components](#working-with-nested-components)
6. [Publishing and Management](#publishing-and-management)
7. [Type Reference](#type-reference)

---

## Project Configuration

### `figma.config.json`

Place this file in your project root to configure Code Connect.

#### Required Configuration

```json
{
  "codeConnect": {
    "include": ["**/*.figma.js"],
    "label": "React",
    "language": "tsx"
  }
}
```

#### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `include` | `string[]` | Globs for where to find Code Connect files (relative to config file) |
| `exclude` | `string[]` | Globs for files to exclude (e.g., `["test/**", "build/**"]`) |
| `label` | `string` | Label shown in Figma Dev Mode for your snippets |
| `language` | `string` | Language for syntax highlighting (see supported languages below) |
| `documentUrlSubstitutions` | `object` | URL substitutions for multiple Figma files |

#### Supported Languages

`jsx`, `tsx`, `typescript`, `javascript`, `swift`, `kotlin`, `html`, `css`, `json`, `python`, `go`, `rust`, `bash`, `xml`, `dart`, `ruby`, `cpp`, `sql`, `graphql`, `plaintext`

#### URL Substitutions Example

```json
{
  "codeConnect": {
    "documentUrlSubstitutions": {
      "<PROD_FILE>": "https://figma.com/design/abc123/Production",
      "<TEST_FILE>": "https://figma.com/design/xyz789/Testing"
    }
  }
}
```

Use placeholders in templates:
```javascript
// url=<PROD_FILE>?node-id=123-456
// source=<path to code component>
// component=<component name>
```

---

## Template File Structure

### File Naming

Templates must use the `.figma.js` extension:
- `Button.figma.js`
- `Card.figma.js`
- `MyComponent.figma.js`

### Required Metadata Comments

Every template starts with metadata comments:

```javascript
// url=https://www.figma.com/file/abc123/MyFile?node-id=123-456
// source=src/components/Button.tsx
// component=Button
```

**Getting the URL:** In Figma, right-click component → "Copy link to selection"

### Export Structure

```typescript
export default {
  example: ResultSection[],      // Required: The code snippet
  id: string,                    // Required: Unique identifier
  imports?: string[],            // Optional: Import statements
  metadata?: {                   // Optional: Display settings
    nestable?: boolean,          // Show inline (true) or as pill (false)
    props?: Record<string, any>  // Data for parent templates
  }
}
```

### Complete Example

```javascript
// url=https://www.figma.com/file/abc123/MyFile?node-id=123-456
// source=src/Button.tsx
// component=Button

const figma = require('figma')
const instance = figma.selectedInstance

// Extract properties from Figma
const label = instance.getString('Label')
const variant = instance.getEnum('Variant', {
  Primary: 'primary',
  Secondary: 'secondary'
})
const disabled = instance.getBoolean('Disabled')
const icon = instance.findInstance('Icon')

export default {
  example: figma.code`
    <Button
      variant="${variant}"
      ${disabled ? 'disabled' : ''}
      ${icon ? figma.code`icon={${icon.executeTemplate().example}}` : ''}
    >
      ${label}
    </Button>
  `,
  imports: ['import { Button } from "./Button"'],
  id: 'button',
  metadata: {
    nestable: true
  }
}
```

---

## Core API Reference

### `figma` Object

Import with: `const figma = require('figma')`

#### `figma.selectedInstance: InstanceHandle`

The currently selected Figma component instance. This is your main entry point for accessing component data.

#### Tagged Template Literals

Use these to wrap your code snippets for proper syntax highlighting:

| Template | Use For |
|----------|---------|
| `figma.code` | Generic code (fallback) |
| `figma.tsx` | React/TypeScript JSX |
| `figma.jsx` | React JavaScript |
| `figma.html` | HTML markup |
| `figma.swift` | Swift code |
| `figma.kotlin` | Kotlin code |

**Example:**
```javascript
const example = figma.tsx`<MyComponent prop="${value}" />`
```

**Important:** Never use string concatenation on template results. Always wrap in `figma.code`:

```javascript
// Wrong
const snippet = iconSnippet + buttonSnippet

// Correct
const snippet = figma.code`${iconSnippet}${buttonSnippet}`
```

#### `figma.helpers`

Helper utilities for rendering code patterns:

**React Helpers:**
```javascript
figma.helpers.react.renderProp('propName', value)
figma.helpers.react.renderChildren(children)
figma.helpers.react.jsxElement('<Icon />')
```

#### `figma.properties`

Access child components by type:

```javascript
const buttons = figma.properties.children(['Button'])
const icons = figma.properties.children(['Icon', 'Avatar'])
```

---

## Working with Properties

### Reading Component Properties

#### `getString(propName: string): string`

Gets a text property value from the Figma component.

```javascript
const label = instance.getString('Label')
const placeholder = instance.getString('Placeholder Text')
```

#### `getBoolean(propName: string, mapping?: object): boolean | any`

Gets a boolean property with optional value mapping.

```javascript
// Simple boolean
const isDisabled = instance.getBoolean('Disabled')

// Map to custom values
const hasIcon = instance.getBoolean('Has Icon', {
  true: figma.code`<Icon />`,
  false: null
})
```

#### `getEnum(propName: string, mapping: object): any`

Maps Figma variant values to code values.

```javascript
const size = instance.getEnum('Size', {
  Small: 'sm',
  Medium: 'md',
  Large: 'lg'
})

const variant = instance.getEnum('Variant', {
  Primary: 'primary',
  Secondary: 'secondary',
  Tertiary: 'tertiary'
})
```

#### `getInstanceSwap(propName: string): InstanceHandle`

Gets a swapped instance from an instance swap property.

```javascript
const icon = instance.getInstanceSwap('Icon')
if (icon) {
  const iconCode = icon.executeTemplate().example
}
```

#### `getSlot(propName: string): ResultSection[] | undefined`

Reads a Figma component property whose type is **`SLOT`** (not **INSTANCE_SWAP**). Returns a `ResultSection[]` containing a slot section (`type: 'SLOT'`). Returns `undefined` if the property is missing or invalid. Do not call `executeTemplate()` on this value — unlike `getInstanceSwap()`, it is not an `InstanceHandle`.

```javascript
const content = instance.getSlot('Content')

export default {
  example: figma.code`<Card>${content}</Card>`
}
```

#### `getPropertyValue(propName: string): string | boolean`

Gets the raw property value without mapping.

```javascript
const rawValue = instance.getPropertyValue('Some Property')
```

### Property Patterns

#### Conditional Properties

```javascript
const showIcon = instance.getBoolean('Has Icon')
const icon = showIcon ? instance.findInstance('Icon') : null

export default {
  example: figma.code`
    <Button ${icon ? figma.code`icon={${icon.executeTemplate().example}}` : ''}>
      Click me
    </Button>
  `
}
```

#### Combining Properties

```javascript
const variant = instance.getEnum('Variant', { Primary: 'primary', Secondary: 'secondary' })
const size = instance.getEnum('Size', { Small: 'sm', Large: 'lg' })
const disabled = instance.getBoolean('Disabled')

export default {
  example: figma.code`
    <Button
      variant="${variant}"
      size="${size}"
      ${disabled ? 'disabled' : ''}
    />
  `
}
```

---

## Working with Nested Components

### Finding Child Layers

#### `findInstance(layerName: string, opts?: SelectorOptions): InstanceHandle | ErrorHandle`

Finds a child component instance by layer name.

```javascript
const icon = instance.findInstance('Icon')
const avatar = instance.findInstance('Avatar')
```

**With selector options:**
```javascript
// Find by exact path
const icon = instance.findInstance('Icon', {
  path: ['Header', 'IconSlot']
})

// Search through nested instances
const deepIcon = instance.findInstance('Icon', {
  traverseInstances: true
})
```

#### `findText(layerName: string, opts?: SelectorOptions): TextHandle | ErrorHandle`

Finds a text layer by name.

```javascript
const heading = instance.findText('Heading')
const body = instance.findText('Body Text')

// Access text content
const headingText = heading.textContent
```

#### `findConnectedInstance(codeConnectId: string, opts?: SelectorOptions): InstanceHandle | ErrorHandle`

Finds a child by its Code Connect ID.

> **Note:** Returns `ErrorHandle` (not `null`) when no match is found. Check `result.type === 'INSTANCE'` before calling `hasCodeConnect()`.

```javascript
// Find component with specific Code Connect ID
const button = instance.findConnectedInstance('primary-button')
```

#### `findConnectedInstances(selector: (node: InstanceHandle) => boolean, opts?: SelectorOptions): InstanceHandle[]`

Finds all child instances matching a selector function.

```javascript
// Find all buttons
const buttons = instance.findConnectedInstances(node => {
  return node.codeConnectId() === 'button'
})

// Find all instances with certain property
const primaryButtons = instance.findConnectedInstances(node => {
  return node.getPropertyValue('Variant') === 'Primary'
})
```

#### `findLayers(selector: (node: InstanceHandle | TextHandle) => boolean, opts?: SelectorOptions): (InstanceHandle | TextHandle)[]`

Finds all layers (instances and text) matching a selector.

```javascript
// Find all layers with specific names
const layers = instance.findLayers(node => {
  return node.name === 'Icon' || node.name === 'Label'
})
```

### Executing Nested Templates

#### `executeTemplate(): { example: ResultSection[], metadata: Metadata }`

Renders a nested instance and returns its code and metadata.

```javascript
const icon = instance.findInstance('Icon')

if (icon && icon.type === 'INSTANCE' && icon.hasCodeConnect()) {
  const result = icon.executeTemplate()
  const iconCode = result.example
  const iconProps = result.metadata.props
}
```

### Instance Information

#### `hasCodeConnect(): boolean`

Checks if an instance has Code Connect configured.

```javascript
const icon = instance.findInstance('Icon')

if (icon && icon.type === 'INSTANCE' && icon.hasCodeConnect()) {
  const iconCode = icon.executeTemplate().example
} else {
  // Fallback when no Code Connect
  const iconCode = figma.code`<Icon />`
}
```

#### `codeConnectId(): string | null`

Returns the Code Connect ID of the instance.

```javascript
const id = instance.codeConnectId()
// Returns the 'id' from the template's export
```

### Nested Component Patterns

#### Simple Nested Component

```javascript
const figma = require('figma')
const instance = figma.selectedInstance

const label = instance.getString('Label')
const icon = instance.findInstance('Icon')

export default {
  example: figma.code`
    <Button
      label="${label}"
      ${icon ? figma.code`icon={${icon.executeTemplate().example}}` : ''}
    />
  `,
  id: 'button-with-icon'
}
```

#### Multiple Nested Components

```javascript
const buttons = instance.findConnectedInstances(node => {
  return node.codeConnectId() === 'button'
})

const buttonElements = buttons.map(btn => btn.executeTemplate().example)

export default {
  example: figma.code`
    <ButtonGroup>
      ${buttonElements.join('\n')}
    </ButtonGroup>
  `
}
```

#### Nested with Metadata

```javascript
// Child component
export default {
  example: figma.code`<Icon name="${name}" />`,
  id: 'icon',
  metadata: {
    nestable: true,
    props: { iconName: name }
  }
}

// Parent component
const icon = instance.findConnectedInstance('icon')
if (icon) {
  const result = icon.executeTemplate()
  const iconName = result.metadata.props.iconName
  // Use iconName in parent logic
}
```

#### Children Pattern

```javascript
const children = figma.properties.children(['Card', 'Button'])

export default {
  example: figma.code`
    <Container>
      ${children.map(child => child.executeTemplate().example).join('\n')}
    </Container>
  `,
  id: 'container'
}
```

---

## Publishing and Management

### Installation

```bash
npm install --global @figma/code-connect@latest
```

### Publishing Code Connect Files

Publish all templates to make them visible in Figma Dev Mode:

```bash
npx figma connect publish --token=YOUR_ACCESS_TOKEN
```

**Using environment variable:**
```bash
export FIGMA_ACCESS_TOKEN=your_token_here
npx figma connect publish
```

**With custom config:**
```bash
npx figma connect publish --config path/to/figma.config.json
```

### Unpublishing

**Unpublish all files in config:**
```bash
npx figma connect unpublish
```

**Unpublish specific component:**
```bash
npx figma connect unpublish --node=https://figma.com/file/abc/File?node-id=123-456 --label=React
```

### Migration from Old Format

Convert existing Code Connect files to template format:

```bash
npx figma connect migrate --outDir ./templates
```

**Test migrations:**
1. Set temporary label in `figma.config.json`
2. Publish to test: `npx figma connect publish`
3. Verify in Figma
4. Unpublish when done: `npx figma connect unpublish`

### CLI Help

```bash
npx figma connect --help
npx figma connect publish --help
npx figma connect unpublish --help
```

---

## Type Reference

### SelectorOptions

```typescript
interface SelectorOptions {
  /** Full path of parent layer names to match */
  path?: string[]

  /** Whether to search inside nested component instances */
  traverseInstances?: boolean
}
```

**Example:**
```javascript
// Find icon only in specific hierarchy
const icon = instance.findInstance('Icon', {
  path: ['Header', 'Actions', 'IconSlot']
})

// Search everywhere including nested instances
const anyIcon = instance.findInstance('Icon', {
  traverseInstances: true
})
```

### Metadata

```typescript
interface Metadata {
  /**
   * Controls display in Code Connect panel:
   * - true: Shows code inline with parent
   * - false: Shows as expandable pill
   */
  nestable?: boolean

  /** Custom data accessible to parent templates */
  props?: Record<string, any>
}
```

> **Important:** `nestable` must be set in **two places** for nested templates to work correctly:
> 1. **`templateDataJson`** when calling `add_code_connect_map` — e.g. `'{"isParserless": true, "nestable": true}'`. This controls whether the child template is loaded into the parent's evaluation context. If missing, the parent cannot find or execute the child via `findConnectedInstance`, `findConnectedInstances`, or `hasCodeConnect()`.
> 2. **`metadata.nestable`** in the template's `export default` — controls the runtime rendering behavior (inline code vs. clickable pill).

### ResultSection Types

```typescript
type CodeSection = {
  type: "CODE"
  code: string
}

type InstanceSection = {
  type: "INSTANCE"
  guid: string      // Instance layer ID
  symbolId: string  // Component ID
}

type ErrorSection = {
  type: "ERROR"
  message: string
  errorObject?: ResultError
}

type ResultSection = CodeSection | InstanceSection | ErrorSection
```

### Template Result

```typescript
type SectionsResult = {
  result: "SUCCESS"
  data: {
    type: "SECTIONS"
    sections: ResultSection[]
    language: string
    metadata?: {
      __props: Record<string, any>
      [key: string]: any
    }
  }
}
```

### Error Types

```typescript
type PropertyNotFoundError = {
  type: "PROPERTY_NOT_FOUND"
  propertyName: string
}

type ChildLayerNotFoundError = {
  type: "CHILD_LAYER_NOT_FOUND"
  layerName: string
}

type PropertyTypeMismatchError = {
  type: "PROPERTY_TYPE_MISMATCH"
  propertyName: string
  expectedType: string
}

type TemplateExecutionError = {
  type: "TEMPLATE_EXECUTION_ERROR"
}

type ResultError =
  | PropertyNotFoundError
  | PropertyTypeMismatchError
  | ChildLayerNotFoundError
  | TemplateExecutionError
```

---

## Complete Examples

### Button with States

```javascript
// url=https://www.figma.com/file/abc/Components?node-id=1-2
// source=src/components/Button.tsx
// component=Button

const figma = require('figma')
const instance = figma.selectedInstance

const label = instance.getString('Label')
const variant = instance.getEnum('Variant', {
  Primary: 'primary',
  Secondary: 'secondary',
  Tertiary: 'tertiary'
})
const size = instance.getEnum('Size', {
  Small: 'sm',
  Medium: 'md',
  Large: 'lg'
})
const disabled = instance.getBoolean('Has Disabled State')
const hasIcon = instance.getBoolean('Has Icon')
const icon = hasIcon ? instance.getInstanceSwap('Icon') : null

export default {
  example: figma.tsx`
    <Button
      variant="${variant}"
      size="${size}"
      ${disabled ? 'disabled' : ''}
      ${icon ? figma.tsx`icon={${icon.executeTemplate().example}}` : ''}
    >
      ${label}
    </Button>
  `,
  imports: ['import { Button } from "@/components/Button"'],
  id: 'button',
  metadata: {
    nestable: true
  }
}
```

### Card with Children

```javascript
// url=https://www.figma.com/file/abc/Components?node-id=10-20
// source=src/components/Card.tsx
// component=Card

const figma = require('figma')
const instance = figma.selectedInstance

const heading = instance.findText('Heading')
const body = instance.findText('Body')
const actions = figma.properties.children(['Button'])
const variant = instance.getEnum('Variant', {
  Elevated: 'elevated',
  Outlined: 'outlined',
  Filled: 'filled'
})

export default {
  example: figma.tsx`
    <Card variant="${variant}">
      <Card.Header>
        ${heading.textContent}
      </Card.Header>
      <Card.Body>
        ${body.textContent}
      </Card.Body>
      <Card.Actions>
        ${actions.map(action => action.executeTemplate().example).join('\n')}
      </Card.Actions>
    </Card>
  `,
  imports: ['import { Card } from "@/components/Card"'],
  id: 'card',
  metadata: {
    nestable: false
  }
}
```

### Form Field with Validation

```javascript
// url=https://www.figma.com/file/abc/Components?node-id=30-40
// source=src/components/TextField.tsx
// component=TextField

const figma = require('figma')
const instance = figma.selectedInstance

const label = instance.getString('Label')
const placeholder = instance.getString('Placeholder')
const helperText = instance.findText('Helper Text')
const errorState = instance.getEnum('State', {
  Default: false,
  Error: true
})
const required = instance.getBoolean('Required')
const disabled = instance.getBoolean('Disabled')

export default {
  example: figma.tsx`
    <TextField
      label="${label}"
      placeholder="${placeholder}"
      ${helperText ? `helperText="${helperText.textContent}"` : ''}
      ${errorState ? 'error' : ''}
      ${required ? 'required' : ''}
      ${disabled ? 'disabled' : ''}
    />
  `,
  imports: ['import { TextField } from "@/components/TextField"'],
  id: 'text-field'
}
```

### Navigation with Dynamic Items

```javascript
// url=https://www.figma.com/file/abc/Components?node-id=50-60
// source=src/components/Navigation.tsx
// component=Navigation

const figma = require('figma')
const instance = figma.selectedInstance

const items = instance.findConnectedInstances(node => {
  return node.codeConnectId() === 'nav-item'
})

const direction = instance.getEnum('Direction', {
  Horizontal: 'horizontal',
  Vertical: 'vertical'
})

export default {
  example: figma.tsx`
    <Navigation direction="${direction}">
      ${items.map(item => item.executeTemplate().example).join('\n')}
    </Navigation>
  `,
  imports: ['import { Navigation } from "@/components/Navigation"'],
  id: 'navigation',
  metadata: {
    nestable: false
  }
}
```

---

## Best Practices

### 1. Use Descriptive IDs

```javascript
// Good - clear and descriptive
export default {
  id: 'primary-button',
  // ...
}

// Avoid - too generic
export default {
  id: 'btn',
  // ...
}
```

### 2. Handle Missing Properties Gracefully

```javascript
// Good - check type before calling hasCodeConnect
const icon = instance.findInstance('Icon')
const iconCode = icon && icon.type === 'INSTANCE' && icon.hasCodeConnect()
  ? icon.executeTemplate().example
  : null

// Avoid - assumes icon exists
const iconCode = instance.findInstance('Icon').executeTemplate().example
```

### 3. Use Appropriate Tagged Templates

```javascript
// Good - use specific template for language
const example = figma.tsx`<Button />`

// Avoid - generic when specific is available
const example = figma.code`<Button />`
```

### 4. Keep Templates Focused

```javascript
// Good - one component per file
export default {
  example: figma.tsx`<Button {...props} />`,
  id: 'button'
}

// Avoid - multiple components in one template
export default {
  example: figma.tsx`
    <Button />
    <Input />
    <Select />
  `
}
```

### 5. Use Metadata Appropriately

```javascript
// Good - small inline components
export default {
  id: 'icon',
  metadata: { nestable: true }
}
// Also set in templateDataJson when registering: {"isParserless": true, "nestable": true}

// Good - complex components as pills
export default {
  id: 'modal',
  metadata: { nestable: false }
}
```

**Note:** If using `add_code_connect_map`, `nestable` must also be set in `templateDataJson` for the child to be discoverable by parent templates. Setting `metadata: { nestable: true }` in the template alone is not sufficient — the stored `templateData.nestable` controls whether the child is loaded into `instanceTemplates`.

---

## Troubleshooting

### Property Not Found

**Error:** `Property "Label" not found`

**Solution:** Check property name in Figma matches exactly (case-sensitive):
```javascript
// Property name in Figma: "Button Label"
const label = instance.getString('Button Label')
```

### Layer Not Found

**Error:** `Child layer "Icon" not found`

**Solution:** Verify layer name and try with path:
```javascript
const icon = instance.findInstance('Icon', {
  path: ['Content', 'IconSlot'],
  traverseInstances: true
})
```

### Type Mismatch

**Error:** `Property type mismatch`

**Solution:** Use correct method for property type:
- Text properties → `getString()`
- Boolean properties → `getBoolean()`
- Variant properties → `getEnum()`
- Instance swap → `getInstanceSwap()`

### Template Not Rendering

**Issue:** Template doesn't appear in Figma

**Solution:**
1. Ensure URL comment matches component exactly
2. Check `figma.config.json` includes the file pattern
3. Verify file was published: `npx figma connect publish`
4. Check Figma file permissions

### Invalid Code Sections

**Issue:** Code appears broken in Figma

**Solution:** Never concatenate template results:
```javascript
// Wrong
const result = snippet1 + snippet2

// Correct
const result = figma.code`${snippet1}${snippet2}`
```
