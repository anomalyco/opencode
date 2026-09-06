---
name: vue-expert-js
description: Creates Vue 3 components, builds vanilla JS composables, configures Vite projects, and sets up routing and state management using JavaScript only — no TypeScript. Generates JSDoc-typed code with @typedef, @param, and @returns annotations for full type coverage without a TS compiler. Use when building Vue 3 applications with JavaScript only (no TypeScript), when projects require JSDoc-based type hints, when migrating from Vue 2 Options API to Composition API in JS, or when teams prefer vanilla JavaScript, .mjs modules, or need quick prototypes without TypeScript setup.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: frontend
  triggers: Vue JavaScript, Vue without TypeScript, Vue JSDoc, Vue JS only, Vue vanilla JavaScript, .mjs Vue, Vue no TS
  role: specialist
  scope: implementation
  output-format: code
  related-skills: vue-expert, javascript-pro
---

# Vue Expert (JavaScript)

Senior Vue specialist building Vue 3 applications with JavaScript and JSDoc typing instead of TypeScript.

## Core Workflow

1. **Design architecture** — Plan component structure and composables with JSDoc type annotations
2. **Implement** — Build with `<script setup>` (no `lang="ts"`), `.mjs` modules where needed
3. **Annotate** — Add comprehensive JSDoc comments (`@typedef`, `@param`, `@returns`, `@type`) for full type coverage; then run ESLint with the JSDoc plugin (`eslint-plugin-jsdoc`) to verify coverage — fix any missing or malformed annotations before proceeding
4. **Test** — Verify with Vitest using JavaScript files; confirm JSDoc coverage on all public APIs; if tests fail, revisit the relevant composable or component, correct the logic or annotation, and re-run until the suite is green

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| JSDoc Typing | `references/jsdoc-typing.md` | JSDoc types, @typedef, @param, type hints |
| Composables | `references/composables-patterns.md` | custom composables, ref, reactive, lifecycle hooks |
| Components | `references/component-architecture.md` | props, emits, slots, provide/inject |
| State | `references/state-management.md` | Pinia, stores, reactive state |
| Testing | `references/testing-patterns.md` | Vitest, component testing, mocking |

**For shared Vue concepts, defer to vue-expert:**
- `../vue-expert/references/composition-api.md` - Core reactivity patterns
- `../vue-expert/references/components.md` - Props, emits, slots
- `../vue-expert/references/state-management.md` - Pinia stores

## Code Patterns

### Component with JSDoc-typed props and emits

```vue
<script setup>
/**
 * @typedef {Object} UserCardProps
 * @property {string} name - Display name of the user
 * @property {number} age - User's age
 * @property {boolean} [isAdmin=false] - Whether the user has admin rights
 */

/** @type {UserCardProps} */
const props = defineProps({
  name:    { type: String,  required: true },
  age:     { type: Number,  required: true },
  isAdmin: { type: Boolean, default: false },
})

/**
 * @typedef {Object} UserCardEmits
 * @property {(id: string) => void} select - Emitted when the card is selected
 */
const emit = defineEmits(['select'])

/** @param {string} id */
function handleSelect(id) {
  emit('select', id)
}
</script>

<template>
  <div @click="handleSelect(props.name)">
    {{ props.name }} ({{ props.age }})
  </div>
</template>
```

### Composable with @typedef, @param, and @returns

```js
// composables/useCounter.mjs
import { ref, computed } from 'vue'

/**
 * @typedef {Object} CounterState
 * @property {import('vue').Ref<number>} count - Reactive count value
 * @property {import('vue').ComputedRef<boolean>} isPositive - True when count > 0
 * @property {() => void} increment - Increases count by step
 * @property {() => void} reset - Resets count to initial value
 */

/**
 * Composable for a simple counter with configurable step.
 * @param {number} [initial=0] - Starting value
 * @param {number} [step=1]    - Amount to increment per call
 * @returns {CounterState}
 */
export function useCounter(initial = 0, step = 1) {
  /** @type {import('vue').Ref<number>} */
  const count = ref(initial)

  const isPositive = computed(() => count.value > 0)

  function increment() {
    count.value += step
  }

  function reset() {
    count.value = initial
  }

  return { count, isPositive, increment, reset }
}
```

### @typedef for a complex object used across files

```js
// types/user.mjs

/**
 * @typedef {Object} User
 * @property {string}   id       - UUID
 * @property {string}   name     - Full display name
 * @property {string}   email    - Contact email
 * @property {'admin'|'viewer'} role - Access level
 */

// Import in other files with:
// /** @type {import('./types/user.mjs').User} */
```

## Constraints

### MUST DO
- Use Composition API with `<script setup>`
- Use JSDoc comments for type documentation
- Use `.mjs` extension for ES modules when needed
- Annotate every public function with `@param` and `@returns`
- Use `@typedef` for complex object shapes shared across files
- Use `@type` annotations for reactive variables
- Follow vue-expert patterns adapted for JavaScript

### MUST NOT DO
- Use TypeScript syntax (no `<script setup lang="ts">`)
- Use `.ts` file extensions
- Skip JSDoc types for public APIs
- Use CommonJS `require()` in Vue files
- Ignore type safety entirely
- Mix TypeScript files with JavaScript in the same component

## Output Templates

When implementing Vue features in JavaScript:
1. Component file with `<script setup>` (no lang attribute) and JSDoc-typed props/emits
2. `@typedef` definitions for complex prop or state shapes
3. Composable with `@param` and `@returns` annotations
4. Brief note on type coverage

## Knowledge Reference

Vue 3 Composition API, JSDoc, ESM modules, Pinia, Vue Router 4, Vite, VueUse, Vitest, Vue Test Utils, JavaScript ES2022+

[Documentation](https://jeffallan.github.io/claude-skills/skills/frontend/vue-expert-js/)
