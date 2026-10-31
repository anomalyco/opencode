import { createEffect, createSignal, onCleanup, onMount, Show, type Accessor } from "solid-js"
import {
  ACESFilmicToneMapping,
  BoxHelper,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  HemisphereLight,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
  PCFShadowMap,
  PMREMGenerator,
} from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { TransformControls, type TransformControlsMode } from "three/examples/jsm/controls/TransformControls.js"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"
import { createMesh, disposeMesh, syncMesh } from "./geometry"
import type { DesignScene, Vec3 } from "./model"
import "./viewport.css"

export type TransformMode = TransformControlsMode

export type DesignViewportProps = {
  scene: Accessor<DesignScene>
  selectedID: Accessor<string | undefined>
  mode: Accessor<TransformMode>
  onSelect: (id: string | undefined) => void
  onTransformStart: () => void
  onTransform: (id: string, update: { position: Vec3; rotation: Vec3; scale: Vec3 }) => void
}

type ViewportCallbacks = Omit<DesignViewportProps, "scene" | "selectedID" | "mode">

export function DesignViewport(props: DesignViewportProps) {
  const [error, setError] = createSignal<string>()
  const [ready, setReady] = createSignal(false)
  let container!: HTMLDivElement
  let viewport: ReturnType<typeof createViewport> | undefined

  onMount(() => {
    viewport = createViewport(container, {
      onSelect: (id) => props.onSelect(id),
      onTransformStart: () => props.onTransformStart(),
      onTransform: (id, update) => props.onTransform(id, update),
    }, setError)

    if (!viewport) return
    setReady(true)
    viewport.sync(props.scene(), props.selectedID())
    viewport.setMode(props.mode())
  })

  createEffect(() => {
    if (!ready()) return
    viewport?.sync(props.scene(), props.selectedID())
  })

  createEffect(() => {
    if (!ready()) return
    viewport?.setMode(props.mode())
  })

  onCleanup(() => {
    viewport?.dispose()
    viewport = undefined
  })

  return (
    <div ref={container} data-slot="design-viewport" class="relative size-full min-h-0 overflow-hidden">
      <Show when={props.scene().objects.length === 0 && !error()}>
        <div
          data-slot="design-viewport-empty"
          class="pointer-events-none absolute inset-x-0 top-[38%] flex flex-col items-center gap-2 px-6 text-center"
        >
          <span class="text-[13px] leading-5 text-v2-text-text-muted">The stage is empty</span>
          <span class="max-w-[280px] text-[12px] leading-4 text-v2-text-text-faint">
            Add a primitive from the toolbar or describe an object in the prompt below.
          </span>
        </div>
      </Show>
      <Show when={error()}>
        {(message) => (
          <div class="absolute inset-0 flex items-center justify-center bg-v2-background-bg-base p-8">
            <div class="max-w-[360px] text-center">
              <div class="text-[13px] font-medium text-v2-text-text-base">The 3D viewport could not start</div>
              <div class="mt-1 text-[12px] leading-4 text-v2-text-text-muted">{message()}</div>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}

function createViewport(container: HTMLElement, callbacks: ViewportCallbacks, setError: (message: string) => void) {
  const renderer = createRenderer(container, setError)

  if (!renderer) return

  const scene = new Scene()
  const camera = new PerspectiveCamera(42, 1, 0.05, 400)
  camera.position.set(5.2, 4.1, 6.8)
  const content = new Group()
  const grids = createStage()
  const pmrem = new PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const environment = pmrem.fromScene(room, 0.04)
  scene.environment = environment.texture
  scene.environmentIntensity = 0.5
  scene.add(grids.group, content)

  const orbit = new OrbitControls(camera, renderer.domElement)
  orbit.enableDamping = true
  orbit.dampingFactor = 0.08
  orbit.target.set(0, 0.8, 0)
  orbit.minDistance = 1.2
  orbit.maxDistance = 80
  orbit.maxPolarAngle = Math.PI / 2 - 0.02
  orbit.update()

  const transform = new TransformControls(camera, renderer.domElement)
  transform.setSize(0.78)
  transform.setSpace("world")
  const transformHelper = transform.getHelper()
  scene.add(transformHelper)

  const selection = new BoxHelper(new Mesh(), 0x4f7dff)
  selection.visible = false
  selection.material.depthTest = false
  selection.material.transparent = true
  selection.material.opacity = 0.9
  scene.add(selection)

  const meshes = new Map<string, Mesh>()
  const raycaster = new Raycaster()
  const pointer = new Vector2()
  let transformGestureAt = 0
  let transformInteracting = false
  let press: { x: number; y: number; button: number } | undefined
  let disposed = false
  let frame = 0

  transform.addEventListener("dragging-changed", (event) => {
    orbit.enabled = !event.value
  })
  transform.addEventListener("mouseDown", () => {
    transformInteracting = true
    transformGestureAt = performance.now()
    callbacks.onTransformStart()
  })
  transform.addEventListener("mouseUp", () => {
    transformInteracting = false
  })
  transform.addEventListener("objectChange", () => {
    const object = transform.object

    if (!object) return
    const id = object.userData.designId

    if (typeof id !== "string") return
    selection.update()
    callbacks.onTransform(id, {
      position: [object.position.x, object.position.y, object.position.z],
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
      scale: [object.scale.x, object.scale.y, object.scale.z],
    })
  })

  const sync = (next: DesignScene, nextSelectedID: string | undefined) => {
    const present = new Set(next.objects.map((object) => object.id))

    for (const [id, mesh] of meshes) {
      if (present.has(id)) continue
      mesh.removeFromParent()
      disposeMesh(mesh)
      meshes.delete(id)
    }

    for (const object of next.objects) {
      const existing = meshes.get(object.id)

      if (existing) {
        syncMesh(existing, object)
        continue
      }

      const mesh = createMesh(object)
      content.add(mesh)
      meshes.set(object.id, mesh)
    }

    const selected = nextSelectedID ? meshes.get(nextSelectedID) : undefined

    if (selected && selected.visible) {
      selection.setFromObject(selected)
      selection.visible = true

      if (transform.object !== selected) transform.attach(selected)

      return
    }

    selection.visible = false

    if (transform.object) transform.detach()
  }

  const setMode = (mode: TransformMode) => {
    transform.setMode(mode)

    if (transform.object) transformHelper.visible = true
  }

  const pointerPosition = (event: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect()

    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
  }

  const onPointerDown = (event: PointerEvent) => {
    press = { x: event.clientX, y: event.clientY, button: event.button }
  }

  const onPointerUp = (event: PointerEvent) => {
    const start = press

    press = undefined

    if (!start || start.button !== 0 || event.button !== 0) return

    if (transformInteracting || performance.now() - transformGestureAt < 250) return

    if (transform.dragging || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return

    pointerPosition(event)
    raycaster.setFromCamera(pointer, camera)

    const hit = raycaster.intersectObjects(
      [...meshes.values()].filter((mesh) => mesh.visible),
      false,
    )[0]

    const id = hit?.object.userData.designId

    callbacks.onSelect(typeof id === "string" ? id : undefined)
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown)
  renderer.domElement.addEventListener("pointerup", onPointerUp)

  const resize = () => {
    const width = container.clientWidth
    const height = container.clientHeight

    if (width === 0 || height === 0) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  const observer = new ResizeObserver(resize)
  observer.observe(container)
  resize()

  const render = () => {
    if (disposed) return
    frame = requestAnimationFrame(render)
    orbit.update()

    if (selection.visible) selection.update()
    renderer.render(scene, camera)
  }

  render()

  return {
    sync,
    setMode,
    dispose() {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.domElement.removeEventListener("pointerdown", onPointerDown)
      renderer.domElement.removeEventListener("pointerup", onPointerUp)
      transform.detach()
      transform.dispose()
      transformHelper.dispose()
      selection.dispose()
      orbit.dispose()
      scene.environment = null
      environment.dispose()
      room.dispose()
      pmrem.dispose()

      for (const mesh of meshes.values()) disposeMesh(mesh)

      meshes.clear()
      renderer.dispose()
      renderer.domElement.remove()
      grids.dispose()
    },
  }
}

function createRenderer(container: HTMLElement, setError: (message: string) => void) {
  try {
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" })

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(new Color(0x000000), 0)
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFShadowMap
    renderer.domElement.setAttribute("data-slot", "design-viewport-canvas")
    container.append(renderer.domElement)

    return renderer
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : String(cause))
  }
}

function createStage() {
  const group = new Group()
  const hemisphere = new HemisphereLight(0xffffff, 0x3a3f46, 1)
  const key = new DirectionalLight(0xffffff, 2.2)
  const fill = new DirectionalLight(0xbcd2ff, 0.45)

  key.position.set(7, 11, 7)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.left = -14
  key.shadow.camera.right = 14
  key.shadow.camera.top = 14
  key.shadow.camera.bottom = -14
  key.shadow.camera.near = 0.5
  key.shadow.camera.far = 50
  key.shadow.bias = -0.0004
  fill.position.set(-6, 4, -7)

  const grid = new GridHelper(24, 24, 0x9aa0a6, 0x6f757c)
  grid.material.transparent = true
  grid.material.opacity = 0.28
  grid.position.y = 0.001

  const shadowGeometry = new PlaneGeometry(24, 24)
  const shadowMaterial = new ShadowMaterial({ color: 0x000000, opacity: 0.16 })
  const shadow = new Mesh(shadowGeometry, shadowMaterial)
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = -0.002
  shadow.receiveShadow = true

  group.add(hemisphere, key, fill, grid, shadow)

  return {
    group,
    dispose() {
      grid.geometry.dispose()
      grid.material.dispose()
      shadowGeometry.dispose()
      shadowMaterial.dispose()
      group.removeFromParent()
      group.clear()
    },
  }
}
