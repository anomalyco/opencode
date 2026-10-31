import { Group, Mesh } from "three"
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js"
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js"
import { createMesh, disposeMesh } from "./geometry"
import type { DesignScene } from "./model"

export type ExportFormat = "glb" | "obj"

function buildGroup(scene: DesignScene) {
  const group = new Group()
  group.name = scene.name || "Design"

  for (const object of scene.objects) {
    if (!object.visible) continue
    group.add(createMesh(object))
  }

  return group
}

function disposeGroup(group: Group) {
  group.traverse((child) => {
    if (child instanceof Mesh) disposeMesh(child)
  })
}

export function exportSceneGLB(scene: DesignScene): Promise<ArrayBuffer> {
  const group = buildGroup(scene)

  if (group.children.length === 0) {
    disposeGroup(group)
    throw new Error("The scene has no visible objects.")
  }

  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      group,
      (result) => {
        disposeGroup(group)

        if (result instanceof ArrayBuffer) {
          resolve(result)

          return
        }

        reject(new Error("GLB export returned a JSON scene instead of binary data."))
      },
      (error) => {
        disposeGroup(group)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
      { binary: true, onlyVisible: true, maxTextureSize: 2048 },
    )
  })
}

export function exportSceneOBJ(scene: DesignScene) {
  const group = buildGroup(scene)

  if (group.children.length === 0) {
    disposeGroup(group)
    throw new Error("The scene has no visible objects.")
  }

  const result = new OBJExporter().parse(group)
  disposeGroup(group)

  if (!result.trim()) throw new Error("OBJ export produced an empty file.")

  return result
}

export function downloadExport(data: BlobPart, filename: string, type: string) {
  const blob = new Blob([data], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")

  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function sceneFileName(scene: DesignScene, extension: string) {
  const base = scene.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return `${base || "design"}.${extension}`
}
