---
name: frontend-design
description: Use when creating or editing CSS, HTML, web pages, UI components, landing pages, or any frontend styling (React, Vue, Svelte, Astro, Tailwind, plain CSS). Produces professional, non-generic design using design tokens, a restrained color system, fluid typography, content-driven layout, and modern CSS. Apply it before writing styles, not after.
---

# Frontend Design: profesional, no generico

Objetivo: que el CSS/UI se vea disenado a proposito, no como el "promedio" que generan los modelos por defecto.

## 1. Primero define el sistema, luego maqueta

Antes de escribir cualquier estilo, establece (o reutiliza) un conjunto de design tokens como unica fuente de verdad. Nunca uses valores magicos sueltos (colores hex random, paddings "al ojo", font-sizes arbitrarios). Si el proyecto ya tiene tokens o un design system, respetalos.

Si el proyecto no tiene base de tokens, usa la tool `scaffold_design` para generarla, o crea un `tokens.css` con esta estructura.

## 2. Color con restriccion (lo que mas delata a la IA)

- UNA familia de acento real + una escala de neutros bien construida. Evita el azul/violeta generico por defecto salvo que la marca lo pida.
- Usa `oklch()` para paletas perceptualmente uniformes y control de contraste predecible.
- Da a los neutros un leve tinte (no gris puro 0% croma): se ve mas intencional.
- Deriva estados (hover/active/disabled) con `color-mix()` sobre los tokens, no con hex nuevos.
- Verifica contraste AA (texto normal >= 4.5:1, grande >= 3:1).

## 3. Tipografia

- Escala modular (ej. ratio 1.2-1.25), no tamanos arbitrarios.
- Fluida con `clamp()`: `clamp(min, preferido-con-vw, max)` en `rem`. Respeta zoom y preferencias del usuario.
- Jerarquia clara: peso, tamano y color/contraste distinguen niveles. `line-height` mayor en cuerpo (1.5-1.7), menor en titulos.
- Limita el ancho de lectura del cuerpo a ~60-75ch (`max-width: 65ch`).
- Elige una fuente con intencion. Una sans por defecto del sistema esta bien si es deliberada; si la marca pide caracter, usa una display para titulos.

## 4. Espaciado y layout

- Escala de espaciado consistente (base 4 u 8px en `rem`). Reutiliza tokens de spacing.
- Usa `gap` en flex/grid en vez de margenes para separar; menos colapsos de margen.
- Breakpoints guiados por contenido (donde el layout se rompe), no por anchos de dispositivo.
- Usa `@container` (container queries) para componentes verdaderamente reusables.
- Ritmo vertical consistente entre secciones; alineacion a una grilla.

## 5. Detalles de pulido (los que la IA suele omitir)

- Jerarquia de botones: primario solido, secundario sutil, ghost/terciario. Padding y altura consistentes.
- Bordes, radios y sombras coherentes y sutiles (sombras suaves multinivel, no una sola dura).
- `:focus-visible` siempre visible y accesible (no quitar outline sin reemplazo).
- Estados completos: hover, active, focus, disabled, loading, vacio, error.
- Transiciones cortas y con proposito (120-220ms, `ease`/curvas custom). Respeta `prefers-reduced-motion`.
- Responsive real en movil, no como añadido: prueba 360px de ancho.

## 6. CSS moderno que se ve "pro"

- `@layer` para orquestar la cascada (reset, base, components, utilities).
- `:has()` para estados contextuales sin JS.
- `subgrid` para alinear hijos a la grilla del padre.
- `color-mix()` para variantes de color derivadas de tokens.
- `accent-color`, `scroll-behavior`, `text-wrap: balance` en titulos, `text-wrap: pretty` en parrafos.
- Reset moderno: `box-sizing: border-box`, `margin: 0`, `img { display:block; max-width:100% }`, `min-height` con `100dvh`.

## 7. Checklist anti-generico (revisa antes de dar por terminado)

- [ ] No hay etiquetas "eyebrow" gigantes sin sentido.
- [ ] No hay pills/badges/status dots aleatorios sin proposito.
- [ ] No hay glow/gradiente morado decorativo que no aporta.
- [ ] La tipografia tiene jerarquia intencional (no todo el mismo peso/tamano).
- [ ] La paleta es restringida y derivada de tokens.
- [ ] Botones y cards tienen jerarquia y padding consistentes.
- [ ] Pricing/CTA con buen contraste y jerarquia de conversion.
- [ ] Foco accesible y estados completos.
- [ ] Movil pulido a 360px.
- [ ] Las imagenes/ilustraciones son especificas del producto, no stock generico.

## 8. Flujo recomendado

1. Si el usuario da una referencia (URL/captura/marca), usala para estructura, densidad y energia visual; luego cambia marca, color, copy y composicion para que sea original. No clones.
2. Si involucra una libreria/framework, consulta documentacion real con la tool `context7` antes de codificar.
3. Establece tokens (o usa `scaffold_design`).
4. Maqueta con la escala y los tokens.
5. Pasa el checklist anti-generico.