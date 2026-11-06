/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- the spec parser and the read function above clamp every numeric field; these assertions only pick the branch the data already selected. */
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { clamp, num, object, objects, optionalNum, str, type Json } from "../json"
import { fmt, short } from "../format"
import { IconButton, Readout, Slider, ViewIcon } from "../controls"
import { VisualFrame } from "../frame"
import type { VisualSpec } from "../spec"

type PartForm = "box" | "cylinder" | "shaft" | "gear" | "bearing" | "plate"

interface LabelBox {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

interface Part {
  readonly id: string
  readonly label: string
  readonly form: PartForm
  readonly size: [number, number, number]
  readonly position: [number, number, number]
  readonly rotation: [number, number, number]
  readonly explode: [number, number, number]
  readonly tone: "steel" | "dark" | "accent"
  readonly teeth: number
  readonly module: number
  readonly thickness: number
  readonly hole: number
}

function readParts(spec: VisualSpec): Part[] {
  const data = object(spec.data) ?? {}

  return objects(data.parts)
    .slice(0, 40)
    .map((item, index) => ({
      id: str(item.id, `p${index}`),
      label: str(item.label, `Part ${index + 1}`),
      form: normalizeForm(str(item.shape, "box")),
      size: triple(item.size, [60, 40, 40]),
      position: triple(item.position, [0, 0, 0]),
      rotation: triple(item.rotation, [0, 0, 0]),
      explode: triple(item.explode, [0, 40, 0]),
      tone: partTone(str(item.tone, "steel")),
      teeth: clamp(num(item.teeth, 20), 6, 120),
      module: clamp(num(item.module, 2), 0.4, 20),
      thickness: clamp(num(item.thickness, 10), 1, 200),
      hole: clamp(num(item.hole, 0), 0, 200),
    }))
}

function partTone(value: string): Part["tone"] {
  if (value === "accent") return "accent"

  if (value === "dark") return "dark"

  return "steel"
}

function normalizeForm(value: string): PartForm {
  if (value === "cylinder" || value === "shaft" || value === "gear" || value === "bearing" || value === "plate") return value

  return "box"
}

function triple(value: Json | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value)) return fallback

  return [
    clamp(optionalNum(value[0]) ?? fallback[0], -10000, 10000),
    clamp(optionalNum(value[1]) ?? fallback[1], -10000, 10000),
    clamp(optionalNum(value[2]) ?? fallback[2], -10000, 10000),
  ]
}

function color(tone: Part["tone"], accent: string): number {
  if (tone === "accent") return new THREE.Color(accent).getHex()

  if (tone === "dark") return 0x4a4a4a

  return 0x8f8f8f
}

