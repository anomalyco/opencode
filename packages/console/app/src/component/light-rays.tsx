import { createSignal, createEffect, onMount, onCleanup, Show, For, Accessor, Setter } from "solid-js"
import "./light-rays.css"

export type RaysOrigin =
  | "top-center"
  | "top-left"
  | "top-right"
  | "right"
  | "left"
  | "bottom-center"
  | "bottom-right"
  | "bottom-left"

export interface LightRaysConfig {
  raysOrigin: RaysOrigin
  raysColor: string
  raysSpeed: number
  lightSpread: number
  rayLength: number
  sourceWidth: number
  pulsating: boolean
  pulsatingMin: number
  pulsatingMax: number
  fadeDistance: number
  saturation: number
  followMouse: boolean
  mouseInfluence: number
  noiseAmount: number
  distortion: number
  opacity: number
}

export const defaultConfig: LightRaysConfig = {
  raysOrigin: "top-center",
  raysColor: "#ffffff",
  raysSpeed: 1.0,
  lightSpread: 1.15,
  rayLength: 4.0,
  sourceWidth: 0.1,
  pulsating: true,
  pulsatingMin: 0.9,
  pulsatingMax: 1.0,
  fadeDistance: 1.15,
  saturation: 0.325,
  followMouse: false,
  mouseInfluence: 0.05,
  noiseAmount: 0.5,
  distortion: 0.0,
  opacity: 0.35,
}

export interface LightRaysAnimationState {
  time: number
  intensity: number
  pulseValue: number
}

interface LightRaysProps {
  config: Accessor<LightRaysConfig>
  class?: string
  onAnimationFrame?: (state: LightRaysAnimationState) => void
}

const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [1, 1, 1]
}

const getAnchorAndDir = (
  origin: RaysOrigin,
  w: number,
  h: number,
): { anchor: [number, number]; dir: [number, number] } => {
  const outside = 0.2
  switch (origin) {
    case "top-left":
      return { anchor: [0, -outside * h], dir: [0, 1] }
    case "top-right":
      return { anchor: [w, -outside * h], dir: [0, 1] }
    case "left":
      return { anchor: [-outside * w, 0.5 * h], dir: [1, 0] }
    case "right":
      return { anchor: [(1 + outside) * w, 0.5 * h], dir: [-1, 0] }
    case "bottom-left":
      return { anchor: [0, (1 + outside) * h], dir: [0, -1] }
    case "bottom-center":
      return { anchor: [0.5 * w, (1 + outside) * h], dir: [0, -1] }
    case "bottom-right":
      return { anchor: [w, (1 + outside) * h], dir: [0, -1] }
    default: // "top-center"
      return { anchor: [0.5 * w, -outside * h], dir: [0, 1] }
  }
}

interface UniformData {
  iTime: number
  iResolution: [number, number]
  rayPos: [number, number]
  rayDir: [number, number]
  raysColor: [number, number, number]
  raysSpeed: number
  lightSpread: number
  rayLength: number
  sourceWidth: number
  pulsating: number
  pulsatingMin: number
  pulsatingMax: number
  fadeDistance: number
  saturation: number
  mousePos: [number, number]
  mouseInfluence: number
  noiseAmount: number
  distortion: number
}

