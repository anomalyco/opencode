import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  RepeatWrapping,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector2,
  Vector3,
} from "three"

/**
 * The cabinet. Its proportions come from the painted round-8 scene, solved as a camera match
 * (perspective/solve.py): 0.67 m wide, 0.76 m deep at the base, 1.8 m tall; the side profile is
 * traced from the FLORA side view and stretched to that depth. It is symmetric about x = 0, stands
 * on y = 0 and faces +z. Surfaces carry the FLORA reference art (front, coin door, panel, bezel,
 * marquee, side) by planar projection, weathered in the shader with a shared paint tile, dust on
 * upward faces and grime near the floor. The coin door, controls, bezel, marquee retainers and
 * screws are real geometry.
 */

export const size = { width: 0.67, height: 1.8, depth: 0.76 }
const half = size.width / 2
const panel = 0.018
const inner = half - panel
const back = -0.38
const z = (fromBack: number) => back + fromBack

// The side profile (distance from the back, height): floor to top along the front.
const frontProfile: [number, number][] = [
  [0.76, 0],
  [0.76, 0.749],
  [0.84, 0.806],
  [0.857, 0.912],
  [0.625, 1.0],
  [0.493, 1.425],
  [0.514, 1.46],
  [0.571, 1.49],
  [0.621, 1.585],
  [0.633, 1.62],
  [0.591, 1.795],
]
const profile: [number, number][] = [...frontProfile, [0, 1.65], [0, 0]].map(([d, y]) => [z(d), y])
const kick = { height: 0.1, depth: 0.03 }
const inset = 0.006

/** The slot, coin return and glass, in cabinet space, for the stage's camera and the coin. */
export const parts = (() => {
  const doorZ = z(0.76) - inset
  const bottom = new Vector3(0, 1.0, z(0.625))
  const top = new Vector3(0, 1.425, z(0.493))
  const along = top.clone().sub(bottom).normalize()
  const normal = new Vector3(0, -along.z, along.y).normalize()
  const glassWidth = 0.5
  // The DOM screen's aspect (geometry.ts glass: 1208 × 813).
  const glassHeight = (glassWidth * 813) / 1208
  // Proud of the bezel surface, so the bezel needs no hole.
  const centre = bottom
    .clone()
    .lerp(top, 0.53)
    .addScaledVector(normal, 0.004 - inset)
  return {
    doorZ,
    /** The lower front's plane, where the painted cabinet's front-left floor corner is. */
    frontZ: doorZ + 0.006,
    slot: new Vector3(0, 0.63, doorZ + 0.012),
    coinReturn: new Vector3(0, 0.469, doorZ),
    glass: { centre, normal, up: along, width: glassWidth, height: glassHeight },
    marquee: { bottom: new Vector3(0, 1.62, z(0.633)), top: new Vector3(0, 1.795, z(0.591)) },
  }
})()

export type CabinetParts = typeof parts

export type Cabinet = {
  group: Group
  /** Anchors in cabinet space: the coin door's plane, the slot, the coin return, the glass, the marquee. */
  parts: CabinetParts
  size: { width: number; height: number; depth: number }
  /** A GLB cabinet's own screen mesh (0–1 UVs), which takes the CRT material; the procedural one has none. */
  screen?: Mesh
  /** Everything a pointer can hit to mean "the cabinet". */
  body: Mesh[]
  /** Lamps: power 0–1 (after the credit), the edge colour and its intensity. */
  setPower: (value: number, edge: Color, edges: number) => void
  dispose: () => void
}

