import { describe, expect, test } from "bun:test"
import { pickClasses } from "./design-preview/pick-classes"
import { createResolver } from "./design-preview/resolve"
import { choose, mode, need, rank } from "./design-preview/source"

describe("pickClasses", () => {
  test("prefers specific classes over utility tokens", () => {
    expect(pickClasses("flex items-center rounded-md hero-card settings-panel")).toEqual([
      "settings-panel",
      "hero-card",
    ])
  })

  test("strips variants before filtering utilities", () => {
    expect(pickClasses("md:flex dark:bg-black lg:rounded-xl md:project-shell xl:nav-item")).toEqual([
      "project-shell",
      "nav-item",
    ])
  })
})

describe("createResolver", () => {
  test("findTag locates the JSX usage inside the parent file", async () => {
    const map = {
      "src/sections/Certifications.jsx": `export function Certifications() {
  return (
    <GridSection>
      <ScrollReveal className=\"fade\">Hello</ScrollReveal>
    </GridSection>
  )
}`,
    }
    const lookup = createResolver(
      {
        normalize: (input) => input,
        load: async () => {},
        get: (input) => {
          const content = map[input as keyof typeof map]
          if (!content) return undefined
          return { content: { type: "text", content } }
        },
      },
      {
        find: {
          text: async () => ({ data: [] }),
        },
      },
    )

    await expect(lookup.findTag("src/sections/Certifications.jsx", "ScrollReveal")).resolves.toMatchObject({
      file: "src/sections/Certifications.jsx",
      line: 4,
      comp: "ScrollReveal",
      origin: "tag",
    })
  })

  test("findTag prefers the matching instance when the parent renders the component multiple times", async () => {
    const map = {
      "src/sections/Certifications.jsx": `export function Certifications() {
  return (
    <GridSection>
      <ScrollReveal className="fade">First</ScrollReveal>
      <ScrollReveal className="focus">Second</ScrollReveal>
    </GridSection>
  )
}`,
    }
    const lookup = createResolver(
      {
        normalize: (input) => input,
        load: async () => {},
        get: (input) => {
          const content = map[input as keyof typeof map]
          if (!content) return undefined
          return { content: { type: "text", content } }
        },
      },
      {
        find: {
          text: async () => ({ data: [] }),
        },
      },
    )

    await expect(
      lookup.findTag("src/sections/Certifications.jsx", "ScrollReveal", {
        text: "Second",
        classes: "focus",
      }),
    ).resolves.toMatchObject({
      file: "src/sections/Certifications.jsx",
      line: 5,
      comp: "ScrollReveal",
      origin: "tag",
    })
  })

  test("findTagInFiles keeps walking outward through wrapper components", async () => {
    const map = {
      "src/components/GridSection.jsx": `export default function GridSection({ children }) {
  return <section>{children}</section>
}`,
      "src/sections/Hero.jsx": `export default function Hero() {
  return (
    <GridSection>
      <Button className="hero-cta">Discuss Project</Button>
    </GridSection>
  )
}`,
    }
    const lookup = createResolver(
      {
        normalize: (input) => input,
        load: async () => {},
        get: (input) => {
          const content = map[input as keyof typeof map]
          if (!content) return undefined
          return { content: { type: "text", content } }
        },
      },
      {
        find: {
          text: async () => ({ data: [] }),
        },
      },
    )

    await expect(
      lookup.findTagInFiles(["src/components/GridSection.jsx", "src/sections/Hero.jsx"], "Button", {
        text: "Discuss Project",
        classes: "hero-cta",
      }),
    ).resolves.toMatchObject({
      file: "src/sections/Hero.jsx",
      line: 4,
      comp: "Button",
      origin: "tag",
    })
  })

  test("findTagInFiles prefers the best ancestor match over an unrelated nearer file hit", async () => {
    const map = {
      "src/components/GridSection.jsx": `export default function GridSection({ children }) {
  return (
    <section>
      <Button>Wrapper Action</Button>
      {children}
    </section>
  )
}`,
      "src/sections/Hero.jsx": `export default function Hero() {
  return (
    <GridSection>
      <Button className="hero-cta">Discuss Project</Button>
    </GridSection>
  )
}`,
    }
    const lookup = createResolver(
      {
        normalize: (input) => input,
        load: async () => {},
        get: (input) => {
          const content = map[input as keyof typeof map]
          if (!content) return undefined
          return { content: { type: "text", content } }
        },
      },
      {
        find: {
          text: async () => ({ data: [] }),
        },
      },
    )

    await expect(
      lookup.findTagInFiles(["src/components/GridSection.jsx", "src/sections/Hero.jsx"], "Button", {
        text: "Discuss Project",
        classes: "hero-cta",
      }),
    ).resolves.toMatchObject({
      file: "src/sections/Hero.jsx",
      line: 4,
      comp: "Button",
      origin: "tag",
    })
  })

  test("findTagInFiles keeps scanning when a later ancestor has a stronger match", async () => {
    const map = {
      "src/components/GridSection.jsx": `export default function GridSection({ children }) {
  return (
    <section>
      <Button className="hero-cta">Wrapper Action</Button>
      {children}
    </section>
  )
}`,
      "src/sections/Hero.jsx": `export default function Hero() {
  return (
    <GridSection>
      <Button className="hero-cta">Discuss Project</Button>
    </GridSection>
  )
}`,
    }
    const lookup = createResolver(
      {
        normalize: (input) => input,
        load: async () => {},
        get: (input) => {
          const content = map[input as keyof typeof map]
          if (!content) return undefined
          return { content: { type: "text", content } }
        },
      },
      {
        find: {
          text: async () => ({ data: [] }),
        },
      },
    )

    await expect(
      lookup.findTagInFiles(["src/components/GridSection.jsx", "src/sections/Hero.jsx"], "Button", {
        text: "Discuss Project",
        classes: "hero-cta",
      }),
    ).resolves.toMatchObject({
      file: "src/sections/Hero.jsx",
      line: 4,
      comp: "Button",
      origin: "tag",
    })
  })
})