const WGSL_SHADER = `
  struct Uniforms {
    iTime: f32,
    _pad0: f32,
    iResolution: vec2<f32>,
    rayPos: vec2<f32>,
    rayDir: vec2<f32>,
    raysColor: vec3<f32>,
    raysSpeed: f32,
    lightSpread: f32,
    rayLength: f32,
    sourceWidth: f32,
    pulsating: f32,
    pulsatingMin: f32,
    pulsatingMax: f32,
    fadeDistance: f32,
    saturation: f32,
    mousePos: vec2<f32>,
    mouseInfluence: f32,
    noiseAmount: f32,
    distortion: f32,
    _pad1: f32,
    _pad2: f32,
    _pad3: f32,
  };

  @group(0) @binding(0) var<uniform> uniforms: Uniforms;

  struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) vUv: vec2<f32>,
  };

  @vertex
  fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(
      vec2<f32>(-1.0, -1.0),
      vec2<f32>(3.0, -1.0),
      vec2<f32>(-1.0, 3.0)
    );
    
    var output: VertexOutput;
    let pos = positions[vertexIndex];
    output.position = vec4<f32>(pos, 0.0, 1.0);
    output.vUv = pos * 0.5 + 0.5;
    return output;
  }

  fn noise(st: vec2<f32>) -> f32 {
    return fract(sin(dot(st, vec2<f32>(12.9898, 78.233))) * 43758.5453123);
  }

  fn rayStrength(raySource: vec2<f32>, rayRefDirection: vec2<f32>, coord: vec2<f32>,
                seedA: f32, seedB: f32, speed: f32) -> f32 {
    let sourceToCoord = coord - raySource;
    let dirNorm = normalize(sourceToCoord);
    let cosAngle = dot(dirNorm, rayRefDirection);

    let distortedAngle = cosAngle + uniforms.distortion * sin(uniforms.iTime * 2.0 + length(sourceToCoord) * 0.01) * 0.2;
    
    let spreadFactor = pow(max(distortedAngle, 0.0), 1.0 / max(uniforms.lightSpread, 0.001));

    let distance = length(sourceToCoord);
    let maxDistance = uniforms.iResolution.x * uniforms.rayLength;
    let lengthFalloff = clamp((maxDistance - distance) / maxDistance, 0.0, 1.0);
    
    let fadeFalloff = clamp((uniforms.iResolution.x * uniforms.fadeDistance - distance) / (uniforms.iResolution.x * uniforms.fadeDistance), 0.5, 1.0);
    let pulseCenter = (uniforms.pulsatingMin + uniforms.pulsatingMax) * 0.5;
    let pulseAmplitude = (uniforms.pulsatingMax - uniforms.pulsatingMin) * 0.5;
    var pulse: f32;
    if (uniforms.pulsating > 0.5) {
      pulse = pulseCenter + pulseAmplitude * sin(uniforms.iTime * speed * 3.0);
    } else {
      pulse = 1.0;
    }

    let baseStrength = clamp(
      (0.45 + 0.15 * sin(distortedAngle * seedA + uniforms.iTime * speed)) +
      (0.3 + 0.2 * cos(-distortedAngle * seedB + uniforms.iTime * speed)),
      0.0, 1.0
    );

    return baseStrength * lengthFalloff * fadeFalloff * spreadFactor * pulse;
  }

  @fragment
  fn fragmentMain(@builtin(position) fragCoord: vec4<f32>, @location(0) vUv: vec2<f32>) -> @location(0) vec4<f32> {
    let coord = vec2<f32>(fragCoord.x, fragCoord.y);
    
    let normalizedX = (coord.x / uniforms.iResolution.x) - 0.5;
    let widthOffset = -normalizedX * uniforms.sourceWidth * uniforms.iResolution.x;
    
    let perpDir = vec2<f32>(-uniforms.rayDir.y, uniforms.rayDir.x);
    let adjustedRayPos = uniforms.rayPos + perpDir * widthOffset;
    
    var finalRayDir = uniforms.rayDir;
    if (uniforms.mouseInfluence > 0.0) {
      let mouseScreenPos = uniforms.mousePos * uniforms.iResolution;
      let mouseDirection = normalize(mouseScreenPos - adjustedRayPos);
      finalRayDir = normalize(mix(uniforms.rayDir, mouseDirection, uniforms.mouseInfluence));
    }

    let rays1 = vec4<f32>(1.0) *
                rayStrength(adjustedRayPos, finalRayDir, coord, 36.2214, 21.11349,
                            1.5 * uniforms.raysSpeed);
    let rays2 = vec4<f32>(1.0) *
                rayStrength(adjustedRayPos, finalRayDir, coord, 22.3991, 18.0234,
                            1.1 * uniforms.raysSpeed);

    var fragColor = rays1 * 0.5 + rays2 * 0.4;

    if (uniforms.noiseAmount > 0.0) {
      let n = noise(coord * 0.01 + uniforms.iTime * 0.1);
      fragColor = vec4<f32>(fragColor.rgb * (1.0 - uniforms.noiseAmount + uniforms.noiseAmount * n), fragColor.a);
    }

    let brightness = 1.0 - (coord.y / uniforms.iResolution.y);
    fragColor.x = fragColor.x * (0.1 + brightness * 0.8);
    fragColor.y = fragColor.y * (0.3 + brightness * 0.6);
    fragColor.z = fragColor.z * (0.5 + brightness * 0.5);

    if (uniforms.saturation != 1.0) {
      let gray = dot(fragColor.rgb, vec3<f32>(0.299, 0.587, 0.114));
      fragColor = vec4<f32>(mix(vec3<f32>(gray), fragColor.rgb, uniforms.saturation), fragColor.a);
    }

    fragColor = vec4<f32>(fragColor.rgb * uniforms.raysColor, fragColor.a);
    
    return fragColor;
  }
`