export function AssemblyVisual(props: { spec: VisualSpec }) {
  const parts = () => readParts(props.spec)
  const initialExplode = clamp(num(object(props.spec.data)?.explode, 0), 0, 1)
  const [explode, setExplode] = createSignal(initialExplode)
  const [spin, setSpin] = createSignal(false)
  const [failed, setFailed] = createSignal<string>()
  let host: HTMLDivElement | undefined
  let reset: (() => void) | undefined

  onMount(() => {
    if (!host) return
    const root = host
    let renderer: THREE.WebGLRenderer

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" })
    } catch (cause) {
      setFailed(cause instanceof Error ? cause.message : "WebGL is not available.")

      return
    }

    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(root.clientWidth, 240, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.style.width = "100%"
    renderer.domElement.style.height = "100%"
    renderer.domElement.style.display = "block"
    root.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(32, Math.max(1, root.clientWidth / 300), 0.1, 5000)
    camera.position.set(190, 150, 210)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.rotateSpeed = 0.7
    controls.minDistance = 40
    controls.maxDistance = 1400
    controls.autoRotateSpeed = 0.7

    const accent = resolveColor(root, "--v-accent") || "#fab283"
    scene.add(new THREE.AmbientLight(0xffffff, 1.5))
    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(160, 240, 180)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.9)
    fill.position.set(-160, 80, -140)
    scene.add(fill)

    const group = new THREE.Group()
    scene.add(group)

    const grid = new THREE.GridHelper(600, 24, 0x3a3a3a, 0x242424)
    grid.position.y = -0.5
    const gridMaterial = grid.material as THREE.Material
    gridMaterial.transparent = true
    gridMaterial.opacity = 0.42
    scene.add(grid)

    const labels: Array<{ part: Part; element: HTMLDivElement; anchor: THREE.Vector3 }> = []
    const materials: THREE.Material[] = []
    const geometries: THREE.BufferGeometry[] = []
    geometries.push(grid.geometry)
    materials.push(grid.material as THREE.Material)

    const add = (item: Part) => {
      const material = new THREE.MeshStandardMaterial({
        color: color(item.tone, accent),
        roughness: 0.62,
        metalness: item.tone === "accent" ? 0.25 : 0.35,
        flatShading: false,
      })

      materials.push(material)
      let geometry: THREE.BufferGeometry

      if (item.form === "gear") geometry = gearGeometry(item)
      else if (item.form === "bearing") geometry = bearingGeometry(item)
      else if (item.form === "shaft") geometry = new THREE.CylinderGeometry(item.size[0] / 2, item.size[0] / 2, item.size[1], 32)
      else if (item.form === "cylinder") geometry = new THREE.CylinderGeometry(item.size[0] / 2, item.size[0] / 2, item.size[1], 40)
      else if (item.form === "plate") geometry = new THREE.BoxGeometry(item.size[0], item.size[1], item.size[2])
      else geometry = new THREE.BoxGeometry(item.size[0], item.size[1], item.size[2])
      geometries.push(geometry)
      geometry.computeBoundingBox()
      const mesh = new THREE.Mesh(geometry, material)
      mesh.rotation.set((item.rotation[0] * Math.PI) / 180, (item.rotation[1] * Math.PI) / 180, (item.rotation[2] * Math.PI) / 180)
      mesh.position.set(item.position[0], item.position[1], item.position[2])
      mesh.userData.base = mesh.position.clone()
      mesh.userData.explode = new THREE.Vector3(...item.explode).multiplyScalar(2.2)
      mesh.userData.label = item.label

      const edgeGeometry = new THREE.EdgesGeometry(geometry, 28)
      const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 })
      geometries.push(edgeGeometry)
      materials.push(edgeMaterial)
      const edge = new THREE.LineSegments(edgeGeometry, edgeMaterial)

      mesh.add(edge)
      group.add(mesh)

      const element = document.createElement("div")
      element.textContent = short(item.label, 22)
      element.style.cssText =
        "position:absolute;left:0;top:0;transform:translate(-50%,-140%);max-width:160px;overflow:hidden;text-overflow:ellipsis;font-family:var(--v-mono);font-size:11px;line-height:1.2;color:var(--v-fg);background:color-mix(in srgb, var(--v-bg) 92%, transparent);padding:1px 4px;border-radius:2px;pointer-events:none;white-space:nowrap;opacity:0;transition:opacity 120ms linear"
      root.appendChild(element)
      const top = item.form === "shaft" ? 22 : (geometry.boundingBox?.max.y ?? 0) + 4
      labels.push({ part: item, element, anchor: new THREE.Vector3(0, top, 0) })

      return mesh
    }

    const meshes = parts().map(add)

    const box = new THREE.Box3()
    parts().forEach((item) => {
      const extent = item.form === "gear" ? item.module * item.teeth * 0.62 : Math.max(item.size[0], item.size[1], item.size[2])
      box.expandByPoint(new THREE.Vector3(...item.position).subScalar(extent / 2))
      box.expandByPoint(new THREE.Vector3(...item.position).addScalar(extent / 2))
    })

    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(200, 120, 120))
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const radius = Math.max(size.x, size.y, size.z, 20)
    group.position.set(-center.x, -box.min.y, -center.z)
    const target = new THREE.Vector3(0, size.y * 0.45, 0)
    camera.position.set(target.x + radius * 1.25, target.y + radius * 0.72, target.z + radius * 1.4)
    camera.lookAt(target)
    controls.target.copy(target)
    controls.maxDistance = radius * 6
    camera.near = radius * 0.01
    camera.far = radius * 30
    camera.updateProjectionMatrix()
    grid.scale.setScalar(Math.max(0.4, radius / 200))

    const scaleLength = radius > 120 ? 50 : radius > 60 ? 20 : 10
    const scaleY = 0.6
    const scaleZ = size.z / 2 + 30

    const scaleGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-scaleLength / 2, scaleY, scaleZ),
      new THREE.Vector3(scaleLength / 2, scaleY, scaleZ),
    ])

    const scaleMaterial = new THREE.LineBasicMaterial({ color: new THREE.Color(accent).getHex(), transparent: true, opacity: 0.9 })
    const scaleLine = new THREE.Line(scaleGeometry, scaleMaterial)
    scene.add(scaleLine)
    geometries.push(scaleGeometry)
    materials.push(scaleMaterial)

    for (const side of [-1, 1]) {
      const tickGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3((side * scaleLength) / 2, scaleY, scaleZ - 3),
        new THREE.Vector3((side * scaleLength) / 2, scaleY, scaleZ + 3),
      ])

      const tickLine = new THREE.Line(tickGeometry, scaleMaterial)
      scene.add(tickLine)
      geometries.push(tickGeometry)
    }

    const scaleMid = new THREE.Vector3(0, scaleY, scaleZ)
    const scaleElement = document.createElement("div")
    scaleElement.textContent = `${scaleLength} mm`
    scaleElement.style.cssText =
      "position:absolute;left:0;top:0;transform:translate(-50%,-160%);font-family:var(--v-mono);font-size:11px;line-height:1.2;color:var(--v-fg);pointer-events:none;white-space:nowrap;opacity:0"
    root.appendChild(scaleElement)

    const resetView = () => {
      camera.position.set(target.x + radius * 1.25, target.y + radius * 0.72, target.z + radius * 1.4)
      controls.target.copy(target)
      controls.update()
    }

    reset = resetView

    let frame = 0
    let active = true
    let onScreen = true
    const clock = new THREE.Clock()
    const projected = new THREE.Vector3()

    const render = () => {
      if (!active) {
        frame = 0

        return
      }

      frame = requestAnimationFrame(render)
      const delta = clock.getDelta()
      controls.autoRotate = spin()
      controls.update(delta * 0.4)
      const amount = explode()
      meshes.forEach((mesh) => {
        const base = mesh.userData.base as THREE.Vector3
        const offset = mesh.userData.explode as THREE.Vector3
        mesh.position.set(base.x + offset.x * amount, base.y + offset.y * amount, base.z + offset.z * amount)
      })
      renderer.render(scene, camera)
      const placed: Array<{ label: (typeof labels)[number]; x: number; y: number; mesh: THREE.Mesh }> = []
      projected.copy(scaleMid).project(camera)

      if (projected.z < 1) {
        scaleElement.style.opacity = "1"
        scaleElement.style.left = `${((projected.x + 1) / 2) * root.clientWidth}px`
        scaleElement.style.top = `${((1 - projected.y) / 2) * root.clientHeight}px`
      } else {
        scaleElement.style.opacity = "0"
      }

      labels.forEach((label, index) => {
        const mesh = meshes[index]

        if (!mesh) return
        projected.copy(mesh.position).add(label.anchor).project(camera)

        if (projected.z >= 1) {
          label.element.style.opacity = "0"

          return
        }

        placed.push({
          label,
          x: ((projected.x + 1) / 2) * root.clientWidth,
          y: ((1 - projected.y) / 2) * root.clientHeight,
          mesh,
        })
      })
      placed.sort((a, b) => a.y - b.y)
      const boxes: LabelBox[] = []
      placed.forEach((item) => {
        const width = Math.min(160, (item.label.element.textContent?.length ?? 4) * 5.6 + 8)
        let top = item.y

        for (const box of boxes) {
          const overlapsX = item.x + width / 2 > box.left && item.x - width / 2 < box.right
          const overlapsY = top + 12 > box.top && top < box.bottom

          if (overlapsX && overlapsY) top = box.bottom + 3
        }

        top = Math.min(top, root.clientHeight - 14)
        boxes.push({ left: item.x - width / 2, right: item.x + width / 2, top, bottom: top + 12 })
        item.label.element.style.opacity = "1"
        item.label.element.style.left = `${item.x}px`
        item.label.element.style.top = `${top}px`
      })
    }

    const start = () => {
      if (frame !== 0 || !onScreen || document.visibilityState !== "visible") return
      active = true
      frame = requestAnimationFrame(render)
    }

    const stop = () => {
      active = false

      if (frame !== 0) cancelAnimationFrame(frame)
      frame = 0
    }

    start()

    const observer = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting)

      if (onScreen && document.visibilityState === "visible") start()
      else stop()
    })

    observer.observe(root)

    const onVisibility = () => {
      if (document.visibilityState === "visible" && onScreen) start()
      else stop()
    }

    document.addEventListener("visibilitychange", onVisibility)

    const resize = () => {
      const width = root.clientWidth
      const height = root.clientHeight

      if (width === 0 || height === 0) return
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }

    const resizer = new ResizeObserver(resize)
    resizer.observe(root)
    resize()

    onCleanup(() => {
      stop()
      observer.disconnect()
      resizer.disconnect()
      document.removeEventListener("visibilitychange", onVisibility)
      controls.dispose()
      labels.forEach((label) => label.element.remove())
      scaleElement.remove()
      geometries.forEach((geometry) => geometry.dispose())
      materials.forEach((material) => material.dispose())
      renderer.forceContextLoss()
      renderer.dispose()
      renderer.domElement.remove()
    })
  })

  return (
    <VisualFrame
      spec={props.spec}
      onReset={() => {
        setExplode(initialExplode)
        setSpin(false)
        reset?.()
      }}
      tools={
        <IconButton label="Reset view" onClick={() => reset?.()}>
          <ViewIcon />
        </IconButton>
      }
      stage={
        <div class="vz-assembly">
          <div ref={host} style={{ position: "absolute", inset: "0", cursor: "grab" }} />
          <Show when={failed()}>
            <div class="vz-error">
              <strong>3D view is not available.</strong>
              <code>{failed()}</code>
            </div>
          </Show>
        </div>
      }
      controls={
        <>
          <Slider label="Explode" value={explode()} min={0} max={1} step={0.01} format={(value) => `${fmt(value * 100, 0)}%`} onInput={setExplode} />
          <button type="button" class="vz-toggle" aria-pressed={spin()} onClick={() => setSpin((value) => !value)}>
            <span>Orbit</span>
            <b style={{ color: spin() ? "var(--v-accent)" : "var(--v-fg)" }}>{spin() ? "auto" : "manual"}</b>
          </button>
        </>
      }
      readouts={
        <>
          <Readout label="Parts" value={String(parts().length)} />
        </>
      }
      caption={props.spec.caption ?? "Drag to orbit, scroll to zoom. Exploded positions follow each part's assembly direction."}
    />
  )
}