export function createCabinet(textures: TextureLoader, anisotropy: number, shadows: boolean): Cabinet {
  const disposables: { dispose: () => void }[] = []
  const keep = <T extends { dispose: () => void }>(value: T) => {
    disposables.push(value)
    return value
  }
  const load = (url: string, color = true) => {
    const texture = keep(textures.load(url))
    if (color) texture.colorSpace = SRGBColorSpace
    texture.anisotropy = anisotropy
    return texture
  }
  const group = new Group()
  const add = <T extends Object3D>(object: T) => {
    group.add(object)
    return object
  }

  // ——— Materials ———

  const paintTile = load("/arcade3d/cabinet-paint.webp")
  paintTile.wrapS = paintTile.wrapT = RepeatWrapping
  const grain = keep(grainTexture())
  grain.wrapS = grain.wrapT = RepeatWrapping
  const weathered = (options: ConstructorParameters<typeof MeshStandardMaterial>[0], amount = 1, fade = 0) =>
    keep(
      weather(
        new MeshStandardMaterial({ roughnessMap: grain, envMapIntensity: 0.35, ...options }),
        paintTile,
        amount,
        fade,
      ),
    )

  const frontMap = load("/arcade3d/cabinet-front.webp")
  const doorMap = load("/arcade3d/cabinet-door.webp")
  const panelMap = load("/arcade3d/cabinet-panel.webp")
  const bezelMap = load("/arcade3d/cabinet-bezel.webp")
  const marqueeMap = load("/arcade3d/cabinet-marquee.webp")
  const sideMap = load("/arcade3d/cabinet-side.webp")
  // The side art was traced at 0.612 m deep; the profile is stretched to 0.76 m, and so is it.
  sideMap.repeat.set(1 / 0.864, 1 / 1.8)
  sideMap.offset.set(-back / 0.864, 0)

  const front = weathered({ map: frontMap, roughness: 0.7, metalness: 0.05 }, 1.2, 0.12)
  const door = weathered({ map: doorMap, roughness: 0.72, metalness: 0.08 }, 1.1, 0.1)
  const plain = weathered({ map: paintTile, color: 0x9aa3c0, roughness: 0.8 }, 1.4)
  const side = weathered({ map: sideMap, roughness: 0.74 }, 1.6, 0.3)
  const panelTop = weathered({ map: panelMap, roughness: 0.55, metalness: 0.15 }, 0.6)
  const bezel = weathered({ map: bezelMap, roughness: 0.35, metalness: 0.05, envMapIntensity: 0.6 }, 0.4)
  const rubber = weathered({ color: 0x0a0b0f, roughness: 0.92 }, 1.4)
  // The T-molding, scuffed and chipped like everything else.
  const molding = weathered({ color: 0x3f86e8, roughness: 0.4, envMapIntensity: 0.6 }, 0.9, 0.15)
  const steel = keep(
    new MeshStandardMaterial({ color: 0x1a1d25, metalness: 0.75, roughness: 0.48, roughnessMap: grain }),
  )
  const chrome = keep(new MeshStandardMaterial({ color: 0xb8bfcc, metalness: 1, roughness: 0.28, roughnessMap: grain }))
  const rust = keep(new MeshStandardMaterial({ color: 0x6d5444, metalness: 0.6, roughness: 0.62, roughnessMap: grain }))
  const black = keep(new MeshBasicMaterial({ color: 0x010102 }))
  const plastic = keep(
    new MeshPhysicalMaterial({ color: 0x07080b, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.3 }),
  )
  const slotLamp = keep(
    new MeshStandardMaterial({ color: 0x0a0f1c, emissive: 0x2f7bff, emissiveIntensity: 0.4, roughness: 0.4 }),
  )
  const marqueeMaterial = keep(
    new MeshStandardMaterial({
      color: 0x0b0f18,
      emissive: 0xffffff,
      emissiveMap: marqueeMap,
      emissiveIntensity: 0,
      map: marqueeMap,
      roughness: 0.25,
      envMapIntensity: 0.6,
    }),
  )

  // ——— Shell ———

  // Side panels: the profile extruded by the panel thickness, beveled, the bevel and edge carrying
  // the T-molding. The right panel mirrors the left exactly.
  const sideShape = new Shape(profile.map(([pz, py]) => new Vector2(pz, py)))
  const sideGeometry = keep(
    new ExtrudeGeometry(sideShape, {
      depth: panel - 0.006,
      bevelEnabled: true,
      bevelThickness: 0.003,
      bevelSize: 0.004,
      bevelSegments: 3,
    }),
  )
  const sides = [-1, 1].map((sign) => {
    const mesh = add(new Mesh(sideGeometry, [side, molding]))
    mesh.rotation.y = -Math.PI / 2
    mesh.position.x = sign * (inner + 0.003)
    if (sign === 1) mesh.scale.x = -1
    return mesh
  })

  // The front, as strips across the inner width, each with its own art.
  const across = (x: number) => (x + inner) / (inner * 2)
  const span = (
    points: [number, number][],
    material: Material,
    uv: (x: number, y: number, t: number) => [number, number],
    set = inset,
  ) =>
    add(
      new Mesh(
        keep(
          strip(
            points.map(([d, y]) => [z(d), y]),
            set,
            uv,
          ),
        ),
        material,
      ),
    )
  const frontUv = (x: number, y: number): [number, number] => [(x + half) / size.width, y / size.height]
  // The coin-door art covers the lower front, floor to the panel (its own measured layout).
  const doorUv = (x: number, y: number): [number, number] => [across(x), y / 0.749]

  const kickFace = span(
    [
      [0.76 - kick.depth, 0],
      [0.76 - kick.depth, kick.height],
    ],
    rubber,
    doorUv,
  )
  const kickTop = span(
    [
      [0.76 - kick.depth, kick.height],
      [0.76, kick.height],
    ],
    door,
    doorUv,
  )
  const lower = span(
    [
      [0.76, kick.height],
      [0.76, 0.749],
    ],
    door,
    doorUv,
  )
  const upper = span(
    [
      [0.76, 0.749],
      [0.84, 0.806],
      [0.857, 0.912],
    ],
    front,
    frontUv,
  )
  const controls = span(
    [
      [0.857, 0.912],
      [0.625, 1.0],
    ],
    panelTop,
    (x, _y, t) => [across(x), 1 - t],
  )
  const bezelFace = span(
    [
      [0.625, 1.0],
      [0.493, 1.425],
    ],
    bezel,
    (x, _y, t) => [across(x), t],
  )
  const speaker = span(
    [
      [0.493, 1.425],
      [0.514, 1.46],
      [0.571, 1.49],
      [0.621, 1.585],
      [0.633, 1.62],
    ],
    front,
    frontUv,
  )
  const marquee = span(
    [
      [0.633, 1.62],
      [0.591, 1.795],
    ],
    marqueeMaterial,
    (x, _y, t) => [across(x), t],
    inset - 0.002,
  )
  const top = span(
    [
      [0.591, 1.795],
      [0, 1.65],
    ],
    plain,
    (x, y) => [x * 2, y * 2],
  )
  const rear = span(
    [
      [0, 1.65],
      [0, 0],
    ],
    plain,
    (x, y) => [x * 2, y * 2],
  )

  // ——— Coin door: plates, the lit slot, the coin return, locks and screws ———

  const doorX = 0
  const plate = (width: number, height: number, y: number, depth: number, material: Material, radius = 0.012) => {
    const geometry = keep(
      new ExtrudeGeometry(roundedRect(width, height, radius), {
        depth,
        bevelEnabled: true,
        bevelThickness: 0.002,
        bevelSize: 0.002,
        bevelSegments: 2,
      }),
    )
    const mesh = add(new Mesh(geometry, material))
    mesh.position.set(doorX, y, parts.doorZ)
    return mesh
  }
  plate(0.226, 0.556, 0.42, 0.004, steel, 0.016)
  plate(0.2, 0.256, 0.556, 0.006, steel)
  plate(0.2, 0.246, 0.283, 0.006, steel)

  const slotFrame = new Group()
  const frame = 0.053
  const rim = 0.009
  for (const [w, h, x, y] of [
    [frame, rim, 0, frame / 2 - rim / 2],
    [frame, rim, 0, -frame / 2 + rim / 2],
    [rim, frame, frame / 2 - rim / 2, 0],
    [rim, frame, -frame / 2 + rim / 2, 0],
  ]) {
    const bar = new Mesh(keep(new BoxGeometry(w, h, 0.006)), slotLamp)
    bar.position.set(x, y, 0)
    slotFrame.add(bar)
  }
  const slotPlate = new Mesh(keep(new BoxGeometry(frame - rim * 2, frame - rim * 2, 0.004)), chrome)
  slotFrame.add(slotPlate)
  const slit = new Mesh(keep(new BoxGeometry(0.0045, 0.03, 0.0052)), black)
  slotFrame.add(slit)
  slotFrame.position.set(0, parts.slot.y, parts.doorZ + 0.009)
  add(slotFrame)

  const mouth = add(new Mesh(keep(new BoxGeometry(0.056, 0.052, 0.012)), steel))
  mouth.position.set(0, parts.coinReturn.y, parts.doorZ + 0.008)
  const hole = add(new Mesh(keep(new PlaneGeometry(0.04, 0.036)), black))
  hole.position.set(0, parts.coinReturn.y, parts.doorZ + 0.0145)
  const flap = add(new Mesh(keep(new BoxGeometry(0.042, 0.02, 0.003)), chrome))
  flap.position.set(0, parts.coinReturn.y + 0.012, parts.doorZ + 0.016)
  flap.rotation.x = -0.35

  const lockGeometry = keep(new CylinderGeometry(0.009, 0.009, 0.008, 24))
  for (const y of [0.555, 0.291]) {
    const lock = add(new Mesh(lockGeometry, chrome))
    lock.rotation.x = Math.PI / 2
    lock.position.set(0.07, y, parts.doorZ + 0.012)
    const key = add(new Mesh(keep(new BoxGeometry(0.0018, 0.008, 0.002)), black))
    key.position.set(0.07, y, parts.doorZ + 0.0165)
  }

  const screwGeometry = keep(new CylinderGeometry(0.0038, 0.0038, 0.0025, 12))
  const slotGeometry = keep(new BoxGeometry(0.0055, 0.0009, 0.0012))
  const screw = (at: Vector3, normal: Vector3, rusty = false) => {
    const head = add(new Mesh(screwGeometry, rusty ? rust : chrome))
    head.position.copy(at)
    head.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), normal)
    const cross = [0, Math.PI / 2].map((angle) => {
      const bar = new Mesh(slotGeometry, black)
      bar.position.set(0, 0.0013, 0)
      bar.rotation.y = angle + 0.4
      head.add(bar)
      return bar
    })
    return cross
  }
  const out = new Vector3(0, 0, 1)
  for (const [x, y] of [
    [-0.1, 0.685],
    [0.1, 0.685],
    [-0.1, 0.155],
    [0.1, 0.155],
  ])
    screw(new Vector3(x, y, parts.doorZ + 0.007), out, y < 0.3)

  // ——— Control panel: joysticks, buttons and start buttons on the panel art ———

  const panelFront = new Vector3(0, 0.912, z(0.857) - inset)
  const panelBack = new Vector3(0, 1.0, z(0.625) - inset)
  const panelNormal = (() => {
    const along = panelBack.clone().sub(panelFront).normalize()
    return new Vector3(0, -along.z, along.y).normalize()
  })()
  const onPanel = (u: number, t: number) =>
    panelFront
      .clone()
      .lerp(panelBack, t)
      .setX(-inner + u * inner * 2)

  const washer = keep(new CylinderGeometry(0.028, 0.028, 0.002, 32))
  const shaft = keep(new CylinderGeometry(0.0042, 0.0042, 0.07, 12))
  const ball = keep(new SphereGeometry(0.019, 28, 18))
  const ballMaterial = keep(
    new MeshPhysicalMaterial({ color: 0x8c1414, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12 }),
  )
  const boot = keep(new CylinderGeometry(0.006, 0.011, 0.012, 16))
  for (const u of [0.148, 0.642]) {
    const at = onPanel(u, 0.527)
    const stick = new Group()
    stick.position.copy(at)
    stick.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), panelNormal)
    const parts3 = [
      [new Mesh(washer, plastic), 0.001],
      [new Mesh(boot, rubber), 0.007],
      [new Mesh(shaft, chrome), 0.036],
      [new Mesh(ball, ballMaterial), 0.074],
    ] as const
    for (const [mesh, y] of parts3) {
      mesh.position.y = y
      stick.add(mesh)
    }
    // A worn stick leans a little.
    stick.rotateX(0.04)
    add(stick)
  }

  // Concave arcade buttons: a bezel ring and a dished cap, coloured like the panel art.
  const ring = keep(new CylinderGeometry(0.0175, 0.0185, 0.004, 32))
  const cap = keep(
    new LatheGeometry(
      [
        new Vector2(0, 0.0026),
        new Vector2(0.006, 0.0029),
        new Vector2(0.011, 0.0036),
        new Vector2(0.0138, 0.0046),
        new Vector2(0.0145, 0.0042),
        new Vector2(0.0145, 0),
      ],
      32,
    ),
  )
  const buttonColors: Record<string, number> = { white: 0xd8dbe2, red: 0xb3161b, yellow: 0xe0b51c, blue: 0x1f5fd6 }
  const buttonMaterials = Object.fromEntries(
    Object.entries(buttonColors).map(([name, color]) => [
      name,
      keep(
        new MeshPhysicalMaterial({
          color,
          roughness: 0.32,
          clearcoat: 0.7,
          clearcoatRoughness: 0.25,
          roughnessMap: grain,
        }),
      ),
    ]),
  )
  const button = (u: number, t: number, color: string, scale = 1) => {
    const group3 = new Group()
    group3.position.copy(onPanel(u, t))
    group3.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), panelNormal)
    group3.scale.setScalar(scale)
    const bezelRing = new Mesh(ring, buttonMaterials[color])
    bezelRing.position.y = 0.002
    const dish = new Mesh(cap, buttonMaterials[color])
    dish.position.y = 0.003
    group3.add(bezelRing, dish)
    add(group3)
  }
  for (const [u, t, color] of [
    [0.348, 0.304, "white"],
    [0.42, 0.304, "white"],
    [0.399, 0.538, "red"],
    [0.316, 0.669, "red"],
    [0.81, 0.433, "white"],
    [0.899, 0.319, "yellow"],
    [0.899, 0.538, "blue"],
  ] as const)
    button(u, t, color)
  // 1P and 2P start buttons at the back of the panel.
  button(0.46, 0.88, "white", 0.62)
  button(0.54, 0.88, "white", 0.62)
  for (const u of [0.03, 0.97])
    for (const t of [0.12, 0.9]) screw(onPanel(u, t).addScaledVector(panelNormal, 0.001), panelNormal, true)

  // ——— The CRT's bezel: a raised black frame around the glass, in a dark recess ———

  const glass = parts.glass
  const bezelFrame = new Shape()
  const outerShape = roundedRect(glass.width + 0.07, glass.height + 0.07, 0.035)
  bezelFrame.curves = outerShape.curves
  bezelFrame.holes = [roundedRect(glass.width + 0.004, glass.height + 0.004, 0.026)]
  const frameMesh = add(
    new Mesh(
      keep(
        new ExtrudeGeometry(bezelFrame, {
          depth: 0.006,
          bevelEnabled: true,
          bevelThickness: 0.004,
          bevelSize: 0.004,
          bevelSegments: 3,
        }),
      ),
      plastic,
    ),
  )
  frameMesh.position.copy(glass.centre).addScaledVector(glass.normal, -0.01)
  frameMesh.up.copy(glass.up)
  frameMesh.lookAt(frameMesh.position.clone().add(glass.normal))
  const recess = add(
    new Mesh(
      keep(new PlaneGeometry(glass.width + 0.01, glass.height + 0.01)),
      keep(new MeshBasicMaterial({ color: 0x010204 })),
    ),
  )
  recess.position.copy(glass.centre).addScaledVector(glass.normal, -0.006)
  recess.up.copy(glass.up)
  recess.lookAt(recess.position.clone().add(glass.normal))

  // ——— Marquee retainers with their screws ———

  const marqueeFace = parts.marquee
  const marqueeNormal = (() => {
    const along = marqueeFace.top.clone().sub(marqueeFace.bottom).normalize()
    return new Vector3(0, -along.z, along.y).normalize()
  })()
  for (const t of [0.04, 0.96]) {
    const at = marqueeFace.bottom
      .clone()
      .lerp(marqueeFace.top, t)
      .addScaledVector(marqueeNormal, 0.002 - inset)
    const retainer = add(new Mesh(keep(new BoxGeometry(inner * 2, 0.012, 0.006)), chrome))
    retainer.position.copy(at)
    retainer.lookAt(at.clone().add(marqueeNormal))
    for (const x of [-0.25, 0, 0.25])
      screw(at.clone().setX(x).addScaledVector(marqueeNormal, 0.004), marqueeNormal, x !== 0)
  }

  // ——— Back door with vents ———

  const backDoor = add(new Mesh(keep(new BoxGeometry(0.42, 0.9, 0.006)), steel))
  backDoor.position.set(0, 0.75, back - 0.003)
  for (let row = 0; row < 6; row++) {
    const vent = add(new Mesh(keep(new BoxGeometry(0.3, 0.012, 0.002)), black))
    vent.position.set(0, 1.05 + row * 0.03, back - 0.0065)
  }

  for (const child of group.children)
    child.traverse((object) => {
      if (!(object instanceof Mesh)) return
      object.castShadow = shadows
      object.receiveShadow = shadows
    })

  return {
    group,
    parts,
    size,
    body: [kickFace, kickTop, lower, upper, controls, bezelFace, speaker, marquee, top, rear, ...sides],
    setPower: (value, edge, edges) => {
      // The marquee's backlight and the slot lamp come on with the credit; the T-molding always
      // carries a faint glow of the machine's light.
      marqueeMaterial.emissiveIntensity = value * 1.1 * edges
      marqueeMaterial.emissive.copy(edge).lerp(new Color(1, 1, 1), 0.6)
      slotLamp.emissive.copy(edge)
      slotLamp.emissiveIntensity = (0.4 + value * 2.4) * edges
      molding.emissive.copy(edge)
      molding.emissiveIntensity = (0.03 + value * 0.05) * edges
    },
    dispose: () => {
      for (const item of disposables) item.dispose()
    },
  }
}