const UNIFORM_BUFFER_SIZE = 96

function createUniformBuffer(data: UniformData): Float32Array {
  const buffer = new Float32Array(24)
  buffer[0] = data.iTime
  buffer[1] = 0
  buffer[2] = data.iResolution[0]
  buffer[3] = data.iResolution[1]
  buffer[4] = data.rayPos[0]
  buffer[5] = data.rayPos[1]
  buffer[6] = data.rayDir[0]
  buffer[7] = data.rayDir[1]
  buffer[8] = data.raysColor[0]
  buffer[9] = data.raysColor[1]
  buffer[10] = data.raysColor[2]
  buffer[11] = data.raysSpeed
  buffer[12] = data.lightSpread
  buffer[13] = data.rayLength
  buffer[14] = data.sourceWidth
  buffer[15] = data.pulsating
  buffer[16] = data.pulsatingMin
  buffer[17] = data.pulsatingMax
  buffer[18] = data.fadeDistance
  buffer[19] = data.saturation
  buffer[20] = data.mousePos[0]
  buffer[21] = data.mousePos[1]
  buffer[22] = data.mouseInfluence
  buffer[23] = data.noiseAmount
  return buffer
}

const UNIFORM_BUFFER_SIZE_CORRECTED = 112

function createUniformBufferCorrected(data: UniformData): Float32Array {
  const buffer = new Float32Array(28)
  buffer[0] = data.iTime
  buffer[1] = 0
  buffer[2] = data.iResolution[0]
  buffer[3] = data.iResolution[1]
  buffer[4] = data.rayPos[0]
  buffer[5] = data.rayPos[1]
  buffer[6] = data.rayDir[0]
  buffer[7] = data.rayDir[1]
  buffer[8] = data.raysColor[0]
  buffer[9] = data.raysColor[1]
  buffer[10] = data.raysColor[2]
  buffer[11] = data.raysSpeed
  buffer[12] = data.lightSpread
  buffer[13] = data.rayLength
  buffer[14] = data.sourceWidth
  buffer[15] = data.pulsating
  buffer[16] = data.pulsatingMin
  buffer[17] = data.pulsatingMax
  buffer[18] = data.fadeDistance
  buffer[19] = data.saturation
  buffer[20] = data.mousePos[0]
  buffer[21] = data.mousePos[1]
  buffer[22] = data.mouseInfluence
  buffer[23] = data.noiseAmount
  buffer[24] = data.distortion
  buffer[25] = 0
  buffer[26] = 0
  buffer[27] = 0
  return buffer
}