function resolveColor(host: HTMLElement, token: string): string {
  const probe = document.createElement("span")
  probe.style.color = `var(${token})`
  probe.style.display = "none"
  host.appendChild(probe)
  const value = getComputedStyle(probe).color
  probe.remove()

  const canvas = document.createElement("canvas")
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext("2d")

  if (!context) return value

  context.fillStyle = value
  context.fillRect(0, 0, 1, 1)
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data

  return `rgb(${red}, ${green}, ${blue})`
}

function gearGeometry(part: Part): THREE.ExtrudeGeometry {
  const teeth = Math.round(part.teeth)
  const module = part.module
  const pitch = (module * teeth) / 2
  const addendum = module
  const dedendum = module * 1.25
  const profile = new THREE.Shape()
  const step = (Math.PI * 2) / teeth

  for (let index = 0; index < teeth; index += 1) {
    const base = index * step
    const root = pitch - dedendum
    const tip = pitch + addendum

    const points: Array<[number, number]> = [
      [root, base],
      [root, base + step * 0.16],
      [tip, base + step * 0.3],
      [tip, base + step * 0.44],
      [root, base + step * 0.58],
      [root, base + step * 0.98],
    ]

    points.forEach(([radius, angle], pointIndex) => {
      const x = radius * Math.cos(angle)
      const y = radius * Math.sin(angle)

      if (index === 0 && pointIndex === 0) profile.moveTo(x, y)
      else profile.lineTo(x, y)
    })
  }

  profile.closePath()

  if (part.hole > 0) {
    const hole = new THREE.Path()
    hole.absarc(0, 0, part.hole / 2, 0, Math.PI * 2, true)
    profile.holes.push(hole)
  }

  const geometry = new THREE.ExtrudeGeometry(profile, { depth: part.thickness, bevelEnabled: false, curveSegments: 24 })
  geometry.center()
  geometry.rotateY(Math.PI / 2)

  return geometry
}

function bearingGeometry(part: Part): THREE.BufferGeometry {
  const outer = part.size[0] / 2
  const inner = Math.max(1, part.hole > 0 ? part.hole / 2 : outer * 0.55)
  const ring = new THREE.TorusGeometry((outer + inner) / 2, (outer - inner) / 2, 12, 40)
  ring.rotateY(Math.PI / 2)

  return ring
}
