import { describe, expect, test } from "bun:test"
import { pickClasses } from "./design-preview/pick-classes"
import { createResolver } from "./design-preview/resolve"

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

    await expect(lookup.findTag("src/sections/Certifications.jsx", "ScrollReveal")).resolves.toEqual({
      file: "src/sections/Certifications.jsx",
      line: 4,
      comp: "ScrollReveal",
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
    ).resolves.toEqual({
      file: "src/sections/Certifications.jsx",
      line: 5,
      comp: "ScrollReveal",
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
    ).resolves.toEqual({
      file: "src/sections/Hero.jsx",
      line: 4,
      comp: "Button",
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
    ).resolves.toEqual({
      file: "src/sections/Hero.jsx",
      line: 4,
      comp: "Button",
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
    ).resolves.toEqual({
      file: "src/sections/Hero.jsx",
      line: 4,
      comp: "Button",
    })
  })
})