export default function LightRays(props: LightRaysProps) {
  let containerRef: HTMLDivElement | undefined
  let canvasRef: HTMLCanvasElement | null = null
  let deviceRef: GPUDevice | null = null
  let contextRef: GPUCanvasContext | null = null
  let pipelineRef: GPURenderPipeline | null = null
  let uniformBufferRef: GPUBuffer | null = null
  let bindGroupRef: GPUBindGroup | null = null
  let animationIdRef: number | null = null
  let cleanupFunctionRef: (() => void) | null = null
  let uniformDataRef: UniformData | null = null

  const mouseRef = { x: 0.5, y: 0.5 }
  const smoothMouseRef = { x: 0.5, y: 0.5 }

  const [isVisible, setIsVisible] = createSignal(false)

  onMount(() => {
    if (!containerRef) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        setIsVisible(entry.isIntersecting)
      },
      { threshold: 0.1 },
    )

    observer.observe(containerRef)

    onCleanup(() => {
      observer.disconnect()
    })
  })

  createEffect(() => {
    const visible = isVisible()
    const config = props.config()
    if (!visible || !containerRef) {
      return
    }

    if (cleanupFunctionRef) {
      cleanupFunctionRef()
      cleanupFunctionRef = null
    }

    const initializeWebGPU = async () => {
      if (!containerRef) {
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 10))

      if (!containerRef) {
        return
      }

      if (!navigator.gpu) {
        console.warn("WebGPU is not supported in this browser")
        return
      }

      const adapter = await navigator.gpu.requestAdapter()
      if (!adapter) {
        console.warn("Failed to get WebGPU adapter")
        return
      }

      const device = await adapter.requestDevice()
      deviceRef = device

      const canvas = document.createElement("canvas")
      canvas.style.width = "100%"
      canvas.style.height = "100%"
      canvasRef = canvas

      while (containerRef.firstChild) {
        containerRef.removeChild(containerRef.firstChild)
      }
      containerRef.appendChild(canvas)

      const context = canvas.getContext("webgpu")
      if (!context) {
        console.warn("Failed to get WebGPU context")
        return
      }
      contextRef = context

      const presentationFormat = navigator.gpu.getPreferredCanvasFormat()
      context.configure({
        device,
        format: presentationFormat,
        alphaMode: "premultiplied",
      })

      const shaderModule = device.createShaderModule({
        code: WGSL_SHADER,
      })

      const uniformBuffer = device.createBuffer({
        size: UNIFORM_BUFFER_SIZE_CORRECTED,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      uniformBufferRef = uniformBuffer

      const bindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform" },
          },
        ],
      })

      const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          {
            binding: 0,
            resource: { buffer: uniformBuffer },
          },
        ],
      })
      bindGroupRef = bindGroup

      const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      })

      const pipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
          module: shaderModule,
          entryPoint: "vertexMain",
        },
        fragment: {
          module: shaderModule,
          entryPoint: "fragmentMain",
          targets: [
            {
              format: presentationFormat,
              blend: {
                color: {
                  srcFactor: "src-alpha",
                  dstFactor: "one-minus-src-alpha",
                  operation: "add",
                },
                alpha: {
                  srcFactor: "one",
                  dstFactor: "one-minus-src-alpha",
                  operation: "add",
                },
              },
            },
          ],
        },
        primitive: {
          topology: "triangle-list",
        },
      })
      pipelineRef = pipeline

      const { clientWidth: wCSS, clientHeight: hCSS } = containerRef
      const dpr = Math.min(window.devicePixelRatio, 2)
      const w = wCSS * dpr
      const h = hCSS * dpr
      const { anchor, dir } = getAnchorAndDir(config.raysOrigin, w, h)

      uniformDataRef = {
        iTime: 0,
        iResolution: [w, h],
        rayPos: anchor,
        rayDir: dir,
        raysColor: hexToRgb(config.raysColor),
        raysSpeed: config.raysSpeed,
        lightSpread: config.lightSpread,
        rayLength: config.rayLength,
        sourceWidth: config.sourceWidth,
        pulsating: config.pulsating ? 1.0 : 0.0,
        pulsatingMin: config.pulsatingMin,
        pulsatingMax: config.pulsatingMax,
        fadeDistance: config.fadeDistance,
        saturation: config.saturation,
        mousePos: [0.5, 0.5],
        mouseInfluence: config.mouseInfluence,
        noiseAmount: config.noiseAmount,
        distortion: config.distortion,
      }

      const updatePlacement = () => {
        if (!containerRef || !canvasRef || !uniformDataRef) {
          return
        }

        const dpr = Math.min(window.devicePixelRatio, 2)
        const { clientWidth: wCSS, clientHeight: hCSS } = containerRef
        const w = Math.floor(wCSS * dpr)
        const h = Math.floor(hCSS * dpr)

        canvasRef.width = w
        canvasRef.height = h

        uniformDataRef.iResolution = [w, h]

        const currentConfig = props.config()
        const { anchor, dir } = getAnchorAndDir(currentConfig.raysOrigin, w, h)
        uniformDataRef.rayPos = anchor
        uniformDataRef.rayDir = dir
      }

      const loop = (t: number) => {
        if (!deviceRef || !contextRef || !pipelineRef || !uniformBufferRef || !bindGroupRef || !uniformDataRef) {
          return
        }

        const currentConfig = props.config()
        const timeSeconds = t * 0.001
        uniformDataRef.iTime = timeSeconds

        if (currentConfig.followMouse && currentConfig.mouseInfluence > 0.0) {
          const smoothing = 0.92

          smoothMouseRef.x = smoothMouseRef.x * smoothing + mouseRef.x * (1 - smoothing)
          smoothMouseRef.y = smoothMouseRef.y * smoothing + mouseRef.y * (1 - smoothing)

          uniformDataRef.mousePos = [smoothMouseRef.x, smoothMouseRef.y]
        }

        if (props.onAnimationFrame) {
          const pulseCenter = (currentConfig.pulsatingMin + currentConfig.pulsatingMax) * 0.5
          const pulseAmplitude = (currentConfig.pulsatingMax - currentConfig.pulsatingMin) * 0.5
          const pulseValue = currentConfig.pulsating
            ? pulseCenter + pulseAmplitude * Math.sin(timeSeconds * currentConfig.raysSpeed * 3.0)
            : 1.0

          const baseIntensity1 = 0.45 + 0.15 * Math.sin(timeSeconds * currentConfig.raysSpeed * 1.5)
          const baseIntensity2 = 0.3 + 0.2 * Math.cos(timeSeconds * currentConfig.raysSpeed * 1.1)
          const intensity = (baseIntensity1 + baseIntensity2) * pulseValue

          props.onAnimationFrame({
            time: timeSeconds,
            intensity,
            pulseValue,
          })
        }

        try {
          const uniformData = createUniformBufferCorrected(uniformDataRef)
          deviceRef.queue.writeBuffer(uniformBufferRef, 0, uniformData.buffer)

          const commandEncoder = deviceRef.createCommandEncoder()

          const textureView = contextRef.getCurrentTexture().createView()

          const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [
              {
                view: textureView,
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: "clear",
                storeOp: "store",
              },
            ],
          })

          renderPass.setPipeline(pipelineRef)
          renderPass.setBindGroup(0, bindGroupRef)
          renderPass.draw(3)
          renderPass.end()

          deviceRef.queue.submit([commandEncoder.finish()])

          animationIdRef = requestAnimationFrame(loop)
        } catch (error) {
          console.warn("WebGPU rendering error:", error)
          return
        }
      }

      window.addEventListener("resize", updatePlacement)
      updatePlacement()
      animationIdRef = requestAnimationFrame(loop)

      cleanupFunctionRef = () => {
        if (animationIdRef) {
          cancelAnimationFrame(animationIdRef)
          animationIdRef = null
        }

        window.removeEventListener("resize", updatePlacement)

        if (uniformBufferRef) {
          uniformBufferRef.destroy()
          uniformBufferRef = null
        }

        if (deviceRef) {
          deviceRef.destroy()
          deviceRef = null
        }

        if (canvasRef && canvasRef.parentNode) {
          canvasRef.parentNode.removeChild(canvasRef)
        }

        canvasRef = null
        contextRef = null
        pipelineRef = null
        bindGroupRef = null
        uniformDataRef = null
      }
    }

    initializeWebGPU()

    onCleanup(() => {
      if (cleanupFunctionRef) {
        cleanupFunctionRef()
        cleanupFunctionRef = null
      }
    })
  })

  createEffect(() => {
    if (!uniformDataRef || !containerRef) {
      return
    }

    const config = props.config()

    uniformDataRef.raysColor = hexToRgb(config.raysColor)
    uniformDataRef.raysSpeed = config.raysSpeed
    uniformDataRef.lightSpread = config.lightSpread
    uniformDataRef.rayLength = config.rayLength
    uniformDataRef.sourceWidth = config.sourceWidth
    uniformDataRef.pulsating = config.pulsating ? 1.0 : 0.0
    uniformDataRef.pulsatingMin = config.pulsatingMin
    uniformDataRef.pulsatingMax = config.pulsatingMax
    uniformDataRef.fadeDistance = config.fadeDistance
    uniformDataRef.saturation = config.saturation
    uniformDataRef.mouseInfluence = config.mouseInfluence
    uniformDataRef.noiseAmount = config.noiseAmount
    uniformDataRef.distortion = config.distortion

    const dpr = Math.min(window.devicePixelRatio, 2)
    const { clientWidth: wCSS, clientHeight: hCSS } = containerRef
    const { anchor, dir } = getAnchorAndDir(config.raysOrigin, wCSS * dpr, hCSS * dpr)
    uniformDataRef.rayPos = anchor
    uniformDataRef.rayDir = dir
  })

  createEffect(() => {
    const config = props.config()
    if (!config.followMouse) {
      return
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef) {
        return
      }
      const rect = containerRef.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width
      const y = (e.clientY - rect.top) / rect.height
      mouseRef.x = x
      mouseRef.y = y
    }

    window.addEventListener("mousemove", handleMouseMove)

    onCleanup(() => {
      window.removeEventListener("mousemove", handleMouseMove)
    })
  })

  return (
    <div
      ref={containerRef}
      class={`light-rays-container ${props.class ?? ""}`.trim()}
      style={{ opacity: props.config().opacity }}
    />
  )
}

