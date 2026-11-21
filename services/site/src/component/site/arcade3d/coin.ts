import {
  AdditiveBlending,
  CanvasTexture,
  CircleGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type TextureLoader,
  Vector2,
  Vector3,
} from "three"

/**
 * The token: a 30 mm, 2.2 mm thick brass coin. A lathed rim with beveled edges, a reeded edge (a
 * normal map), a few dings and one nick in the rim; recessed faces carrying the round-5 coin art as
 * colour and bump, scratched by a small generated roughness map. Small shared textures only.
 */

export const coinRadius = 0.015
export const coinThickness = 0.0022

export function createCoin(textures: TextureLoader, shadows: boolean) {
  const disposables: { dispose: () => void }[] = []
  const keep = <T extends { dispose: () => void }>(value: T) => {
    disposables.push(value)
    return value
  }
  const group = new Group()

  const scratches = keep(scratchTexture())
  const reeds = keep(reedTexture())
  reeds.wrapS = reeds.wrapT = RepeatWrapping
  reeds.repeat.set(90, 1)
  const faceMap = keep(textures.load("/arcade404/coin-face.webp"))
  faceMap.colorSpace = SRGBColorSpace

  const metal = {
    metalness: 1,
    roughnessMap: scratches,
    envMapIntensity: 2.6,
    clearcoat: 0.15,
    clearcoatRoughness: 0.4,
  }
  const edge = keep(
    new MeshPhysicalMaterial({
      ...metal,
      color: 0xd8b25c,
      roughness: 0.32,
      normalMap: reeds,
      normalScale: new Vector2(0.9, 0.9),
      anisotropy: 0.6,
    }),
  )
  const face = keep(
    new MeshPhysicalMaterial({
      ...metal,
      color: 0xf0d48a,
      map: faceMap,
      bumpMap: faceMap,
      bumpScale: 1.2,
      roughness: 0.4,
      metalness: 0.55,
      envMapIntensity: 3.4,
    }),
  )

  // The rim's half-profile (radius, height), from the top face's recessed field out over the
  // raised rim, down the edge and back in underneath.
  const r = coinRadius
  const h = coinThickness / 2
  const field = h - 0.00025
  const profile = [
    [r * 0.8, field],
    [r * 0.83, h],
    [r * 0.95, h],
    [r, h - 0.0004],
    [r, -h + 0.0004],
    [r * 0.95, -h],
    [r * 0.83, -h],
    [r * 0.8, -field],
  ].map(([x, y]) => new Vector2(x, y))
  const rim = keep(new LatheGeometry(profile, 72))
  // Dings in the rim and one nick: push a few spots of the outer edge inward.
  const position = rim.getAttribute("position")
  const dents = [
    { angle: 0.7, depth: 0.00035, width: 0.12 },
    { angle: 2.4, depth: 0.0002, width: 0.2 },
    { angle: 4.1, depth: 0.0009, width: 0.05 },
  ]
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index)
    const zz = position.getZ(index)
    const radius = Math.hypot(x, zz)
    if (radius < r * 0.9) continue
    const angle = Math.atan2(zz, x) + Math.PI
    const push = dents.reduce((sum, dent) => {
      const d = Math.abs(((angle - dent.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
      return sum + dent.depth * Math.exp(-(d * d) / (dent.width * dent.width))
    }, 0)
    const k = (radius - push) / radius
    position.setX(index, x * k)
    position.setZ(index, zz * k)
  }
  rim.computeVertexNormals()
  const body = new Mesh(rim, edge)
  body.castShadow = shadows
  group.add(body)
  const faceGeometry = keep(new CircleGeometry(r * 0.81, 48))
  for (const side of [1, -1]) {
    const disc = new Mesh(faceGeometry, face)
    disc.rotation.x = -side * (Math.PI / 2)
    disc.position.y = side * field
    if (side === -1) disc.rotation.z = Math.PI
    group.add(disc)
  }

  // Glints: one that rides the rim's highlight, one on the face.
  const star = keep(starTexture())
  const glints = [0, 1].map(() => {
    const sprite = new Sprite(
      keep(
        new SpriteMaterial({
          map: star,
          color: 0xe8f0ff,
          blending: AdditiveBlending,
          depthWrite: false,
          transparent: true,
          toneMapped: false,
        }),
      ),
    )
    sprite.renderOrder = 3
    group.add(sprite)
    return sprite
  })

  // A soft contact shadow, placed by the stage on whatever is under (or behind) the coin.
  const shadow = new Mesh(
    keep(new PlaneGeometry(1, 1)),
    keep(
      new MeshBasicMaterial({
        map: keep(blobTexture()),
        transparent: true,
        depthWrite: false,
        opacity: 0,
        side: DoubleSide,
      }),
    ),
  )
  shadow.renderOrder = 2

  return {
    group,
    shadow,
    /** Put the glints where the light would catch: `light` and `view` are world directions toward them. */
    glint(light: Vector3, view: Vector3, strength: number, size: number, time: number) {
      const half = light.clone().add(view).normalize()
      const local = half.clone().applyQuaternion(group.quaternion.clone().invert())
      const across = new Vector3(local.x, 0, local.z)
      const rimSpot = across.lengthSq() > 1e-6 ? across.normalize().multiplyScalar(r) : new Vector3(r, 0, 0)
      const facing = Math.abs(local.y)
      const twinkle = 0.6 + 0.4 * Math.sin(time * 5.3) * Math.sin(time * 2.1 + 1)
      glints[0].position.copy(rimSpot)
      glints[0].material.opacity = strength * Math.pow(1 - facing, 2) * twinkle
      glints[0].scale.setScalar(size * (0.8 + 0.4 * twinkle))
      glints[0].material.rotation = time * 0.3
      glints[1].position.set(r * 0.35, Math.sign(local.y || 1) * h * 1.2, -r * 0.2)
      glints[1].material.opacity = strength * Math.pow(facing, 8) * twinkle
      glints[1].scale.setScalar(size * 0.7)
      glints[1].material.rotation = -time * 0.2
    },
    dispose() {
      for (const item of disposables) item.dispose()
    },
  }
}

// Fine radial and random scratches, as roughness: scratched metal is rougher in the scratch.
function scratchTexture() {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 256
  const ctx = canvas.getContext("2d")
  if (ctx) {
    ctx.fillStyle = "#555"
    ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 260; i++) {
      const radial = i < 120
      const angle = Math.random() * Math.PI * 2
      const start = radial ? 40 + Math.random() * 60 : Math.random() * 256
      ctx.strokeStyle = `rgba(${radial ? 190 : 230},${radial ? 190 : 230},${radial ? 190 : 230},${0.2 + Math.random() * 0.4})`
      ctx.lineWidth = Math.random() < 0.85 ? 0.6 : 1.4
      ctx.beginPath()
      if (radial) {
        ctx.moveTo(128 + Math.cos(angle) * start, 128 + Math.sin(angle) * start)
        ctx.lineTo(
          128 + Math.cos(angle) * (start + 10 + Math.random() * 30),
          128 + Math.sin(angle) * (start + 10 + Math.random() * 30),
        )
      } else {
        const y = Math.random() * 256
        ctx.moveTo(start, y)
        ctx.lineTo(start + (Math.random() - 0.5) * 90, y + (Math.random() - 0.5) * 40)
      }
      ctx.stroke()
    }
    // Worn high points are smoother.
    const worn = ctx.createRadialGradient(128, 128, 20, 128, 128, 128)
    worn.addColorStop(0, "rgba(40,40,40,0.4)")
    worn.addColorStop(1, "rgba(40,40,40,0)")
    ctx.fillStyle = worn
    ctx.fillRect(0, 0, 256, 256)
  }
  return new CanvasTexture(canvas)
}

