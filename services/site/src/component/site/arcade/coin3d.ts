import { anomalyMark } from "./anomaly-mark"

/**
 * The hybrid 404's token: a silver arcade token stamped with the Anomaly mark, drawn with three.js
 * in a transparent canvas over the painted stills. The image version still decides where the coin
 * is and how it is turned (its 2D pose, in stage pixels); this only draws it. It reflects the room
 * still itself (as an environment map), takes its key light from the painting's moonlit window, the
 * cabinet screen's glow from above and, near the door, the slot lamp. Loaded on demand, so three.js
 * never blocks the first paint.
 */

export type CoinPose = {
  /** Centre, in stage pixels. */
  x: number
  y: number
  /** Diameter, in stage pixels. */
  size: number
  /** The CSS coin's rotations, in degrees: rotateX(tilt) rotateY(turn) rotateZ(spin). */
  tilt: number
  turn: number
  spin: number
  /** A lean in the screen plane, in degrees (clockwise), applied last: lines it up with the slit. */
  roll?: number
  /** 0 lit, 1 in the dark of the slot. */
  dim: number
  visible: boolean
  /** How close it is to the coin door, 0–1: the door's contact shadow and the slot lamp's light. */
  near: number
  /** The slot lamp, in stage pixels. */
  lamp: { x: number; y: number }
}

/** The coin's light (404 arcade › Coin › Light), matched to the room's moon beam by default. */
export type CoinLight = {
  /** Key light colour (linear RGB, 0–1) and intensity, from the direction it comes from (y up). */
  color: [number, number, number]
  intensity: number
  direction: [number, number, number]
  /** How much of the room's reflection lights it (the environment map), 0–3. */
  ambient: number
  /** 0 silver to 1 brass. */
  tint: number
  /** Emissive glow, 0–1 (none by default). */
  glow: number
  /** A cool light from behind on the rim, 0–3. */
  rim: number
}