interface LightRaysControlsProps {
  config: Accessor<LightRaysConfig>
  setConfig: Setter<LightRaysConfig>
}

export function LightRaysControls(props: LightRaysControlsProps) {
  const [isOpen, setIsOpen] = createSignal(true)

  const updateConfig = <K extends keyof LightRaysConfig>(key: K, value: LightRaysConfig[K]) => {
    props.setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const origins: RaysOrigin[] = [
    "top-center",
    "top-left",
    "top-right",
    "left",
    "right",
    "bottom-center",
    "bottom-left",
    "bottom-right",
  ]

  return (
    <div class="light-rays-controls">
      <button class="light-rays-controls-toggle" onClick={() => setIsOpen(!isOpen())}>
        {isOpen() ? "▼" : "▶"} Light Rays
      </button>
      <Show when={isOpen()}>
        <div class="light-rays-controls-panel">
          <div class="control-group">
            <label>Origin</label>
            <select
              value={props.config().raysOrigin}
              onChange={(e) => updateConfig("raysOrigin", e.currentTarget.value as RaysOrigin)}
            >
              <For each={origins}>{(origin) => <option value={origin}>{origin}</option>}</For>
            </select>
          </div>

          <div class="control-group">
            <label>Color</label>
            <input
              type="color"
              value={props.config().raysColor}
              onInput={(e) => updateConfig("raysColor", e.currentTarget.value)}
            />
          </div>

          <div class="control-group">
            <label>Speed: {props.config().raysSpeed.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="3"
              step="0.01"
              value={props.config().raysSpeed}
              onInput={(e) => updateConfig("raysSpeed", parseFloat(e.currentTarget.value))}
            />
          </div>

          <div class="control-group">
            <label>Light Spread: {props.config().lightSpread.toFixed(2)}</label>
            <input
              type="range"
              min="0.1"
              max="5"
              step="0.01"
              value={props.config().lightSpread}
              onInput={(e) => updateConfig("lightSpread", parseFloat(e.currentTarget.value))}
            />
          </div>

          <div class="control-group">
            <label>Ray Length: {props.config().rayLength.toFixed(2)}</label>
            <input
              type="range"
              min="0.1"
              max="5"
              step="0.01"
              value={props.config().rayLength}
              onInput={(e) => updateConfig("rayLength", parseFloat(e.currentTarget.value))}
            />
          </div>

          <div class="control-group">
            <label>Source Width: {props.config().sourceWidth.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.01"
              value={props.config().sourceWidth}
              onInput={(e) => updateConfig("sourceWidth", parseFloat(e.currentTarget.value))}
            />
          </div>

          <div class="control-group">
            <label>Fade Distance: {props.config().fadeDistance.toFixed(2)}</label>
            <input
              type="range"
              min="0.1"
              max="3"
              step="0.01"
              value={props.config().fadeDistance}
              onInput={(e) => updateConfig("fadeDistance", parseFloat(e.currentTarget.value))}
            />
          </div>

          <div class="control-group">
            <label>Saturation: {props.config().saturation.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.01"
              value={props.config().saturation}
              onInput={(e) => updateConfig("saturation", parseFloat(e.currentTarget.value))}
            />
          </div>

          <div class="control-group">
            <label>Mouse Influence: {props.config().mouseInfluence.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={props.config().mouseInfluence}
              onInput={(e) => updateConfig("mouseInfluence", parseFloat(e.currentTarget.value))}
            />
          </div>

          <div class="control-group">
            <label>Noise: {props.config().noiseAmount.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={props.config().noiseAmount}
              onInput={(e) => updateConfig("noiseAmount", parseFloat(e.currentTarget.value))}
            />
          </div>

          <div class="control-group">
            <label>Distortion: {props.config().distortion.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.01"
              value={props.config().distortion}
              onInput={(e) => updateConfig("distortion", parseFloat(e.currentTarget.value))}
            />
          </div>

          <div class="control-group">
            <label>Opacity: {props.config().opacity.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={props.config().opacity}
              onInput={(e) => updateConfig("opacity", parseFloat(e.currentTarget.value))}
            />
          </div>

          <div class="control-group checkbox">
            <label>
              <input
                type="checkbox"
                checked={props.config().pulsating}
                onChange={(e) => updateConfig("pulsating", e.currentTarget.checked)}
              />
              Pulsating
            </label>
          </div>

          <Show when={props.config().pulsating}>
            <div class="control-group">
              <label>Pulse Min: {props.config().pulsatingMin.toFixed(2)}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={props.config().pulsatingMin}
                onInput={(e) => updateConfig("pulsatingMin", parseFloat(e.currentTarget.value))}
              />
            </div>

            <div class="control-group">
              <label>Pulse Max: {props.config().pulsatingMax.toFixed(2)}</label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={props.config().pulsatingMax}
                onInput={(e) => updateConfig("pulsatingMax", parseFloat(e.currentTarget.value))}
              />
            </div>
          </Show>

          <div class="control-group checkbox">
            <label>
              <input
                type="checkbox"
                checked={props.config().followMouse}
                onChange={(e) => updateConfig("followMouse", e.currentTarget.checked)}
              />
              Follow Mouse
            </label>
          </div>

          <button class="reset-button" onClick={() => props.setConfig(defaultConfig)}>
            Reset to Defaults
          </button>
        </div>
      </Show>
    </div>
  )
}
