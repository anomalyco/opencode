import {
  Box3,
  Color,
  Group,
  type LoadingManager,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Vector3,
  type WebGLRenderer,
} from "three"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import type { Cabinet, CabinetParts } from "./cabinet"
import { mediaUrl } from "~/lib/media"

/**
 * The pre-made cabinet (public/arcade3d/README.md: "Arcade Machine" by MitchellBr, CC BY 4.0,
 * modified): metres, +Y up, front +Z, floor at y = 0. Desktop loads the KTX2 file, phones and the
 * low tier the lite one, anything else the WebP one; meshopt (and Draco) compressed.
 *
 * Named nodes: "screen" (the CRT glass, 0–1 UVs; it takes the CRT material), "coinSlot" (its
 * origin is the slit; the coin goes in along -Z), "coinReturn", "marquee" (dark until the credit),
 * "edges" (the T-molding, tinted by the edge light), "bezel" and "body" (scaled to the painting).
 * Returns undefined when there is no GLB, so the stage builds the procedural cabinet instead.
 */

// The painted cabinet's screen is larger and a little lower than the model's: the bezel and the
// glass scale about the glass's centre (perspective/notes.md: ≈ 0.49 m wide at ≈ 1.24 m).
const screenScale = 1.18
const screenDrop = 0.02
const depthStretch = 1.2

export async function loadGlbCabinet(
  manager: LoadingManager,
  renderer: WebGLRenderer,
  options: { shadows: boolean; lite: boolean },
) {
  if (new URLSearchParams(location.search).get("cabinet") === "procedural") return undefined
  // Desktop: KTX2 textures (compressed on the GPU) when the GPU takes a Basis target; phones and the
  // low tier: the 1024 atlas; otherwise the WebP 2048 file.
  const ktx2 = new KTX2Loader(manager).setTranscoderPath("/arcade3d/basis/").detectSupport(renderer)
  const config = ktx2.workerConfig
  const compressed = config.astcSupported || config.etc2Supported || config.dxtSupported || config.bptcSupported
  const choices = (
    options.lite
      ? ["/arcade3d/cabinet-lite.glb", "/arcade3d/cabinet.glb"]
      : compressed
        ? ["/arcade3d/cabinet.ktx2.glb", "/arcade3d/cabinet.glb"]
        : ["/arcade3d/cabinet.glb"]
  ).map(mediaUrl)
  const available = await Promise.all(
    choices.map((choice) =>
      fetch(choice, { method: "HEAD" })
        .then((response) => response.ok && !response.headers.get("content-type")?.includes("text/html"))
        .catch(() => false),
    ),
  )
  const url = choices.find((_, index) => available[index])
  if (!url) {
    ktx2.dispose()
    return undefined
  }
  const draco = new DRACOLoader(manager).setDecoderPath("/arcade3d/draco/")
  const loader = new GLTFLoader(manager).setDRACOLoader(draco).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder)
  const gltf = await loader.loadAsync(url)
  draco.dispose()
  ktx2.dispose()
  const model = gltf.scene
  const names = { screen: "screen", coinSlot: "coinSlot", coinReturn: "coinReturn", marquee: "marquee", edges: "edges" }

  // Stand it on the floor and centre the footprint (the file should already be, README.md).
  model.updateMatrixWorld(true)
  const box = new Box3().setFromObject(model)
  const centre = box.getCenter(new Vector3())
  model.position.set(-centre.x, -box.min.y, -centre.z)
  model.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(model)
  const size = {
    width: bounds.max.x - bounds.min.x,
    height: bounds.max.y - bounds.min.y,
    depth: bounds.max.z - bounds.min.z,
  }

  const find = (name: string) => model.getObjectByName(name)
  enlargeScreen(find(names.screen), find("bezel"))
  // The painted cabinet is deeper (0.76 m at the base against the model's 0.63 m): stretch the
  // shell backwards from the coin door's plane; the round parts on the front keep their shape.
  const slotNode = find(names.coinSlot)
  if (slotNode)
    deepen([find("body"), find(names.edges)], slotNode.getWorldPosition(new Vector3()).z - 0.012, depthStretch)
  model.updateMatrixWorld(true)
  const screen = find(names.screen)
  const screenMesh = screen && firstMesh(screen)
  const slot = find(names.coinSlot)
  if (!screenMesh || !slot) throw new Error(`cabinet.glb needs "${names.screen}" and "${names.coinSlot}" nodes`)

  const meshes: Mesh[] = []
  const anisotropy = renderer.capabilities.getMaxAnisotropy()
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.castShadow = options.shadows
    object.receiveShadow = options.shadows
    meshes.push(object)
    for (const material of materials(object)) {
      if (!(material instanceof MeshStandardMaterial)) continue
      for (const map of [
        material.map,
        material.normalMap,
        material.roughnessMap,
        material.metalnessMap,
        material.aoMap,
      ])
        if (map) map.anisotropy = anisotropy
    }
  })

  const parts = glbParts(screenMesh, slot, find(names.coinReturn), find(names.marquee), bounds)
  // Lit parts get their own material copies, so the lamps can change them.
  const lit = (object: Object3D | undefined) =>
    object
      ? meshesOf(object).flatMap((mesh) => {
          const copies = materials(mesh).map((material) => material.clone())
          mesh.material = copies.length === 1 ? copies[0] : copies
          return copies.filter((material): material is MeshStandardMaterial => material instanceof MeshStandardMaterial)
        })
      : []
  const marquee = lit(find(names.marquee))
  // The marquee's art is bright even unlit; the painting's marquee is dark until the credit.
  const marqueeColors = marquee.map((material) => material.color.clone())
  const slotLamps = lit(slot)
  const edges = lit(find(names.edges))

  // The stage moves and turns the cabinet's group; the normalising transform stays inside it.
  const group = new Group()
  group.add(model)
  const cabinet: Cabinet = {
    group,
    body: meshes.filter((mesh) => mesh !== screenMesh),
    parts,
    size,
    screen: screenMesh,
    setPower: (value, edge, edgeIntensity) => {
      marquee.forEach((material, index) => {
        material.color.copy(marqueeColors[index]).multiplyScalar(0.25 + 0.75 * value)
        material.emissive.copy(edge).lerp(new Color(1, 1, 1), 0.6)
        if (!material.emissiveMap && material.map) material.emissiveMap = material.map
        material.emissiveIntensity = value * 1.1 * edgeIntensity
      })
      for (const material of slotLamps) {
        material.emissive.copy(edge)
        material.emissiveIntensity = (0.4 + value * 2.4) * edgeIntensity
      }
      for (const material of edges) {
        material.emissive.copy(edge)
        material.emissiveIntensity = (0.03 + value * 0.05) * edgeIntensity
      }
    },
    dispose: () => {
      model.traverse((object) => {
        if (!(object instanceof Mesh)) return
        object.geometry.dispose()
        for (const material of materials(object)) material.dispose()
      })
    },
  }
  return cabinet
}