export async function createCoinLayer(canvas: HTMLCanvasElement, onLoad: () => void) {
  const {
    ACESFilmicToneMapping,
    CanvasTexture,
    CircleGeometry,
    Color,
    CylinderGeometry,
    DirectionalLight,
    EquirectangularReflectionMapping,
    Euler,
    Group,
    LatheGeometry,
    Mesh,
    MeshBasicMaterial,
    MeshPhysicalMaterial,
    PerspectiveCamera,
    PlaneGeometry,
    PMREMGenerator,
    PointLight,
    Quaternion,
    RepeatWrapping,
    Scene,
    SRGBColorSpace,
    TextureLoader,
    Vector2,
    Vector3,
    WebGLRenderer,
  } = await import("three")
  const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js")

  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  const anisotropy = renderer.capabilities.getMaxAnisotropy()

  const scene = new Scene()
  const pmrem = new PMREMGenerator(renderer)
  // A neutral studio until the room still has loaded, then the room itself.
  const studio = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = studio
  scene.environmentIntensity = 0.35
  const disposables: { dispose: () => void }[] = [pmrem, studio, renderer]
  new TextureLoader().load("/arcade404/scene-neutral-960.webp", (texture) => {
    texture.mapping = EquirectangularReflectionMapping
    texture.colorSpace = SRGBColorSpace
    const room = pmrem.fromEquirectangular(texture).texture
    texture.dispose()
    disposables.push(room)
    scene.environment = room
    roomLoaded = true
    scene.environmentIntensity = ambient
    onLoad()
  })

  // The painting's light: moonlight from the window high on the right, a little behind; the cabinet
  // screen's glow from above and in front; the slot lamp once the coin is at the door.
  const moon = new DirectionalLight(0xf2f5f8, 2.4)
  moon.position.set(0.7, 1, -0.35)
  const glow = new DirectionalLight(0xc8e6e0, 0.7)
  glow.position.set(-0.1, 0.8, 0.9)
  const lamp = new PointLight(0xdcefeb, 0, 0, 1.6)
  const rim = new DirectionalLight(0xbfd8ff, 0)
  rim.position.set(-0.6, 0.35, -1)
  scene.add(moon, glow, lamp, rim)
  let roomLoaded = false
  let ambient = 2.4

  const token = silverToken()
  scene.add(token.group, token.floorShadow, token.doorShadow)

  // One stage pixel is one unit on the z = 0 plane; y points up, so stage y is negated.
  const fov = 20
  const camera = new PerspectiveCamera(fov, 1, 1, 10000)
  // The coin's axis is its local y; turn it to face the camera, like the CSS coin at rest.
  const base = new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0))
  const face = new Quaternion()
  const radians = Math.PI / 180

  const silver = token.materials.map((material) => material.color.clone())
  const brass = new Color(0xd6b06a)

  return {
    /** Relights the coin (live from the Settings sliders). */
    setLight(light: CoinLight) {
      moon.color.setRGB(...light.color)
      moon.intensity = light.intensity
      moon.position.set(...light.direction)
      ambient = light.ambient
      if (roomLoaded) scene.environmentIntensity = ambient
      glow.intensity = 0.3 * light.ambient
      rim.intensity = light.rim
      token.materials.forEach((material, index) => {
        material.color.copy(silver[index]).lerp(brass, light.tint)
        material.emissive.setRGB(...light.color).multiplyScalar(light.glow * 0.5)
      })
    },
    resize(width: number, height: number) {
      renderer.setSize(width, height, false)
      const distance = height / 2 / Math.tan((fov / 2) * radians)
      camera.aspect = width / height
      camera.near = distance / 20
      camera.far = distance * 20
      camera.position.set(width / 2, -height / 2, distance)
      camera.lookAt(width / 2, -height / 2, 0)
      camera.updateProjectionMatrix()
    },
    draw(pose: CoinPose) {
      const visible = pose.visible && pose.size > 0.5
      for (const object of [token.group, token.floorShadow, token.doorShadow]) object.visible = visible
      if (visible) {
        const radius = pose.size / 2
        // CSS's y points down, so its X and Z rotations turn the other way here.
        face.setFromEuler(new Euler(-pose.tilt * radians, pose.turn * radians, -pose.spin * radians, "XYZ"))
        // CSS's clockwise is clockwise on screen; three's z points at the camera, so it is negated.
        if (pose.roll) face.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -pose.roll * radians))
        token.group.quaternion.copy(face).multiply(base)
        token.group.position.set(pose.x, -pose.y, 0)
        token.group.scale.setScalar(radius)
        // On the floor: a soft shadow in the coin's own plane, just below it.
        const lying = Math.min(1, Math.max(0, (pose.tilt - 30) / 40))
        token.floorShadow.quaternion.copy(face)
        token.floorShadow.position.set(pose.x - radius * 0.12, -pose.y - radius * 0.14, -radius * 0.4)
        token.floorShadow.scale.setScalar(pose.size * 1.35)
        token.floorShadow.material.opacity = 0.55 * lying * (1 - pose.near) * (1 - pose.dim)
        // At the door: its shadow on the door, cast down and to the left by the moonlight, closing in
        // and darkening as the coin reaches the slot.
        const gap = radius * (0.5 - 0.35 * pose.near)
        token.doorShadow.position.set(pose.x - gap * 0.7, -pose.y - gap, -radius * 1.5)
        token.doorShadow.scale.setScalar(pose.size * (1.5 - 0.25 * pose.near))
        token.doorShadow.material.opacity = 0.6 * pose.near * (1 - pose.dim * 0.5)
        lamp.position.set(pose.lamp.x, -pose.lamp.y, radius * 3)
        lamp.intensity = pose.near * 1.2 * radius * radius
      }
      renderer.toneMappingExposure = 1.1 * (1 - pose.dim * 0.8)
      renderer.render(scene, camera)
    },
    dispose() {
      token.dispose()
      for (const item of disposables) item.dispose()
    },
  }

  /** The token, radius 1 and 0.15 thick (a 25 mm, 1.9 mm token), with its two contact shadows. */
  function silverToken() {
    const owned: { dispose: () => void }[] = []
    const keep = <T extends { dispose: () => void }>(value: T) => {
      owned.push(value)
      return value
    }
    const texture = (source: HTMLCanvasElement, colour = false) => {
      const result = keep(new CanvasTexture(source))
      result.anisotropy = anisotropy
      if (colour) result.colorSpace = SRGBColorSpace
      return result
    }
    const group = new Group()

    // The face: the mark and a bead ring, raised from a satin field. Polished where
    // raised, duller and finely scratched in the field.
    const relief = faceCanvas("#000", "#fff", 3)
    const colour = faceCanvas("#c4c8cc", "#f2f4f6", 1.5)
    const rough = faceCanvas("#6c6c6c", "#383838", 1.5)
    scratch(rough)
    const faceMaterial = keep(
      new MeshPhysicalMaterial({
        color: 0xffffff,
        map: texture(colour, true),
        metalness: 1,
        roughness: 1,
        roughnessMap: texture(rough),
        bumpMap: texture(relief),
        bumpScale: 2.2,
        clearcoat: 0.08,
        clearcoatRoughness: 0.5,
      }),
    )

    // The raised rim on each face and its bevels, polished; the reeded edge round the outside.
    const rimMaterial = keep(new MeshPhysicalMaterial({ color: 0xe2e5e8, metalness: 1, roughness: 0.24 }))
    const reeds = texture(reedCanvas())
    reeds.wrapS = reeds.wrapT = RepeatWrapping
    reeds.repeat.set(150, 1)
    const edgeMaterial = keep(
      new MeshPhysicalMaterial({ color: 0xd2d6da, metalness: 1, roughness: 0.34, bumpMap: reeds, bumpScale: 1.4 }),
    )
    const h = 0.075
    const field = 0.055
    const rim = (side: number) =>
      [
        [0.84, field],
        [0.87, h],
        [0.96, h],
        [1, h - 0.022],
      ].map(([x, y]) => new Vector2(x, side * y))
    group.add(new Mesh(keep(new LatheGeometry(rim(1), 96)), rimMaterial))
    group.add(new Mesh(keep(new LatheGeometry(rim(-1).reverse(), 96)), rimMaterial))
    group.add(new Mesh(keep(new CylinderGeometry(1, 1, (h - 0.022) * 2, 96, 1, true)), edgeMaterial))
    const disc = keep(new CircleGeometry(0.85, 64))
    for (const side of [1, -1]) {
      const mesh = new Mesh(disc, faceMaterial)
      mesh.rotation.x = -side * (Math.PI / 2)
      mesh.position.y = side * field
      if (side === -1) mesh.rotation.z = Math.PI
      group.add(mesh)
    }

    const blob = texture(blobCanvas())
    const shadow = () =>
      new Mesh(
        keep(new PlaneGeometry(1, 1)),
        keep(new MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false, opacity: 0 })),
      )
    const floorShadow = shadow()
    const doorShadow = shadow()
    floorShadow.renderOrder = doorShadow.renderOrder = -1

    return {
      group,
      floorShadow,
      doorShadow,
      materials: [faceMaterial, rimMaterial, edgeMaterial],
      dispose() {
        for (const item of owned) item.dispose()
      },
    }
  }
}