/**
 * Patina in the shader: the shared paint tile breaks up every surface at a 40 cm scale, dust
 * settles on upward faces and grime gathers near the floor.
 */
function weather(material: MeshStandardMaterial, tile: Texture, amount: number, fade = 0) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.weatherTile = { value: tile }
    shader.uniforms.weatherAmount = { value: amount }
    shader.uniforms.weatherFade = { value: fade }
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWeatherPosition;\nvarying vec3 vWeatherNormal;")
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvWeatherPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWeatherNormal = normalize(mat3(modelMatrix) * objectNormal);",
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform sampler2D weatherTile;\nuniform float weatherAmount;\nuniform float weatherFade;\nvarying vec3 vWeatherPosition;\nvarying vec3 vWeatherNormal;\nfloat weatherScuff;",
      )
      .replace(
        "#include <map_fragment>",
        /* glsl */ `#include <map_fragment>
        {
          vec3 n = abs(normalize(vWeatherNormal));
          vec3 w = n / (n.x + n.y + n.z);
          vec3 p = vWeatherPosition;
          // Fine wear at 40 cm, mottling at 3 m (the same tile, triplanar).
          vec3 fine = texture2D(weatherTile, p.zy * 2.5).rgb * w.x + texture2D(weatherTile, p.xy * 2.5).rgb * w.z + texture2D(weatherTile, p.xz * 2.5).rgb * w.y;
          vec3 broad = texture2D(weatherTile, p.zy * 0.33 + 0.37).rgb * w.x + texture2D(weatherTile, p.xy * 0.33 + 0.37).rgb * w.z + texture2D(weatherTile, p.xz * 0.33 + 0.37).rgb * w.y;
          float scuff = dot(fine, vec3(0.3333));
          float mottle = dot(broad, vec3(0.3333));
          weatherScuff = scuff;
          // Sun-faded paint: less colour, a little lighter.
          float luma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(luma) * 1.15 + vec3(0.012, 0.014, 0.02), weatherFade);
          // Chips and scratches show lighter; broad patches of the paint are worn or darker.
          diffuseColor.rgb *= mix(1.0, 0.7 + 1.0 * scuff, 0.5 * weatherAmount);
          diffuseColor.rgb *= mix(1.0, 0.72 + 0.6 * mottle, 0.55 * weatherAmount);
          // Dust settles on upward faces and on the top edges.
          float up = smoothstep(0.5, 0.95, normalize(vWeatherNormal).y);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.31, 0.34), up * 0.45 * weatherAmount * (0.5 + 0.5 * scuff));
          float topEdge = smoothstep(1.62, 1.8, p.y) * (1.0 - up) * 0.25 * weatherAmount;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.28, 0.29, 0.32), topEdge);
          // Grime and kick marks near the floor.
          float low = 1.0 - smoothstep(0.0, 0.3, p.y);
          diffuseColor.rgb *= 1.0 - low * 0.45 * weatherAmount * (0.6 + 0.4 * mottle);
        }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * (0.75 + 0.6 * weatherScuff), 0.05, 1.0);",
      )
  }
  return material
}

function roundedRect(width: number, height: number, radius: number) {
  const shape = new Shape()
  const x = -width / 2
  const y = -height / 2
  shape.moveTo(x + radius, y)
  shape.lineTo(x + width - radius, y)
  shape.quadraticCurveTo(x + width, y, x + width, y + radius)
  shape.lineTo(x + width, y + height - radius)
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  shape.lineTo(x + radius, y + height)
  shape.quadraticCurveTo(x, y + height, x, y + height - radius)
  shape.lineTo(x, y + radius)
  shape.quadraticCurveTo(x, y, x + radius, y)
  return shape
}

/**
 * A surface swept across the cabinet's inner width along a run of profile points (z, y), set back
 * by `inset` along -z. UVs come from `uv(x, y, t)`, where t is the distance along the run (0–1).
 */
function strip(points: [number, number][], inset: number, uv: (x: number, y: number, t: number) => [number, number]) {
  const lengths = points.map((_, index) =>
    points
      .slice(1, index + 1)
      .reduce((sum, point, step) => sum + Math.hypot(point[0] - points[step][0], point[1] - points[step][1]), 0),
  )
  const total = lengths[lengths.length - 1] || 1
  const positions: number[] = []
  const uvs: number[] = []
  const add = (x: number, index: number) => {
    const [pz, py] = points[index]
    positions.push(x, py, pz - inset)
    uvs.push(...uv(x, py, lengths[index] / total))
  }
  points.slice(1).forEach((_, index) => {
    add(-inner, index)
    add(inner, index)
    add(inner, index + 1)
    add(-inner, index)
    add(inner, index + 1)
    add(-inner, index + 1)
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3))
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  return geometry
}

// A soft, uneven roughness map: worn paint is shinier where hands have rubbed it.
function grainTexture() {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 256
  const ctx = canvas.getContext("2d")
  if (ctx) {
    ctx.fillStyle = "#c8c8c8"
    ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 2600; i++) {
      const shade = 150 + Math.random() * 105
      ctx.fillStyle = `rgba(${shade},${shade},${shade},0.35)`
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3)
    }
    ctx.strokeStyle = "rgba(90,90,90,0.5)"
    for (let i = 0; i < 60; i++) {
      ctx.beginPath()
      const x = Math.random() * 256
      const y = Math.random() * 256
      ctx.moveTo(x, y)
      ctx.lineTo(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 20)
      ctx.stroke()
    }
  }
  return new CanvasTexture(canvas)
}