/** The stage's anchors, measured from the named nodes in cabinet space. */
function glbParts(
  screen: Mesh,
  slot: Object3D,
  coinReturn: Object3D | undefined,
  marquee: Object3D | undefined,
  bounds: Box3,
) {
  const position = screen.geometry.getAttribute("position")
  const normals = screen.geometry.getAttribute("normal")
  // The glass's facing: its mean normal; its up: the world's up, flattened onto the glass.
  const normal = new Vector3()
  for (let index = 0; index < (normals?.count ?? 0); index++)
    normal.add(new Vector3().fromBufferAttribute(normals, index))
  normal.transformDirection(screen.matrixWorld).normalize()
  if (normal.lengthSq() === 0) normal.set(0, 0, 1)
  const up = new Vector3(0, 1, 0).addScaledVector(normal, -normal.y).normalize()
  const right = new Vector3().crossVectors(up, normal).normalize()
  const points = Array.from({ length: position.count }, (_, index) =>
    new Vector3().fromBufferAttribute(position, index).applyMatrix4(screen.matrixWorld),
  )
  const centre = points.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(Math.max(1, points.length))
  const along = (axis: Vector3) => points.map((point) => point.clone().sub(centre).dot(axis))
  const xs = along(right)
  const ys = along(up)
  const slotAt = slot.getWorldPosition(new Vector3())
  const marqueeBox = marquee ? new Box3().setFromObject(marquee) : undefined
  const parts: CabinetParts = {
    doorZ: slotAt.z - 0.012,
    frontZ: slotAt.z - 0.012,
    slot: slotAt,
    coinReturn: coinReturn ? coinReturn.getWorldPosition(new Vector3()) : slotAt.clone().add(new Vector3(0, -0.16, 0)),
    glass: {
      centre,
      normal,
      up,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    },
    marquee: {
      bottom: new Vector3(0, marqueeBox?.min.y ?? bounds.max.y - 0.2, marqueeBox?.max.z ?? bounds.max.z),
      top: new Vector3(0, marqueeBox?.max.y ?? bounds.max.y, marqueeBox?.max.z ?? bounds.max.z),
    },
  }
  return parts
}

/** Stretch nodes along z away from a plane at `frontZ` (cabinet space), leaving that plane in place. */
function deepen(nodes: (Object3D | undefined)[], frontZ: number, factor: number) {
  for (const node of nodes) {
    if (!node?.parent) continue
    const plane = node.parent.worldToLocal(new Vector3(0, 0, frontZ)).z
    node.position.z = plane + (node.position.z - plane) * factor
    node.scale.z *= factor
  }
}

/** Scale the bezel and the glass together about the glass's centre, and lower them a touch. */
function enlargeScreen(screen: Object3D | undefined, bezel: Object3D | undefined) {
  if (!screen) return
  screen.updateMatrixWorld(true)
  const pivot = new Box3().setFromObject(screen).getCenter(new Vector3())
  for (const node of [screen, bezel]) {
    if (!node?.parent) continue
    const local = node.parent.worldToLocal(pivot.clone())
    node.position.sub(local).multiplyScalar(screenScale).add(local)
    node.position.y -= screenDrop / node.parent.getWorldScale(new Vector3()).y
    node.scale.multiplyScalar(screenScale)
  }
}

function firstMesh(object: Object3D) {
  if (object instanceof Mesh) return object
  return meshesOf(object)[0]
}

function meshesOf(object: Object3D) {
  const found: Mesh[] = []
  object.traverse((child) => {
    if (child instanceof Mesh) found.push(child)
  })
  return found
}

function materials(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}
