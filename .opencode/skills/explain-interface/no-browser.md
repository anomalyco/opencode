# Reading a site without a browser

Fetch the HTML, then the stylesheets it links, then grep. That answers most questions a scriptable browser answers and a few it cannot.

Do not use a markdown-converting fetch for this. It strips exactly what you came for. Fetch the raw bytes.

```bash
curl -sL --max-time 25 "$URL" -o page.html
wc -c page.html
grep -oE 'href="[^"]*\.css[^"]*"' page.html | sed 's/href="//;s/"$//' | sort -u
```

Pull each stylesheet the same way, resolving protocol-relative and root-relative hrefs against the page's origin first.

## Utility CSS is self-describing

Where the site uses utility classes, the markup already contains the declarations and no stylesheet lookup is needed. Grep the class attribute for the effect:

```bash
grep -oE '(backdrop-)?blur-\[[^]]*\]|(backdrop-)?blur-[a-z0-9]+' page.html | sort | uniq -c | sort -rn
grep -oE 'class="[^"]*(gradient|blur|mask|mix-blend)[^"]*"' page.html | head -20
```

This is where the fetch method beats a browser. A class list carries every responsive and state variant at once, so `blur-[50px] md:h-214 md:-translate-x-1/2` says the element changes shape at the `md` breakpoint. Computed styles read at one width cannot.

Semantic CSS gives you a hashed class name instead (`Hero_glow__a1b2c`). Take that name to the stylesheet and grep it there.

## Inline styles carry the values utilities cannot express

A multi-stop gradient is usually too specific for a utility, so it lands in a `style` attribute:

```bash
grep -oE 'linear-gradient\([^)]*\)' page.html | sort -u | head
grep -oE 'radial-gradient\([^)]*\)' page.html | sort -u | head
grep -oE 'style="[^"]*(transform|filter|mask)[^"]*"' page.html | head
```

## The stylesheet, for tokens and generated utilities

```bash
grep -oE ':root\{[^}]*\}' style.css | head -1 | tr ';' '\n'      # the token layer
grep -oE '@layer [a-z]+' style.css | sort -u                      # Tailwind v4 emits theme/base/components/utilities
grep -oE '@media[^{]*\(m(in|ax)-width:[^)]*\)' style.css | sort -u # real breakpoints
grep -oE '@font-face\{[^}]*\}' style.css | head                    # families, weights, formats
grep -oE '@keyframes [a-zA-Z-]+' style.css | sort -u               # named animations
```

To understand a custom utility, grep its class name in the stylesheet and read the declaration whole. That is how `gradient-ease-in-out` turns into its mechanism, a generated stop list built with `color-mix()` and relative color syntax rather than twelve hand-written stops.

## Stack fingerprints from the HTML alone

```bash
grep -ocE '__NEXT_DATA__|/_next/static' page.html          # Next.js
grep -oc 'self.__next_f' page.html                          # App Router with RSC payload
grep -ocE '__NUXT__|/_nuxt/' page.html                      # Nuxt
grep -ocE '__remixContext|___gatsby|astro-island' page.html  # Remix, Gatsby, Astro
grep -oc 'class="[^"]*svelte-' page.html                     # Svelte
grep -oc 'data-radix-' page.html                             # Radix primitives
grep -oc 'bg-linear-to' page.html                            # Tailwind v4 (v3 wrote bg-gradient-to)
grep -oE '<meta name="generator"[^>]*>' page.html
```

Report these as fingerprints with the evidence that produced them, never as facts. `/_next/static` in an asset path is strong; a utility-looking class name alone is weak.

## What this method cannot tell you

Say so rather than guessing past it:

- **Which rule won.** Nine rules may match one element; only a browser resolves the cascade.
- **Anything injected at runtime.** CSS-in-JS, a theme applied by script, styles added on interaction.
- **Paint order and what is actually visible.** A declaration in the CSS may be overridden or never rendered.
- **Live animation state.** Whether an effect moves at all.
- **Computed values.** A `rem` stays a `rem`, and you never learn the resolved pixel size.
