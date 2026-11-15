import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LoadingManager,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Points,
  Quaternion,
  Raycaster,
  Scene,
  ShaderMaterial,
  ShadowMaterial,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"
import { drawScreen, glitchDuration, loadCovers, type CanvasScreenState } from "../arcade/screen-canvas"
import { createCabinet } from "./cabinet"
import { loadGlbCabinet } from "./cabinet-glb"
import { dropOutcome } from "../arcade/flow"
import { coinRadius, coinThickness, createCoin } from "./coin"
import { createCrt } from "./crt"
import { createMoonlight } from "./light"
import { hsv as hsvChannels, tuning } from "./tuning"

/**
 * The 3D arcade: a FLORA-generated photograph of the empty room projected onto a simple proxy of
 * it from the camera that took it (so the camera can move and the room keeps its perspective), the
 * modelled cabinet standing where the photographed one stood, a moonlight shaft with dust in it,
 * and a token to drag into the coin slot. The page (arcade3d.tsx) owns the story; this owns the
 * world, the camera and the coin.
 */

const hsv = (hue: number, saturation: number) => new Color().setRGB(...hsvChannels(hue, saturation), SRGBColorSpace)

export type Quality = "high" | "lite"
export type ViewName = "wide" | "door" | "low" | "climb" | "screen" | "play"
export type ScreenLook = CanvasScreenState | "play" | "off"
export type Rect = { x: number; y: number; w: number; h: number }

export type StageEvents = {
  ready: () => void
  pickup: () => void
  /** The coin was carried over the cabinet; the camera is on its way to the coin door. */
  approach: () => void
  /** The coin is in the slot and gone: a credit. */
  insert: () => void
  /** The coin starts sliding in (for the sound), whether it will be accepted or not. */
  slide: () => void
  land: () => void
  slow: () => void
}

export type StageOptions = {
  canvas: HTMLCanvasElement
  /** The DOM screen (ArcadeScreen), mapped onto the glass with a matrix3d every frame. */
  screen: HTMLElement
  quality: Quality
  reduced: boolean
  events: StageEvents
}

// The photograph's camera, solved from the painted round-8 cabinet (perspective/solve.py): its
// verticals are parallel (no pitch beyond a 0.63° tilt that puts the horizon 42 px below centre),
// a 22.6° vertical field of view (a long lens), eye height 0.92 m, the cabinet 8.4 m away.
const plate = { aspect: 2752 / 1536, fov: 22.614, height: 0.918, pitch: 0.63 }
// The painted cabinet's front-left floor corner (camera at the origin, looking down -z) and yaw.
const placement = { corner: new Vector3(-0.2137, 0, -8.3567), turn: 26.487 }
// The token's resting place on the floor (plate uv), where the photographed coin lay.
const coinHome = { u: 0.585, v: 0.842 }
// The window and the patch of floor its light falls on (plate uv), for the shaft and the moon.
const windowRect = { u0: 0.604, u1: 0.754, v0: 0.006, v1: 0.16 }
const floorPatch = { u0: 0.4, u1: 0.64, v0: 0.74, v1: 0.87 }
const dark = [0.012, 0.02, 0.045] as const

type Pose = { position: Vector3; target: Vector3; up: Vector3 }
type CoinMode = "rest" | "held" | "anim" | "gone"