export type CoinLayer = Awaited<ReturnType<typeof createCoinLayer>>

// The face, 1024 px across the disc: `raised` on `field`, softened by `blur` px for the bevels.
function faceCanvas(field: string, raised: string, blur: number) {
  const size = 1024
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = size
  const ctx = canvas.getContext("2d")
  if (!ctx) return canvas
  ctx.fillStyle = field
  ctx.fillRect(0, 0, size, size)
  ctx.filter = `blur(${blur}px)`
  ctx.fillStyle = raised
  ctx.strokeStyle = raised
  const centre = size / 2
  // The bead ring inside the rim.
  ctx.lineWidth = 14
  ctx.beginPath()
  ctx.arc(centre, centre, size * 0.455, 0, Math.PI * 2)
  ctx.stroke()
  // The mark, centred (optically: its weight sits high, so a touch low).
  const mark = size * 0.66
  ctx.save()
  ctx.translate(centre - mark / 2, centre - mark / 2 + size * 0.01 + mark)
  ctx.scale(mark / 7200, -mark / 7200)
  ctx.fill(new Path2D(anomalyMark))
  ctx.restore()
  return canvas
}

// Fine random scratches over the roughness: rougher in the scratch.
function scratch(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  ctx.filter = "none"
  for (let index = 0; index < 320; index++) {
    const x = Math.random() * canvas.width
    const y = Math.random() * canvas.height
    const angle = Math.random() * Math.PI * 2
    const length = 20 + Math.random() * 140
    ctx.strokeStyle = `rgba(200,200,200,${0.15 + Math.random() * 0.35})`
    ctx.lineWidth = Math.random() < 0.85 ? 0.8 : 1.6
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length)
    ctx.stroke()
  }
}

// One reed of the edge, repeated round it.
function reedCanvas() {
  const canvas = document.createElement("canvas")
  canvas.width = 16
  canvas.height = 4
  const ctx = canvas.getContext("2d")
  if (!ctx) return canvas
  const gradient = ctx.createLinearGradient(0, 0, 16, 0)
  gradient.addColorStop(0, "#000")
  gradient.addColorStop(0.5, "#fff")
  gradient.addColorStop(1, "#000")
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 16, 4)
  return canvas
}

// A soft round shadow.
function blobCanvas() {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext("2d")
  if (!ctx) return canvas
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, "rgba(0,0,0,0.9)")
  gradient.addColorStop(0.45, "rgba(0,0,0,0.55)")
  gradient.addColorStop(1, "rgba(0,0,0,0)")
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 128, 128)
  return canvas
}
