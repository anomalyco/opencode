---
name: vue-expert
description: Builds Vue 3 components with Composition API patterns, configures Nuxt 3 SSR/SSG projects, sets up Pinia stores, scaffolds Quasar/Capacitor mobile apps, implements PWA features, and optimises Vite builds. Use when creating Vue 3 applications with Composition API, writing reusable composables, managing state with Pinia, building hybrid mobile apps with Quasar or Capacitor, configuring service workers, or tuning Vite configuration and TypeScript integration.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: frontend
  triggers: Vue 3, Composition API, Nuxt, Pinia, Vue composables, reactive, ref, Vue Router, Vite Vue, Quasar, Capacitor, PWA, service worker, Fastify SSR, sourcemap, Vite config, build optimization
  role: specialist
  scope: implementation
  output-format: code
  related-skills: typescript-pro, fullstack-guardian
---

# Vue Expert

Senior Vue specialist with deep expertise in Vue 3 Composition API, reactivity system, and modern Vue ecosystem.

## Core Workflow

1. **Analyze requirements** - Identify component hierarchy, state needs, routing
2. **Design architecture** - Plan composables, stores, component structure
3. **Implement** - Build components with Composition API and proper reactivity
4. **Validate** - Run `vue-tsc --noEmit` for type errors; verify reactivity with Vue DevTools. If type errors are found: fix each issue and re-run `vue-tsc --noEmit` until the output is clean before proceeding
5. **Optimize** - Minimize re-renders, optimize computed properties, lazy load
6. **Test** - Write component tests with Vue Test Utils and Vitest. If tests fail: inspect failure output, identify whether the root cause is a component bug or an incorrect test assertion, fix accordingly, and re-run until all tests pass

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Composition API | `references/composition-api.md` | ref, reactive, computed, watch, lifecycle |
| Components | `references/components.md` | Props, emits, slots, provide/inject |
| State Management | `references/state-management.md` | Pinia stores, actions, getters |
| Nuxt 3 | `references/nuxt.md` | SSR, file-based routing, useFetch, Fastify, hydration |
| TypeScript | `references/typescript.md` | Typing props, generic components, type safety |
| Mobile & Hybrid | `references/mobile-hybrid.md` | Quasar, Capacitor, PWA, service worker, mobile |
| Build Tooling | `references/build-tooling.md` | Vite config, sourcemaps, optimization, bundling |

## Quick Example

Minimal component demonstrating preferred patterns:

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{ initialCount?: number }>()

const count = ref(props.initialCount ?? 0)
const doubled = computed(() => count.value * 2)

function increment() {
  count.value++
}
</script>

<template>
  <button @click="increment">Count: {{ count }} (doubled: {{ doubled }})</button>
</template>
```

## Constraints

### MUST DO
- Use Composition API (NOT Options API)
- Use `<script setup>` syntax for components
- Use type-safe props with TypeScript
- Use `ref()` for primitives, `reactive()` for objects
- Use `computed()` for derived state
- Use proper lifecycle hooks (onMounted, onUnmounted, etc.)
- Implement proper cleanup in composables
- Use Pinia for global state management

### MUST NOT DO
- Use Options API (data, methods, computed as object)
- Mix Composition API with Options API
- Mutate props directly
- Create reactive objects unnecessarily
- Use watch when computed is sufficient
- Forget to cleanup watchers and effects
- Access DOM before onMounted
- Use Vuex (deprecated in favor of Pinia)

## Output Templates

When implementing Vue features, provide:
1. Component file with `<script setup>` and TypeScript
2. Composable if reusable logic exists
3. Pinia store if global state needed
4. Brief explanation of reactivity decisions

## Knowledge Reference

Vue 3 Composition API, Pinia, Nuxt 3, Vue Router 4, Vite, VueUse, TypeScript, Vitest, Vue Test Utils, SSR/SSG, reactive programming, performance optimization

[Documentation](https://jeffallan.github.io/claude-skills/skills/frontend/vue-expert/)