// The reeded edge as a normal map: one ridge across the tile, repeated around the rim.
function reedTexture() {
  const canvas = document.createElement("canvas")
  canvas.width = 16
  canvas.height = 4
  const ctx = canvas.getContext("2d")
  if (ctx) {
    for (let x = 0; x < 16; x++) {
      const slope = Math.cos((x / 16) * Math.PI * 2)
      const red = Math.round(128 + slope * 100)
      ctx.fillStyle = `rgb(${red},128,255)`
      ctx.fillRect(x, 0, 1, 4)
    }
  }
  return new CanvasTexture(canvas)
}

function starTexture() {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext("2d")
  if (ctx) {
    const core = ctx.createRadialGradient(32, 32, 0, 32, 32, 12)
    core.addColorStop(0, "rgba(255,255,255,1)")
    core.addColorStop(1, "rgba(255,255,255,0)")
    ctx.fillStyle = core
    ctx.fillRect(0, 0, 64, 64)
    ctx.fillStyle = "rgba(255,255,255,0.85)"
    ctx.beginPath()
    for (const [x, y] of [
      [32, 0],
      [34, 30],
      [64, 32],
      [34, 34],
      [32, 64],
      [30, 34],
      [0, 32],
      [30, 30],
    ])
      ctx.lineTo(x, y)
    ctx.closePath()
    ctx.fill()
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

function blobTexture() {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext("2d")
  if (ctx) {
    const fill = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    fill.addColorStop(0, "rgba(0,0,0,0.85)")
    fill.addColorStop(0.5, "rgba(0,0,0,0.4)")
    fill.addColorStop(1, "rgba(0,0,0,0)")
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, 64, 64)
  }
  return new CanvasTexture(canvas)
}