export async function createStage(options: StageOptions) {
  const { canvas, events } = options
  let quality = options.quality
  const renderer = new WebGLRenderer({ canvas, antialias: quality === "high", powerPreference: "high-performance" })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.2
  renderer.shadowMap.enabled = quality === "high"
  renderer.shadowMap.type = PCFSoftShadowMap
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, quality === "high" ? 2 : 1.25)
  renderer.setPixelRatio(pixelRatio())

  const scene = new Scene()
  const pmrem = new PMREMGenerator(renderer)
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = environment
  scene.environmentIntensity = 0.22
  // Everything the first frame needs; the page keeps its poster up until all of it has arrived.
  const manager = new LoadingManager()
  let assetsReady = false
  // Loads can finish while the cabinet is still loading (before the loop exists): nudge it only once it does.
  let started = false
  const nudge = () => started && wake()
  manager.onLoad = () => {
    assetsReady = true
    nudge()
  }
  const textures = new TextureLoader(manager)
  const disposables: { dispose: () => void }[] = [pmrem, environment]
  const keep = <T extends { dispose: () => void }>(value: T) => {
    disposables.push(value)
    return value
  }

  // ——— The photograph's camera and the room proxy ———

  const projector = new PerspectiveCamera(plate.fov, plate.aspect, 0.05, 80)
  projector.position.set(0, plate.height, 0)
  projector.rotation.x = MathUtils.degToRad(plate.pitch)
  projector.updateMatrixWorld()
  projector.updateProjectionMatrix()
  const projection = new Matrix4().multiplyMatrices(projector.projectionMatrix, projector.matrixWorldInverse)

  const floorAt = (u: number, v: number) => {
    const point = new Vector3(u * 2 - 1, 1 - v * 2, 0.5).unproject(projector)
    const direction = point.sub(projector.position).normalize()
    return projector.position.clone().addScaledVector(direction, -projector.position.y / direction.y)
  }
  const wallZ = floorAt(0.5, 0.68).z - 0.6
  const wallAt = (u: number, v: number) => {
    const point = new Vector3(u * 2 - 1, 1 - v * 2, 0.5).unproject(projector)
    const direction = point.sub(projector.position).normalize()
    return projector.position.clone().addScaledVector(direction, (wallZ - projector.position.z) / direction.z)
  }

  const roomMap = textures.load(
    window.innerWidth * (window.devicePixelRatio || 1) > 2200 && quality === "high"
      ? "/arcade3d/room-2752.webp"
      : "/arcade3d/room-1600.webp",
    () => {
      roomReady = true
      nudge()
    },
  )
  roomMap.colorSpace = SRGBColorSpace
  roomMap.anisotropy = renderer.capabilities.getMaxAnisotropy()
  keep(roomMap)
  let roomReady = false
  const roomMaterial = keep(
    new ShaderMaterial({
      uniforms: {
        map: { value: roomMap },
        projection: { value: projection },
        dark: { value: new Vector3(...dark) },
        exposure: { value: 1 },
        contrast: { value: 1 },
        saturation: { value: 1 },
        hue: { value: 0 },
        balance: { value: new Vector3(1, 1, 1) },
        black: { value: 0 },
        vignette: { value: 0 },
        resolution: { value: new Vector2(1, 1) },
        defocus: { value: 0 },
        glowAt: { value: new Vector3() },
        glowColor: { value: new Color() },
        glowRadius: { value: 2.2 },
        glowFalloff: { value: 2 },
        spillAt: { value: new Vector3() },
        spillColor: { value: new Color() },
        spillRadius: { value: 3.2 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying vec3 vNormal;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform mat4 projection;
        uniform vec3 dark;
        uniform float exposure;
        uniform float contrast;
        uniform float saturation;
        uniform float hue;
        uniform vec3 balance;
        uniform float black;
        uniform float vignette;
        uniform vec2 resolution;
        uniform float defocus;
        uniform vec3 glowAt;
        uniform vec3 glowColor;
        uniform float glowRadius;
        uniform float glowFalloff;
        uniform vec3 spillAt;
        uniform vec3 spillColor;
        uniform float spillRadius;
        varying vec3 vWorld;
        varying vec3 vNormal;
        vec3 hueShift(vec3 c, float a) {
          const mat3 toYiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
          const mat3 toRgb = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
          vec3 yiq = toYiq * c;
          float angle = atan(yiq.z, yiq.y) + a;
          float chroma = length(yiq.yz);
          return toRgb * vec3(yiq.x, chroma * cos(angle), chroma * sin(angle));
        }
        float reach(vec3 at, float radius, float falloff, vec3 n) {
          vec3 to = at - vWorld;
          float d = length(to);
          return pow(clamp(1.0 - d / radius, 0.0, 1.0), falloff) * (0.35 + 0.65 * abs(dot(n, to / max(d, 1e-4))));
        }
        void main() {
          vec4 clip = projection * vec4(vWorld, 1.0);
          vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
          vec2 edge = smoothstep(vec2(-0.02), vec2(0.03), uv) * smoothstep(vec2(1.02), vec2(0.97), uv);
          float inside = clip.w > 0.0 ? edge.x * edge.y : 0.0;
          // Close up, the room falls out of focus (and the projection's stretching with it).
          vec3 color = texture2D(map, clamp(uv, 0.001, 0.999), defocus * 4.5).rgb;
          // The machine's own light on the room: the plate brightens where it reaches.
          vec3 n = normalize(vNormal);
          vec3 light = glowColor * reach(glowAt, glowRadius, glowFalloff, n) + spillColor * reach(spillAt, spillRadius, 2.0, n);
          color = color * (1.0 + light * 3.0) + light * 0.04;
          // The grade.
          color *= exposure * balance;
          color = hueShift(color, hue);
          float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
          color = max(mix(vec3(luma), color, saturation), 0.0);
          color = pow(color / 0.18, vec3(contrast)) * 0.18;
          color = max(color + black, 0.0);
          vec2 screen = gl_FragCoord.xy / resolution - 0.5;
          color *= 1.0 - vignette * smoothstep(0.25, 0.75, length(screen * vec2(resolution.x / resolution.y, 1.0)) / max(1.0, resolution.x / resolution.y) * 1.2);
          color *= 1.0 - defocus * 0.4;
          gl_FragColor = vec4(mix(dark, color, inside), 1.0);
          #include <colorspace_fragment>
        }
      `,
      side: DoubleSide,
      toneMapped: false,
      depthWrite: true,
    }),
  )
  const room = new Group()
  const plane = (w: number, h: number) => keep(new PlaneGeometry(w, h))
  const floor = new Mesh(plane(80, 80), roomMaterial)
  floor.rotation.x = -Math.PI / 2
  const wall = new Mesh(plane(60, 20), roomMaterial)
  wall.position.set(0, 7, wallZ)
  const left = new Mesh(plane(Math.abs(wallZ) + 6, 20), roomMaterial)
  left.rotation.y = Math.PI / 2
  left.position.set(-2.9, 7, wallZ / 2 + 3)
  const right = left.clone()
  right.rotation.y = -Math.PI / 2
  right.position.x = 2.9
  const ceiling = new Mesh(plane(80, 80), roomMaterial)
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.y = 5
  room.add(floor, wall, left, right, ceiling)
  room.renderOrder = -1
  scene.add(room)

  // ——— The cabinet ———

  // A pre-made GLB cabinet when public/arcade3d/cabinet.glb exists (cabinet-glb.ts), else the procedural one.
  const cabinet =
    (await loadGlbCabinet(manager, renderer, { shadows: quality === "high", lite: quality !== "high" }).catch(
      (error: unknown) => {
        console.warn("arcade3d: cabinet.glb failed, using the procedural cabinet", error)
        return undefined
      },
    )) ?? createCabinet(textures, renderer.capabilities.getMaxAnisotropy(), quality === "high")
  const parts = cabinet.parts
  const size = cabinet.size
  disposables.push(cabinet)
  const turn = MathUtils.degToRad(placement.turn)
  const facing = new Vector3(Math.sin(turn), 0, Math.cos(turn))
  cabinet.group.rotation.y = turn
  cabinet.group.position
    .copy(placement.corner)
    .sub(new Vector3(-size.width / 2, 0, parts.frontZ).applyAxisAngle(new Vector3(0, 1, 0), turn))
  scene.add(cabinet.group)
  cabinet.group.updateMatrixWorld()
  const local = (x: number, y: number, z: number) => cabinet.group.localToWorld(new Vector3(x, y, z))
  const localDirection = (vector: Vector3) => vector.clone().applyQuaternion(cabinet.group.quaternion)
  const right3 = localDirection(new Vector3(1, 0, 0))

  // Contact shadow and the screen's glow on the floor, in the cabinet's frame.
  const contact = new Mesh(
    plane(1.25, 1.05),
    keep(
      new MeshBasicMaterial({
        map: keep(gradientTexture("contact")),
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    ),
  )
  contact.rotation.x = -Math.PI / 2
  contact.position.set(0, 0.002, 0.03)
  cabinet.group.add(contact)

  // ——— Light ———

  const windowCentre = wallAt((windowRect.u0 + windowRect.u1) / 2, (windowRect.v0 + windowRect.v1) / 2)
  const patchCentre = floorAt((floorPatch.u0 + floorPatch.u1) / 2, (floorPatch.v0 + floorPatch.v1) / 2)
  const ambient = new HemisphereLight(0x4a6cb8, 0x070a14, 0.9)
  scene.add(ambient)
  // A cool fill from the camera's side, standing in for the moonlight bounced off the floor.
  const fill = new DirectionalLight(0x5b7fd0, 0.55)
  fill.position.copy(projector.position).add(new Vector3(-1.5, 0.4, 0.5))
  fill.target.position.copy(cabinet.group.position)
  scene.add(fill, fill.target)
  const moon = new DirectionalLight(0xa9c6ff, 1.5)
  moon.position.copy(windowCentre)
  moon.target.position.copy(cabinet.group.position)
  moon.castShadow = quality === "high"
  moon.shadow.mapSize.set(1024, 1024)
  moon.shadow.camera.left = -2
  moon.shadow.camera.right = 2
  moon.shadow.camera.top = 2.5
  moon.shadow.camera.bottom = -2.5
  moon.shadow.camera.near = 1
  moon.shadow.camera.far = 20
  moon.shadow.bias = -0.0008
  moon.shadow.radius = 10
  moon.shadow.blurSamples = 16
  scene.add(moon, moon.target)
  const rim = new DirectionalLight(0x3d6dff, 1.1)
  rim.position.copy(local(-2.5, 2.2, -1.2))
  rim.target.position.copy(cabinet.group.position)
  scene.add(rim, rim.target)
  const glass = parts.glass
  const screenLight = new PointLight(0x3c7dff, 0, 3.2, 1.6)
  screenLight.position.copy(
    local(0, glass.centre.y, glass.centre.z).addScaledVector(localDirection(glass.normal), 0.35),
  )
  const slotLight = new PointLight(0x2f7bff, 0, 0.5, 2)
  slotLight.position.copy(local(0, parts.slot.y, parts.doorZ + 0.06))
  const marqueeLight = new PointLight(0x5aa2ff, 0, 1.6, 2)
  marqueeLight.position.copy(local(0, 1.7, parts.marquee.bottom.z + 0.4))
  // The machine's overall blue cast on the floor and what stands near it.
  const glowLight = new PointLight(0x2f6bff, 0, 2.2, 2)
  glowLight.position.copy(local(0, 0.45, parts.doorZ + 0.45))
  scene.add(screenLight, slotLight, marqueeLight, glowLight)
  roomMaterial.uniforms.glowAt.value.copy(local(0, 0.35, parts.doorZ + 0.3))
  roomMaterial.uniforms.spillAt.value.copy(screenLight.position)

  const shadowCatcher = new Mesh(plane(5, 5), keep(new ShadowMaterial({ color: 0x000510, opacity: 0.5 })))
  shadowCatcher.rotation.x = -Math.PI / 2
  shadowCatcher.position.copy(cabinet.group.position).setY(0.001)
  shadowCatcher.receiveShadow = true
  // After the moonlight pool, so the cabinet's shadow darkens it.
  shadowCatcher.renderOrder = 2
  // The shadow map only shades the cabinet itself; on the floor a soft, analytic shadow stands in:
  // dense at the base, fading and widening away from it along the moonlight (a soft penumbra).
  shadowCatcher.visible = false
  scene.add(shadowCatcher)
  const floorShadowMaterial = keep(
    new ShaderMaterial({
      uniforms: { strength: { value: 0.55 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float strength;
        varying vec2 vUv;
        void main() {
          float along = vUv.x;
          float across = abs(vUv.y * 2.0 - 1.0);
          float width = mix(0.42, 0.95, along);
          float body = smoothstep(width, width * mix(0.55, 0.05, along), across);
          float fade = pow(1.0 - along, 1.6) * smoothstep(0.0, 0.06, along + 0.04);
          gl_FragColor = vec4(0.0, 0.004, 0.012, body * fade * strength);
        }
      `,
      transparent: true,
      depthWrite: false,
    }),
  )
  const floorShadow = new Mesh(plane(1, 1), floorShadowMaterial)
  floorShadow.renderOrder = 2
  scene.add(floorShadow)
  const placeFloorShadow = (direction: Vector3, strength: number) => {
    // direction: where the light travels. Its run along the floor sets the shadow's length.
    const flat = new Vector3(direction.x, 0, direction.z)
    const run = flat.length() / Math.max(0.15, -direction.y)
    flat.normalize()
    const length = Math.min(3.5, Math.max(0.8, size.height * run * 0.9))
    floorShadow.scale.set(length, 1.4, 1)
    floorShadow.rotation.set(-Math.PI / 2, 0, Math.atan2(-flat.z, flat.x))
    floorShadow.position
      .copy(cabinet.group.position)
      .addScaledVector(flat, length / 2 - 0.2)
      .setY(0.0025)
    floorShadowMaterial.uniforms.strength.value = strength
  }

  // ——— The CRT ———

  const crt = createCrt(renderer, {
    width: glass.width,
    height: glass.height,
    size: quality === "high" ? 1024 : 768,
    room: roomMap,
    glare: localDirection(new Vector3(0.25, 0.95, 0.35)),
    reduced: options.reduced,
  })
  disposables.push(crt)
  if (cabinet.screen) cabinet.screen.material = crt.mesh.material
  else {
    crt.mesh.position.copy(glass.centre)
    crt.mesh.up.copy(glass.up)
    crt.mesh.lookAt(glass.centre.clone().add(glass.normal))
    cabinet.group.add(crt.mesh)
  }
  // Halation spilling past the glass onto the bezel.
  const halo = new Mesh(
    plane(glass.width * 1.55, glass.height * 1.7),
    keep(
      new MeshBasicMaterial({
        map: keep(gradientTexture("glow")),
        color: 0x2a64ff,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    ),
  )
  halo.position.copy(glass.centre).addScaledVector(glass.normal, 0.03)
  halo.up.copy(glass.up)
  halo.lookAt(halo.position.clone().add(glass.normal))
  cabinet.group.add(halo)

  let covers: (HTMLImageElement | undefined)[] = []
  void loadCovers().then((images) => {
    covers = images
    screenDirty = true
    nudge()
  })
  let look: ScreenLook = "404"
  let lookSince = performance.now()
  let active = 0
  let screenDirty = true
  let lastScreenDraw = 0
  let brightness = 0.8
  let power = 0

  const drawCrt = (now: number) => {
    const context = crt.context
    if (!context) return
    // The menu's highlight follows the DOM screen's focused or hovered tile.
    if (look === "select") {
      const tiles = [...options.screen.querySelectorAll('[data-slot="tile"]')]
      const index = tiles.findIndex((tile) => tile.hasAttribute("data-active"))
      if (index >= 0 && index !== active) {
        active = index
        screenDirty = true
      }
    }
    const animated = look === "404" || look === "glitch" || look === "boot" || look === "start" || look === "select"
    if (!screenDirty && (!animated || now - lastScreenDraw < 33)) return
    lastScreenDraw = now
    screenDirty = false
    if (look === "play" || look === "off") {
      context.fillStyle = "#000"
      context.fillRect(0, 0, crt.canvas.width, crt.canvas.height)
    } else {
      drawScreen(context, crt.canvas.width, crt.canvas.height, {
        state: look,
        time: options.reduced ? Number.MAX_SAFE_INTEGER / 2 : now - lookSince,
        active,
        covers,
        reduced: options.reduced,
      })
    }
    crt.touch()
  }
  // ——— Moonlight shaft and dust ———

  const moonlight = createMoonlight(scene, {
    window: [
      wallAt(windowRect.u0, windowRect.v0),
      wallAt(windowRect.u1, windowRect.v0),
      wallAt(windowRect.u1, windowRect.v1),
      wallAt(windowRect.u0, windowRect.v1),
    ],
    // The window's top edge lights the near edge of the patch, its bottom edge the far one.
    patch: [
      floorAt(floorPatch.u0, floorPatch.v1),
      floorAt(floorPatch.u1, floorPatch.v1),
      floorAt(floorPatch.u1, floorPatch.v0),
      floorAt(floorPatch.u0, floorPatch.v0),
    ],
    quality,
  })
  disposables.push(moonlight)
  const cameraVelocity = new Vector3()
  const lastCamera = new Vector3()
  const disturbVelocity = new Vector3()
  let fps = 60
  let slowFrames = 0
  // ——— The token ———

  const token = createCoin(textures, quality === "high")
  disposables.push(token)
  const coin = token.group
  scene.add(coin, token.shadow)
  // A little light travels with the coin, so it catches the eye and lights the door as it nears.
  const coinLight = new PointLight(0xcfe0ff, 0, 0.35, 2)
  coinLight.position.set(0, 0.05, 0.05)
  coin.add(coinLight)
  const home = floorAt(coinHome.u, coinHome.v).setY(coinThickness / 2)
  const homeTurn = 0.6
  coin.position.copy(home)
  coin.rotation.y = homeTurn

  // ——— Camera ———

  const camera = new PerspectiveCamera(plate.fov, 16 / 9, 0.02, 80)
  const viewport = { width: 1, height: 1 }
  // The wide shot keeps the photograph's lens; close-ups use the (tunable) close-up lens.
  let plateFov = plate.fov
  const fovFor = (name: ViewName) => (name === "wide" ? plateFov : tuning.camera.fov)
  const halfTan = () => Math.tan(MathUtils.degToRad(fovFor(view) / 2))
  const focal = () => viewport.height / 2 / halfTan()
  const focalNow = () => viewport.height / 2 / Math.tan(MathUtils.degToRad(camera.fov / 2))
  const pose: Pose = { position: new Vector3(), target: new Vector3(), up: new Vector3(0, 1, 0) }
  const goal: Pose = { position: new Vector3(), target: new Vector3(), up: new Vector3(0, 1, 0) }
  let speed = 3
  let view: ViewName = "wide"
  let playArea: Rect = { x: 0, y: 0, w: 1, h: 1 }

  const poseFor = (name: ViewName): Pose => {
    const aspect = viewport.width / viewport.height
    if (name === "wide") {
      const direction = new Vector3(0, Math.sin(MathUtils.degToRad(plate.pitch)), -1).normalize()
      return {
        position: projector.position.clone(),
        target: projector.position.clone().addScaledVector(direction, cabinet.group.position.length()),
        up: new Vector3(0, 1, 0),
      }
    }
    if (name === "door" || name === "low" || name === "climb") {
      const frame = {
        door: { y: 0.6, h: 0.62, w: 0.5 },
        low: { y: 0.3, h: 1.05, w: 0.9 },
        climb: { y: 1.05, h: 0.9, w: 0.9 },
      }[name]
      const distance = Math.max(frame.h / 2 / halfTan(), frame.w / 2 / (halfTan() * aspect))
      return {
        position: local(0, frame.y + 0.04, parts.doorZ + distance),
        target: local(0, frame.y, parts.doorZ),
        up: new Vector3(0, 1, 0),
      }
    }
    const centre = local(glass.centre.x, glass.centre.y, glass.centre.z)
    const normal = localDirection(glass.normal)
    const up = localDirection(glass.up)
    if (name === "screen") {
      // Phones frame the glass alone, so the menu stays legible.
      const distance = Math.max(0.66 / 2 / halfTan(), (aspect < 1 ? 0.56 : 0.86) / 2 / (halfTan() * aspect))
      return { position: centre.clone().addScaledVector(normal, distance), target: centre, up }
    }
    // Play: straight on, the glass filling the play area exactly.
    const distance = Math.max((glass.width * focal()) / playArea.w, (glass.height * focal()) / playArea.h)
    const offsetX = ((playArea.x + playArea.w / 2 - viewport.width / 2) * distance) / focal()
    const offsetY = ((playArea.y + playArea.h / 2 - viewport.height / 2) * distance) / focal()
    const shift = right3.clone().multiplyScalar(-offsetX).addScaledVector(up, offsetY)
    return {
      position: centre.clone().addScaledVector(normal, distance).add(shift),
      target: centre.clone().add(shift),
      up,
    }
  }

  const go = (name: ViewName, rate = 2.6) => {
    view = name
    speed = rate * tuning.camera.speed
    const next = poseFor(name)
    goal.position.copy(next.position)
    goal.target.copy(next.target)
    goal.up.copy(next.up)
    if (options.reduced) jump()
    wake()
  }
  const jump = () => {
    pose.position.copy(goal.position)
    pose.target.copy(goal.target)
    pose.up.copy(goal.up)
  }

  const applyCamera = () => {
    camera.position.copy(pose.position)
    camera.up.copy(pose.up)
    camera.lookAt(pose.target)
    camera.updateMatrixWorld()
  }

  // ——— Coin behaviour ———

  let coinMode: CoinMode = "rest"
  const pointer = new Vector2()
  const raycaster = new Raycaster()
  let holdDistance = 2
  let holdAtDoor = false
  const coinGoal = new Vector3()
  const velocity = new Vector3()
  let previous = new Vector3()
  let pull = 0
  let animation: { start: number; steps: ((t: number) => void)[]; durations: number[]; done: () => void } | undefined
  const doorPoint = () => local(0, parts.slot.y, parts.doorZ + 0.03)
  const slotPoint = () => local(0, parts.slot.y, parts.doorZ + 0.008)

  const rayAt = (x: number, y: number) => {
    raycaster.setFromCamera(new Vector2((x / viewport.width) * 2 - 1, -(y / viewport.height) * 2 + 1), camera)
    return raycaster.ray
  }
  const toScreen = (point: Vector3) => {
    const ndc = point.clone().project(camera)
    return { x: (ndc.x + 1) * 0.5 * viewport.width, y: (1 - ndc.y) * 0.5 * viewport.height, behind: ndc.z > 1 }
  }

  const hitCoin = (x: number, y: number) => {
    if (coinMode !== "rest") return false
    const at = toScreen(coin.position)
    const radius = (coinRadius * focalNow()) / camera.position.distanceTo(coin.position)
    return Math.hypot(at.x - x, at.y - y) < Math.max(30, radius * 2.2)
  }

  const overCabinet = (x: number, y: number) => {
    raycaster.setFromCamera(new Vector2((x / viewport.width) * 2 - 1, -(y / viewport.height) * 2 + 1), camera)
    return raycaster.intersectObjects(cabinet.body, false).length > 0
  }

  const facingCamera = () => camera.position.clone().sub(coin.position).normalize()
  const orientCoin = (axis: Vector3, rate: number, dt: number) => {
    const target = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis.clone().normalize())
    coin.quaternion.slerp(target, 1 - Math.exp(-rate * dt))
  }

  const updateHeld = (dt: number) => {
    const ray = rayAt(pointer.x, pointer.y)
    if (holdAtDoor) {
      // The coin moves on a plane just in front of the coin door, and the slot pulls it in.
      const normal = facing
      const origin = doorPoint()
      const denominator = ray.direction.dot(normal)
      const hit =
        Math.abs(denominator) > 1e-4
          ? ray.origin.clone().addScaledVector(ray.direction, origin.clone().sub(ray.origin).dot(normal) / denominator)
          : origin
      const distance = hit.distanceTo(origin)
      pull = smoothstep(0.08, 0.018, distance)
      coinGoal.copy(hit).lerp(origin, pull * 0.75)
    } else {
      pull = 0
      holdDistance = MathUtils.lerp(holdDistance, 1.5, 1 - Math.exp(-4 * dt))
      coinGoal.copy(ray.origin).addScaledVector(ray.direction, holdDistance)
    }
    previous.copy(coin.position)
    coin.position.lerp(coinGoal, 1 - Math.exp(-22 * dt))
    if (dt > 0) velocity.copy(coin.position).sub(previous).divideScalar(dt)
    // Face the camera (or the door), tilting with the drag; edge-on as it nears the slot.
    // Held at a slight angle, so the coin's thickness and reeded edge show.
    const base = (holdAtDoor ? facing.clone() : facingCamera())
      .add(right3.clone().multiplyScalar(0.55))
      .add(new Vector3(0, 0.3, 0))
    const lean = new Vector3(velocity.x, velocity.y, 0).multiplyScalar(holdAtDoor ? 0.6 : 0.25)
    const axis = base
      .add(new Vector3(lean.x, lean.y, 0))
      .normalize()
      .lerp(right3, pull)
      .normalize()
    orientCoin(axis, 14, dt)
  }

  // Into the slit edge-on, then in through the door, gone: a credit.
  const slideIn = () => {
    coinMode = "anim"
    const start = coin.position.clone()
    const startQuaternion = coin.quaternion.clone()
    const edgeOn = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), right3)
    const mouth = slotPoint()
    const inside = mouth.clone().addScaledVector(facing, -0.05)
    animation = {
      start: performance.now(),
      durations: options.reduced ? [1, 1] : [170, 340],
      steps: [
        (t) => {
          const e = 1 - Math.pow(1 - t, 3)
          coin.position.lerpVectors(start, mouth, e)
          coin.quaternion.slerpQuaternions(startQuaternion, edgeOn, e)
          if (t >= 1) events.slide()
        },
        (t) => {
          coin.position.lerpVectors(mouth, inside, t * t)
          coin.quaternion.copy(edgeOn)
        },
      ],
      done: () => {
        coin.visible = false
        coinMode = "gone"
        events.insert()
      },
    }
    wake()
  }

  // Let go away from the machine: the coin settles back where it lay, in a short arc.
  const settleHome = () => {
    coinMode = "anim"
    const start = coin.position.clone()
    const startQuaternion = coin.quaternion.clone()
    const rest = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), homeTurn)
    animation = {
      start: performance.now(),
      durations: [options.reduced ? 1 : 520],
      steps: [
        (t) => {
          const e = t < 0.8 ? (t / 0.8) ** 2 : 1 - Math.sin(((t - 0.8) / 0.2) * Math.PI) * 0.03
          coin.position
            .lerpVectors(start, home, Math.min(1, e))
            .add(new Vector3(0, Math.sin(Math.min(1, t / 0.8) * Math.PI) * 0.12, 0))
          coin.quaternion.slerpQuaternions(startQuaternion, rest, Math.min(1, t * 1.4))
        },
      ],
      done: () => {
        coin.position.copy(home)
        coin.quaternion.copy(rest)
        coinMode = "rest"
        events.land()
      },
    }
    wake()
  }

  // The coin's soft shadow on whatever is behind or under it: the door while at the door, else the floor.
  const placeCoinShadow = () => {
    const shadow = token.shadow
    if (!coin.visible) {
      shadow.visible = false
      return
    }
    shadow.visible = true
    const front = local(0, 0, parts.doorZ + 0.0075)
    const toDoor = coin.position.clone().sub(front).dot(facing)
    if (holdAtDoor && coinMode !== "rest" && toDoor > -0.01 && toDoor < 0.4) {
      shadow.position.copy(coin.position).addScaledVector(facing, -toDoor + 0.001)
      shadow.lookAt(shadow.position.clone().add(facing))
      shadow.scale.setScalar(coinRadius * (3 + toDoor * 30))
      ;(shadow.material as MeshBasicMaterial).opacity = 0.55 * (1 - smoothstep(0, 0.25, toDoor))
      return
    }
    const height = Math.max(0, coin.position.y - coinThickness / 2)
    shadow.position.set(coin.position.x, 0.003, coin.position.z)
    shadow.rotation.set(-Math.PI / 2, 0, 0)
    shadow.scale.setScalar(coinRadius * (2.6 + height * 12))
    ;(shadow.material as MeshBasicMaterial).opacity = 0.5 * (1 - smoothstep(0, 1.2, height))
  }

  const stepAnimation = (now: number) => {
    if (!animation) return
    let elapsed = now - animation.start
    for (const [index, duration] of animation.durations.entries()) {
      if (elapsed < duration) return animation.steps[index](elapsed / duration)
      animation.steps[index](1)
      elapsed -= duration
    }
    const done = animation.done
    animation = undefined
    done()
  }

  // ——— Quality ———

  // "auto" keeps what the page chose (high, or lite on phones); the panel can force a level.
  let qualityLevel: "high" | "medium" | "low" = quality === "high" ? "high" : "medium"
  let appliedQuality = ""
  const applyQuality = () => {
    const setting = tuning.quality
    const level = setting === "auto" ? (quality === "high" ? "high" : "medium") : setting
    if (level === appliedQuality) return
    appliedQuality = level
    qualityLevel = level
    const shadows = level === "high"
    renderer.shadowMap.enabled = shadows
    moon.castShadow = shadows
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, { high: 2, medium: 1.5, low: 1 }[level]))
    renderer.setSize(viewport.width, viewport.height, false)
  }

  // ——— Loop ———

  let frame = 0
  let last = 0
  let running = true
  let hidden = false
  let readySent = false
  const samples: number[] = []
  const screenOverlay = { visible: false }

  const placeScreen = () => {
    const element = options.screen
    const corners = [
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1],
    ].map(([sx, sy]) =>
      toScreen(
        cabinet.group.localToWorld(
          glass.centre
            .clone()
            .addScaledVector(new Vector3(1, 0, 0), (sx * glass.width) / 2)
            .addScaledVector(glass.up, (sy * glass.height) / 2)
            .addScaledVector(glass.normal, 0.008),
        ),
      ),
    )
    if (!screenOverlay.visible || corners.some((corner) => corner.behind)) {
      element.style.visibility = "hidden"
      return
    }
    element.style.visibility = "visible"
    element.style.transform = homography(element.offsetWidth, element.offsetHeight, corners)
  }

  const tick = (now: number) => {
    frame = 0
    const dt = Math.min(0.05, (now - (last || now)) / 1000)
    last = now
    const t = now / 1000
    // Camera: one critically damped chase toward the goal, retargeted on the way.
    const k = 1 - Math.exp(-speed * dt)
    pose.position.lerp(goal.position, k)
    pose.target.lerp(goal.target, k)
    pose.up.lerp(goal.up, k).normalize()
    const fov = fovFor(view)
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = options.reduced ? fov : MathUtils.lerp(camera.fov, fov, k)
      camera.updateProjectionMatrix()
    }
    applyCamera()
    const moving = pose.position.distanceTo(goal.position) > 0.0005 || pose.target.distanceTo(goal.target) > 0.0005

    coinLight.intensity = MathUtils.lerp(coinLight.intensity, coinMode === "held" ? 0.03 : 0, 1 - Math.exp(-6 * dt))
    if (coinMode === "held") updateHeld(dt)
    stepAnimation(now)

    // The glints ride the real highlight: where the moonlight reflects toward the camera.
    const toCamera = camera.position.clone().sub(coin.position).normalize()
    const toMoon = moonlight.windowCentre.clone().sub(coin.position).normalize()
    const resting = coinMode === "rest"
    token.glint(
      toMoon,
      toCamera,
      options.reduced ? (resting ? 0.6 : 0) : resting ? 1 : 0.5,
      0.012 * Math.max(1, camera.position.distanceTo(coin.position) / 2),
      options.reduced ? 0 : t,
    )
    placeCoinShadow()
    if (coinMode === "held" && !holdAtDoor && !options.reduced)
      coin.rotateOnWorldAxis(new Vector3(0, 1, 0), Math.sin(t * 0.9) * dt * 0.6)

    // Screen, lamps and their light, all from the live settings (tuning.ts).
    const tune = tuning
    applyQuality()
    drawCrt(now)
    const sinceLook = now - lookSince
    const glitch = look === "glitch" && !options.reduced ? Math.max(0, 1 - sinceLook / glitchDuration) : 0
    const flicker = glitch > 0 ? 0.4 + 0.6 * Math.abs(Math.sin(t * 37)) * glitch + (1 - glitch) * 0.6 : 1
    const level = (look === "off" || look === "play" ? 0.15 : brightness) * flicker
    crt.tune(tune.crt)
    crt.render(now, glitch, look === "off" ? 0 : 1)

    const screenColor = hsv(tune.screen.hue, tune.screen.saturation)
    screenLight.color.copy(screenColor)
    screenLight.intensity = level * 1.6 * tune.screen.intensity
    screenLight.distance = tune.screen.radius
    halo.material.color.copy(screenColor)
    halo.material.opacity = level * 0.22 * Math.min(2, tune.screen.intensity)
    const glowColor = hsv(tune.glow.hue, tune.glow.saturation)
    glowLight.color.copy(glowColor)
    glowLight.intensity = (0.3 + 0.7 * level) * 0.9 * tune.glow.intensity
    glowLight.distance = tune.glow.radius
    glowLight.decay = tune.glow.falloff
    const edgeColor = hsv(tune.edges.hue, tune.edges.saturation)
    cabinet.setPower(power, edgeColor, tune.edges.intensity)
    slotLight.color.copy(edgeColor)
    slotLight.intensity = (0.05 + power * 0.25) * tune.edges.intensity
    marqueeLight.color.copy(edgeColor)
    marqueeLight.intensity = power * 0.9 * tune.edges.intensity

    // The room: the machine's light on the plate, the grade and the close-up defocus.
    const room = roomMaterial.uniforms
    room.glowColor.value.copy(glowColor).multiplyScalar((0.3 + 0.7 * level) * 0.32 * tune.glow.intensity)
    room.glowRadius.value = tune.glow.radius
    room.glowFalloff.value = tune.glow.falloff
    room.spillColor.value.copy(screenColor).multiplyScalar(level * 0.12 * tune.screen.intensity)
    room.spillRadius.value = tune.screen.radius
    room.exposure.value = Math.pow(2, tune.room.exposure)
    room.contrast.value = tune.room.contrast
    room.saturation.value = tune.room.saturation
    room.hue.value = MathUtils.degToRad(tune.room.hue)
    room.balance.value.set(
      1 + 0.18 * tune.room.temperature,
      1 + 0.12 * tune.room.tint,
      1 - 0.18 * tune.room.temperature,
    )
    room.black.value = tune.room.black
    room.vignette.value = tune.room.vignette
    room.resolution.value.set(viewport.width * renderer.getPixelRatio(), viewport.height * renderer.getPixelRatio())
    room.defocus.value = smoothstep(0.4, 2.6, camera.position.distanceTo(projector.position)) * tune.room.defocus
    ambient.intensity = 0.9 * tune.room.ambient
    fill.intensity = 0.55 * tune.room.ambient

    // Moonlight: direction, colour, clouds over the moon, and the dust in it.
    const cloud = options.reduced
      ? 1
      : 1 -
        tune.moon.clouds * 0.7 * Math.max(0, Math.sin(t * 0.21) * Math.sin(t * 0.083 + 1.7) + 0.15 * Math.sin(t * 1.3))
    const moonColor = hsv(tune.moon.hue, tune.moon.saturation)
    moonlight.aim(tune.moon.azimuth, tune.moon.elevation, tune.moon.width)
    moon.color.copy(moonColor)
    moon.intensity = 1.5 * tune.moon.key * cloud
    moon.position
      .copy(cabinet.group.position)
      .addScaledVector(moonlight.windowCentre.clone().sub(moonlight.patchCentre).normalize(), 8)
    placeFloorShadow(
      moonlight.patchCentre.clone().sub(moonlight.windowCentre).normalize(),
      0.85 * Math.min(1.5, tune.moon.key) * cloud,
    )
    const dustCap = { high: 20000, medium: 8000, low: 2500 }[qualityLevel]
    moonlight.look({
      color: moonColor,
      shaft: tune.moon.intensity,
      density: tune.moon.density,
      softness: tune.moon.softness,
      pool: tune.moon.pool,
      dust: { ...tune.dust, count: Math.min(dustCap, tune.dust.count) },
    })
    if (dt > 0) cameraVelocity.lerp(camera.position.clone().sub(lastCamera).divideScalar(dt), 1 - Math.exp(-4 * dt))
    lastCamera.copy(camera.position)
    disturbVelocity.lerp(coinMode === "held" ? velocity : new Vector3(), 1 - Math.exp(-3 * dt))
    moonlight.update({
      time: options.reduced ? 0 : t,
      cloud,
      pixelScale: focalNow() * renderer.getPixelRatio(),
      focus: camera.position.distanceTo(pose.target),
      drift: cameraVelocity,
      disturb: { position: coin.position, velocity: disturbVelocity },
    })
    if (dt > 0) fps = MathUtils.lerp(fps, 1 / dt, 0.05)
    // Adaptive resolution: under 45 fps for a while, render fewer pixels (down to 1×); back up when
    // there is room again. Only on "auto" quality, and not while the camera is still settling.
    if (tuning.quality === "auto" && !moving && dt > 0) {
      slowFrames = fps < 45 ? slowFrames + 1 : fps > 58 ? slowFrames - 1 : slowFrames
      const cap = { high: 2, medium: 1.5, low: 1 }[qualityLevel]
      const ratio = renderer.getPixelRatio()
      if (slowFrames > 90 && ratio > 1) {
        renderer.setPixelRatio(Math.max(1, ratio - 0.25))
        renderer.setSize(viewport.width, viewport.height, false)
        slowFrames = 0
      }
      if (slowFrames < -600 && ratio < Math.min(cap, window.devicePixelRatio || 1)) {
        renderer.setPixelRatio(Math.min(cap, ratio + 0.25))
        renderer.setSize(viewport.width, viewport.height, false)
        slowFrames = 0
      }
    }
    renderer.render(scene, camera)
    placeScreen()

    if (roomReady && assetsReady && !readySent) {
      readySent = true
      events.ready()
    }
    // Watch the frame rate for the first couple of seconds; the page drops to lite or 2D.
    if (readySent && samples.length < 90 && dt > 0) {
      samples.push(dt)
      if (samples.length === 90) {
        const average = samples.slice(20).reduce((sum, value) => sum + value, 0) / 70
        if (average > 0.045) events.slow()
      }
    }
    const busy = moving || coinMode === "held" || coinMode === "anim"
    // Playing: the game needs the GPU, so the room holds still once the camera has arrived.
    const idle = view === "play" && !busy
    if (running && !hidden && !idle) wake()
    else last = 0
  }

  const wake = () => {
    if (!frame && running && !hidden) frame = requestAnimationFrame(tick)
  }

  const onVisibility = () => {
    hidden = document.hidden
    wake()
  }
  document.addEventListener("visibilitychange", onVisibility)
  const intersection = new IntersectionObserver(([entry]) => {
    hidden = !entry?.isIntersecting
    wake()
  })
  intersection.observe(canvas)
  started = true

  return {
    resize(width: number, height: number, area: Rect) {
      viewport.width = Math.max(1, width)
      viewport.height = Math.max(1, height)
      playArea = area
      renderer.setPixelRatio(pixelRatio())
      renderer.setSize(viewport.width, viewport.height, false)
      const aspect = viewport.width / viewport.height
      camera.aspect = aspect
      // Wider than the photograph: narrow the vertical field so the room still covers.
      plateFov =
        aspect > plate.aspect
          ? MathUtils.radToDeg(2 * Math.atan((Math.tan(MathUtils.degToRad(plate.fov / 2)) * plate.aspect) / aspect))
          : plate.fov
      camera.fov = fovFor(view)
      camera.updateProjectionMatrix()
      const next = poseFor(view)
      goal.position.copy(next.position)
      goal.target.copy(next.target)
      goal.up.copy(next.up)
      if (!readySent) jump()
      wake()
    },
    go,
    jump: () => {
      jump()
      wake()
    },
    get view() {
      return view
    },
    setScreen(next: ScreenLook, level: number) {
      if (next !== look) {
        look = next
        lookSince = performance.now()
        screenDirty = true
      }
      brightness = level
      wake()
    },
    setActive(index: number) {
      if (index === active) return
      active = index
      screenDirty = true
      wake()
    },
    setOverlay(visible: boolean) {
      screenOverlay.visible = visible
      wake()
    },
    setPower(value: number) {
      power = value
      wake()
    },
    get fps() {
      return fps
    },
    setQuality(next: Quality) {
      quality = next
      appliedQuality = ""
      samples.length = 0
      wake()
    },
    hitCoin,
    /** Pick up the coin if the pointer is on it. */
    grab(x: number, y: number) {
      if (!hitCoin(x, y)) return false
      pointer.set(x, y)
      coinMode = "held"
      holdAtDoor = view !== "wide"
      holdDistance = camera.position.distanceTo(coin.position)
      events.pickup()
      wake()
      return true
    },
    move(x: number, y: number) {
      if (coinMode !== "held") return
      pointer.set(x, y)
      if (!holdAtDoor && overCabinet(x, y)) {
        holdAtDoor = true
        go("door", 2.4)
        events.approach()
      }
      wake()
    },
    /** Let go: on the coin door, the slot takes it from anywhere near (flow.ts dropOutcome); elsewhere it settles back. */
    release(x: number, y: number) {
      if (coinMode !== "held") return
      pointer.set(x, y)
      if (dropOutcome(holdAtDoor && view !== "wide") === "insert") return slideIn()
      settleHome()
    },
    /** Back to the start: the token on the floor, the camera on the wide shot. */
    reset() {
      animation = undefined
      coinMode = "rest"
      holdAtDoor = false
      coin.visible = true
      coin.position.copy(home)
      coin.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), homeTurn)
      go("wide", 2.2)
    },
    powerDown() {
      crt.powerOff()
      wake()
    },
    powerUp() {
      crt.powerOn()
      wake()
    },
    /** Keyboard, touch button and reduced motion: the coin flies itself into the slot. */
    autoInsert() {
      if (coinMode !== "rest") return
      coinMode = "anim"
      go("door", 2.6)
      const start = coin.position.clone()
      const startQuaternion = coin.quaternion.clone()
      animation = {
        start: performance.now(),
        durations: options.reduced ? [1] : [1100],
        steps: [
          (t) => {
            const e = t * t * (3 - 2 * t)
            const front = doorPoint().addScaledVector(facing, 0.05)
            coin.position.lerpVectors(start, front, e).add(new Vector3(0, Math.sin(e * Math.PI) * 0.4, 0))
            coin.quaternion.slerpQuaternions(
              startQuaternion,
              new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), facing),
              e,
            )
          },
        ],
        done: () => slideIn(),
      }
      wake()
    },
    /** Where the coin is on screen, for the accessible coin button. */
    coinOnScreen() {
      return toScreen(coin.position)
    },
    /** Render now and return the frame as a data URL (the first-paint poster is made with this). */
    capture(type = "image/png", quality?: number) {
      renderer.render(scene, camera)
      return canvas.toDataURL(type, quality)
    },
    /** Where the coin slot is on screen (tests and hints). */
    slotOnScreen() {
      return toScreen(slotPoint())
    },
    get coinState() {
      return coinMode
    },
    dispose() {
      running = false
      cancelAnimationFrame(frame)
      document.removeEventListener("visibilitychange", onVisibility)
      intersection.disconnect()
      for (const item of disposables) item.dispose()
      renderer.dispose()
    },
  }
}