describe("design preview source", () => {
  test("keeps component definition as source fallback", () => {
    const src = choose({
      source: undefined,
      definition: { file: "src/sections/Header.jsx", line: 22, component: "Header" },
    })
    expect(src).toEqual({ file: "src/sections/Header.jsx", line: 22, component: "Header" })
  })

  test("prefers definition when source has no file", () => {
    const src = choose({
      source: { component: "Header" },
      definition: { file: "src/sections/Header.jsx", line: 22, component: "Header" },
    })
    expect(src).toEqual({ file: "src/sections/Header.jsx", line: 22, component: "Header" })
  })

  test("skips usage fallback when definition already exists in full enrich", () => {
    expect(
      need(
        {
          source: undefined,
          definition: { file: "src/sections/Header.jsx", line: 22 },
        },
        true,
      ),
    ).toBe(false)
  })

  test("allows usage fallback when only opening usage", () => {
    expect(
      need(
        {
          source: undefined,
          definition: { file: "src/sections/Header.jsx", line: 22 },
        },
        false,
      ),
    ).toBe(true)
  })

  test("still requires fallback when source has no file", () => {
    expect(
      need(
        {
          source: { component: "Header" },
          definition: { file: "src/sections/Header.jsx", line: 22 },
        },
        false,
      ),
    ).toBe(true)
  })

  test("returns direct mode for high score", () => {
    expect(mode({ file: "src/a.tsx", line: 1, score: 0.9 })).toBe("direct")
  })

  test("returns confirm mode for medium score", () => {
    expect(mode({ file: "src/a.tsx", line: 1, score: 0.7 })).toBe("confirm")
  })

  test("returns deny mode for low score", () => {
    expect(mode({ file: "src/a.tsx", line: 1, score: 0.3 })).toBe("deny")
  })

  test("rank falls back to confidence label", () => {
    expect(rank({ confidence: "medium" })).toBe(0.7)
  })
})

describe("resolver confidence", () => {
  test("findDefinition marks ambiguous matches", async () => {
    const lookup = createResolver(
      {
        normalize: (input) => input,
        load: async () => {},
        get: () => undefined,
      },
      {
        find: {
          text: async ({ pattern }) => {
            if (!pattern.includes("Card")) return { data: [] }
            return {
              data: [
                { path: { text: "src/ui/Card.tsx" }, line_number: 10 },
                { path: { text: "src/marketing/Card.tsx" }, line_number: 8 },
              ],
            }
          },
        },
      },
    )

    await expect(lookup.findDefinition("Card")).resolves.toMatchObject({
      file: "src/ui/Card.tsx",
      origin: "definition",
      ambiguous: true,
    })
  })
})
