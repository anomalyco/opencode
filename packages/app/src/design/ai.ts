import { Option, Schema } from "effect"
import type { ServerCtx } from "@/runtime/server/runtime"
import type { DesignScene } from "./scene/model"
import type { UiDocument } from "./ui/model"

const sceneContract = `{
  "version": 1,
  "name": string,
  "objects": [
    {
      "id": string,
      "name": string,
      "shape": "box" | "sphere" | "cylinder" | "cone" | "torus" | "plane",
      "position": [number, number, number],
      "rotation": [number, number, number],
      "scale": [number, number, number],
      "material": {
        "color": "#rrggbb",
        "metalness": number,
        "roughness": number,
        "emissive": "#rrggbb",
        "emissiveIntensity": number,
        "opacity": number,
        "wireframe": boolean
      },
      "visible": boolean
    }
  ]
}`

const uiContract = `{
  "version": 1,
  "template": "landing" | "pricing" | "dashboard" | "portfolio" | "contact",
  "title": string,
  "theme": {
    "mode": "light" | "dark",
    "accent": "#rrggbb",
    "font": "sans" | "serif" | "mono",
    "radius": number
  },
  "sections": [
    {
      "id": string,
      "kind": "hero" | "features" | "stats" | "pricing" | "testimonial" | "cta" | "form" | "table" | "footer",
      "title": string,
      "body": string,
      "items": [{ "id": string, "title": string, "body": string }]
    }
  ]
}`

export function scenePrompt(scene: DesignScene, request: string) {
  return `You are a 3D scene designer inside an editor. Update the complete scene for the user's request.

Rules:
- Return only JSON. No markdown, no code fences, no explanation.
- Keep every object entry valid and give every object a unique string id.
- Rotation is in radians. Position and scale are in world units.
- Keep the scene small and readable, with 1-12 objects.
- When the user asks to add something, keep the existing objects unless they ask to replace the scene.
- Use the material color as a #rrggbb string.

Scene JSON shape:
${sceneContract}

Current scene:
${JSON.stringify(scene, null, 2)}

User request: ${request}

Return the complete updated scene JSON.`
}

export function uiPrompt(document: UiDocument, request: string) {
  return `You are a product designer inside an editor. Update the complete page for the user's request.

Rules:
- Return only JSON. No markdown, no code fences, no explanation.
- Keep every section entry valid and give every section and item a unique string id.
- Use only the section kinds in the shape.
- Keep content concise and realistic. Use 3-6 sections, and at most 4 items per section.
- When the user asks for a visual change, preserve the content and change only what they asked for.

Page JSON shape:
${uiContract}

Current page:
${JSON.stringify(document, null, 2)}

User request: ${request}

Return the complete updated page JSON.`
}

export async function generateDesignText(ctx: ServerCtx, prompt: string) {
  const result = await ctx.sdk.api.experimental.generate.text({ prompt })

  return result.text
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text
  const start = fenced.indexOf("{")
  const end = fenced.lastIndexOf("}")

  if (start === -1 || end <= start) return

  return Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(fenced.slice(start, end + 1)),
  )
}