export type Stage = Awaited<ReturnType<typeof createStage>>

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** A CSS matrix3d that maps a w × h element onto the quad p0 (top left), p1, p2, p3 (clockwise). */
function homography(w: number, h: number, p: { x: number; y: number }[]) {
  const [p0, p1, p2, p3] = p
  const dx1 = p1.x - p2.x
  const dx2 = p3.x - p2.x
  const dx3 = p0.x - p1.x + p2.x - p3.x
  const dy1 = p1.y - p2.y
  const dy2 = p3.y - p2.y
  const dy3 = p0.y - p1.y + p2.y - p3.y
  const den = dx1 * dy2 - dx2 * dy1 || 1e-9
  const g = (dx3 * dy2 - dx2 * dy3) / den
  const k = (dx1 * dy3 - dx3 * dy1) / den
  const a = p1.x - p0.x + g * p1.x
  const b = p3.x - p0.x + k * p3.x
  const d = p1.y - p0.y + g * p1.y
  const e = p3.y - p0.y + k * p3.y
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, p0.x, p0.y, 0, 1]
  return `matrix3d(${m.map((value) => value.toFixed(8)).join(",")})`
}

// Small generated textures: the contact shadow, a soft glow and the four-point glint.
function gradientTexture(kind: "contact" | "glow" | "star") {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext("2d")
  if (ctx && kind === "contact") {
    ctx.filter = "blur(10px)"
    ctx.fillStyle = "rgba(0,0,0,0.92)"
    ctx.fillRect(22, 24, 84, 80)
  }
  if (ctx && kind === "glow") {
    const fill = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    fill.addColorStop(0, "rgba(255,255,255,1)")
    fill.addColorStop(0.4, "rgba(255,255,255,0.35)")
    fill.addColorStop(1, "rgba(255,255,255,0)")
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, 128, 128)
  }
  if (ctx && kind === "star") {
    const core = ctx.createRadialGradient(64, 64, 0, 64, 64, 22)
    core.addColorStop(0, "rgba(255,255,255,1)")
    core.addColorStop(1, "rgba(255,255,255,0)")
    ctx.fillStyle = core
    ctx.fillRect(0, 0, 128, 128)
    ctx.fillStyle = "rgba(255,255,255,0.9)"
    ctx.beginPath()
    ctx.moveTo(64, 0)
    ctx.lineTo(68, 60)
    ctx.lineTo(128, 64)
    ctx.lineTo(68, 68)
    ctx.lineTo(64, 128)
    ctx.lineTo(60, 68)
    ctx.lineTo(0, 64)
    ctx.lineTo(60, 60)
    ctx.closePath()
    ctx.fill()
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}
