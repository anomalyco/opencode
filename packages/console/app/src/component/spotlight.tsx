import { createSignal, createEffect, onMount, onCleanup, Accessor } from "solid-js"
import "./spotlight.css"

export interface ParticlesConfig {
  enabled: boolean
  amount: number
  size: [number, number]
  speed: number
  opacity: number
  drift: number
}

export interface SpotlightConfig {
  placement: [number, number]
  color: string
  speed: number
  spread: number
  length: number
  width: number
  pulsating: false | [number, number]
  distance: number
  saturation: number
  noiseAmount: number
  distortion: number
  opacity: number
  particles: ParticlesConfig
}

export const defaultConfig: SpotlightConfig = {
  placement: [0.5, -0.15],
  color: "#ffffff",
  speed: 0.8,
  spread: 0.5,
  length: 4.0,
  width: 0.15,
  pulsating: [0.95, 1.1],
  distance: 3.5,
  saturation: 0.35,
  noiseAmount: 0.15,
  distortion: 0.05,
  opacity: 0.325,
  particles: {
    enabled: true,
    amount: 70,
    size: [1.25, 1.5],
    speed: 0.75,
    opacity: 0.9,
    drift: 1.5,
  },
}

export interface SpotlightAnimationState {
  time: number
  intensity: number
  pulseValue: number
}

interface SpotlightProps {
  config: Accessor<SpotlightConfig>
  class?: string
  onAnimationFrame?: (state: SpotlightAnimationState) => void
}

const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [1, 1, 1]
}

const getAnchorAndDir = (
  placement: [number, number],
  w: number,
  h: number,
): { anchor: [number, number]; dir: [number, number] } => {
  const [px, py] = placement
  const outside = 0.2

  let anchorX = px * w
  let anchorY = py * h
  let dirX = 0
  let dirY = 0

  const centerX = 0.5
  const centerY = 0.5

  if (py <= 0.25) {
    anchorY = -outside * h + py * h
    dirY = 1
    dirX = (centerX - px) * 0.5
  } else if (py >= 0.75) {
    anchorY = (1 + outside) * h - (1 - py) * h
    dirY = -1
    dirX = (centerX - px) * 0.5
  } else if (px <= 0.25) {
    anchorX = -outside * w + px * w
    dirX = 1
    dirY = (centerY - py) * 0.5
  } else if (px >= 0.75) {
    anchorX = (1 + outside) * w - (1 - px) * w
    dirX = -1
    dirY = (centerY - py) * 0.5
  } else {
    dirY = 1
  }

  const len = Math.sqrt(dirX * dirX + dirY * dirY)
  if (len > 0) {
    dirX /= len
    dirY /= len
  }

  return { anchor: [anchorX, anchorY], dir: [dirX, dirY] }
}

interface UniformData {
  iTime: number
  iResolution: [number, number]
  lightPos: [number, number]
  lightDir: [number, number]
  color: [number, number, number]
  speed: number
  lightSpread: number
  lightLength: number
  sourceWidth: number
  pulsating: number
  pulsatingMin: number
  pulsatingMax: number
  fadeDistance: number
  saturation: number
  noiseAmount: number
  distortion: number
  particlesEnabled: number
  particleAmount: number
  particleSizeMin: number
  particleSizeMax: number
  particleSpeed: number
  particleOpacity: number
  particleDrift: number
}

const WGSL_SHADER = `
  struct Uniforms {
    iTime: f32,
    _pad0: f32,
    iResolution: vec2<f32>,
    lightPos: vec2<f32>,
    lightDir: vec2<f32>,
    color: vec3<f32>, 
    speed: f32,
    lightSpread: f32,
    lightLength: f32,
    sourceWidth: f32,
    pulsating: f32,
    pulsatingMin: f32,
    pulsatingMax: f32,
    fadeDistance: f32,
    saturation: f32,
    noiseAmount: f32,
    distortion: f32,
    particlesEnabled: f32,
    particleAmount: f32,
    particleSizeMin: f32,
    particleSizeMax: f32,
    particleSpeed: f32,
    particleOpacity: f32,
    particleDrift: f32,
    _pad1: f32,
    _pad2: f32,
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

  fn hash(p: vec2<f32>) -> f32 {
    let p3 = fract(p.xyx * 0.1031);
    return fract((p3.x + p3.y) * p3.z + dot(p3, p3.yzx + 33.33));
  }

  fn hash2(p: vec2<f32>) -> vec2<f32> {
    let n = sin(dot(p, vec2<f32>(41.0, 289.0)));
    return fract(vec2<f32>(n * 262144.0, n * 32768.0));
  }

  fn fastNoise(st: vec2<f32>) -> f32 {
    return fract(sin(dot(st, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  }

  fn lightStrengthCombined(lightSource: vec2<f32>, lightRefDirection: vec2<f32>, coord: vec2<f32>) -> f32 {
    let sourceToCoord = coord - lightSource;
    let distSq = dot(sourceToCoord, sourceToCoord);
    let distance = sqrt(distSq);
    
    let baseSize = min(uniforms.iResolution.x, uniforms.iResolution.y);
    let maxDistance = max(baseSize * uniforms.lightLength, 0.001);
    if (distance > maxDistance) {
      return 0.0;
    }
    
    let invDist = 1.0 / max(distance, 0.001);
    let dirNorm = sourceToCoord * invDist;
    let cosAngle = dot(dirNorm, lightRefDirection);
    
    if (cosAngle < 0.0) {
      return 0.0;
    }

    let side = dot(dirNorm, vec2<f32>(-lightRefDirection.y, lightRefDirection.x));
    let time = uniforms.iTime;
    let speed = uniforms.speed;
    
    let asymNoise = fastNoise(vec2<f32>(side * 6.0 + time * 0.12, distance * 0.004 + cosAngle * 2.0));
    let asymShift = (asymNoise - 0.5) * uniforms.distortion * 0.6;
    
    let distortPhase = time * 1.4 + distance * 0.006 + cosAngle * 4.5 + side * 1.7;
    let distortedAngle = cosAngle + uniforms.distortion * sin(distortPhase) * 0.22 + asymShift;
    
    let flickerSeed = cosAngle * 9.0 + side * 4.0 + time * speed * 0.35;
    let flicker = 0.86 + fastNoise(vec2<f32>(flickerSeed, distance * 0.01)) * 0.28;
    
    let asymSpread = max(uniforms.lightSpread * (0.9 + (asymNoise - 0.5) * 0.25), 0.001);
    let spreadFactor = pow(max(distortedAngle, 0.0), 1.0 / asymSpread);
    let lengthFalloff = clamp(1.0 - distance / maxDistance, 0.0, 1.0);
    
    let fadeMaxDist = max(baseSize * uniforms.fadeDistance, 0.001);
    let fadeFalloff = clamp((fadeMaxDist - distance) / fadeMaxDist, 0.0, 1.0);
    
    var pulse: f32 = 1.0;
    if (uniforms.pulsating > 0.5) {
      let pulseCenter = (uniforms.pulsatingMin + uniforms.pulsatingMax) * 0.5;
      let pulseAmplitude = (uniforms.pulsatingMax - uniforms.pulsatingMin) * 0.5;
      pulse = pulseCenter + pulseAmplitude * sin(time * speed * 3.0);
    }

    let timeSpeed = time * speed;
    let wave = 0.5
      + 0.25 * sin(cosAngle * 28.0 + side * 8.0 + timeSpeed * 1.2)
      + 0.18 * cos(cosAngle * 22.0 - timeSpeed * 0.95 + side * 6.0)
      + 0.12 * sin(cosAngle * 35.0 + timeSpeed * 1.6 + asymNoise * 3.0);
    let minStrength = 0.14 + asymNoise * 0.06;
    let baseStrength = max(clamp(wave * (0.85 + asymNoise * 0.3), 0.0, 1.0), minStrength);

    let lightStrength = baseStrength * lengthFalloff * fadeFalloff * spreadFactor * pulse * flicker;
    let ambientLight = (0.06 + asymNoise * 0.04) * lengthFalloff * fadeFalloff * spreadFactor;

    return max(lightStrength, ambientLight);
  }

  fn particle(coord: vec2<f32>, particlePos: vec2<f32>, size: f32) -> f32 {
    let delta = coord - particlePos;
    let distSq = dot(delta, delta);
    let sizeSq = size * size;
    
    if (distSq > sizeSq * 9.0) {
      return 0.0;
    }
    
    let d = sqrt(distSq);
    let core = smoothstep(size, size * 0.35, d);
    let glow = smoothstep(size * 3.0, 0.0, d) * 0.55;
    return core + glow;
  }

  fn renderParticles(coord: vec2<f32>, lightSource: vec2<f32>, lightDir: vec2<f32>) -> f32 {
    if (uniforms.particlesEnabled < 0.5 || uniforms.particleAmount < 1.0) {
      return 0.0;
    }

    var particleSum: f32 = 0.0;
    let particleCount = i32(uniforms.particleAmount);
    let time = uniforms.iTime * uniforms.particleSpeed;
    let perpDir = vec2<f32>(-lightDir.y, lightDir.x);
    let baseSize = min(uniforms.iResolution.x, uniforms.iResolution.y);
    let maxDist = max(baseSize * uniforms.lightLength, 1.0);
    let spreadScale = uniforms.lightSpread * baseSize * 0.65;
    let coneHalfWidth = uniforms.lightSpread * baseSize * 0.55;
    
    for (var i: i32 = 0; i < particleCount; i = i + 1) {
      let fi = f32(i);
      let seed = vec2<f32>(fi * 127.1, fi * 311.7);
      let rnd = hash2(seed);
      
      let lifeDuration = 2.0 + hash(seed + vec2<f32>(19.0, 73.0)) * 3.0;
      let lifeOffset = hash(seed + vec2<f32>(91.0, 37.0)) * lifeDuration;
      let lifeProgress = fract((time + lifeOffset) / lifeDuration);
      
      let fadeIn = smoothstep(0.0, 0.2, lifeProgress);
      let fadeOut = 1.0 - smoothstep(0.8, 1.0, lifeProgress);
      let lifeFade = fadeIn * fadeOut;
      if (lifeFade < 0.01) {
        continue;
      }
      
      let alongLight = rnd.x * maxDist * 0.8;
      let perpOffset = (rnd.y - 0.5) * spreadScale;
      
      let floatPhase = rnd.y * 6.28318 + fi * 0.37;
      let floatSpeed = 0.35 + rnd.x * 0.9;
      let drift = vec2<f32>(
        sin(time * floatSpeed + floatPhase),
        cos(time * floatSpeed * 0.85 + floatPhase * 1.3)
      ) * uniforms.particleDrift * baseSize * 0.08;
      
      let wobble = vec2<f32>(
        sin(time * 1.4 + floatPhase * 2.1),
        cos(time * 1.1 + floatPhase * 1.6)
      ) * uniforms.particleDrift * baseSize * 0.03;
      
      let flowOffset = (rnd.x - 0.5) * baseSize * 0.12 + fract(time * 0.06 + rnd.y) * baseSize * 0.1;
      
      let basePos = lightSource + lightDir * (alongLight + flowOffset) + perpDir * perpOffset + drift + wobble;
      
      let toParticle = basePos - lightSource;
      let projLen = dot(toParticle, lightDir);
      if (projLen < 0.0 || projLen > maxDist) {
        continue;
      }
      
      let sideDist = abs(dot(toParticle, perpDir));
      if (sideDist > coneHalfWidth) {
        continue;
      }
      
      let size = mix(uniforms.particleSizeMin, uniforms.particleSizeMax, rnd.x);
      let twinkle = 0.7 + 0.3 * sin(time * (1.5 + rnd.y * 2.0) + floatPhase);
      let distFade = 1.0 - smoothstep(maxDist * 0.2, maxDist * 0.95, projLen);
      if (distFade < 0.01) {
        continue;
      }
      
      let p = particle(coord, basePos, size);
      if (p > 0.0) {
        particleSum = particleSum + p * lifeFade * twinkle * distFade * uniforms.particleOpacity;
        if (particleSum >= 1.0) {
          break;
        }
      }
    }
    
    return min(particleSum, 1.0);
  }

  @fragment
  fn fragmentMain(@builtin(position) fragCoord: vec4<f32>, @location(0) vUv: vec2<f32>) -> @location(0) vec4<f32> {
    let coord = vec2<f32>(fragCoord.x, fragCoord.y);
    
    let normalizedX = (coord.x / uniforms.iResolution.x) - 0.5;
    let widthOffset = -normalizedX * uniforms.sourceWidth * uniforms.iResolution.x;
    
    let perpDir = vec2<f32>(-uniforms.lightDir.y, uniforms.lightDir.x);
    let adjustedLightPos = uniforms.lightPos + perpDir * widthOffset;
    
    let lightValue = lightStrengthCombined(adjustedLightPos, uniforms.lightDir, coord);
    
    if (lightValue < 0.001) {
      let particles = renderParticles(coord, adjustedLightPos, uniforms.lightDir);
      if (particles < 0.001) {
        return vec4<f32>(0.0, 0.0, 0.0, 0.0);
      }
      let particleBrightness = particles * 1.8;
      return vec4<f32>(uniforms.color * particleBrightness, particles * 0.9);
    }

    var fragColor = vec4<f32>(lightValue, lightValue, lightValue, lightValue);

    if (uniforms.noiseAmount > 0.01) {
      let n = fastNoise(coord * 0.5 + uniforms.iTime * 0.5);
      let grain = mix(1.0, n, uniforms.noiseAmount * 0.5);
      fragColor = vec4<f32>(fragColor.rgb * grain, fragColor.a);
    }

    let brightness = 1.0 - (coord.y / uniforms.iResolution.y);
    fragColor = vec4<f32>(
      fragColor.x * (0.15 + brightness * 0.85),
      fragColor.y * (0.35 + brightness * 0.65),
      fragColor.z * (0.55 + brightness * 0.45),
      fragColor.a
    );

    if (abs(uniforms.saturation - 1.0) > 0.01) {
      let gray = dot(fragColor.rgb, vec3<f32>(0.299, 0.587, 0.114));
      fragColor = vec4<f32>(mix(vec3<f32>(gray), fragColor.rgb, uniforms.saturation), fragColor.a);
    }

    fragColor = vec4<f32>(fragColor.rgb * uniforms.color, fragColor.a);
    
    let particles = renderParticles(coord, adjustedLightPos, uniforms.lightDir);
    if (particles > 0.001) {
      let particleBrightness = particles * 1.8;
      fragColor = vec4<f32>(fragColor.rgb + uniforms.color * particleBrightness, max(fragColor.a, particles * 0.9));
    }
    
    return fragColor;
  }
`

const UNIFORM_BUFFER_SIZE = 144

function updateUniformBuffer(buffer: Float32Array, data: UniformData): void {
  buffer[0] = data.iTime
  buffer[2] = data.iResolution[0]
  buffer[3] = data.iResolution[1]
  buffer[4] = data.lightPos[0]
  buffer[5] = data.lightPos[1]
  buffer[6] = data.lightDir[0]
  buffer[7] = data.lightDir[1]
  buffer[8] = data.color[0]
  buffer[9] = data.color[1]
  buffer[10] = data.color[2]
  buffer[11] = data.speed
  buffer[12] = data.lightSpread
  buffer[13] = data.lightLength
  buffer[14] = data.sourceWidth
  buffer[15] = data.pulsating
  buffer[16] = data.pulsatingMin
  buffer[17] = data.pulsatingMax
  buffer[18] = data.fadeDistance
  buffer[19] = data.saturation
  buffer[20] = data.noiseAmount
  buffer[21] = data.distortion
  buffer[22] = data.particlesEnabled
  buffer[23] = data.particleAmount
  buffer[24] = data.particleSizeMin
  buffer[25] = data.particleSizeMax
  buffer[26] = data.particleSpeed
  buffer[27] = data.particleOpacity
  buffer[28] = data.particleDrift
}

export default function Spotlight(props: SpotlightProps) {
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
  let uniformArrayRef: Float32Array | null = null
  let configRef: SpotlightConfig = props.config()
  let frameCount = 0

  const [isVisible, setIsVisible] = createSignal(false)

  createEffect(() => {
    configRef = props.config()
  })

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

      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: "high-performance",
      })
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
        size: UNIFORM_BUFFER_SIZE,
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
      const { anchor, dir } = getAnchorAndDir(config.placement, w, h)

      uniformDataRef = {
        iTime: 0,
        iResolution: [w, h],
        lightPos: anchor,
        lightDir: dir,
        color: hexToRgb(config.color),
        speed: config.speed,
        lightSpread: config.spread,
        lightLength: config.length,
        sourceWidth: config.width,
        pulsating: config.pulsating !== false ? 1.0 : 0.0,
        pulsatingMin: config.pulsating !== false ? config.pulsating[0] : 1.0,
        pulsatingMax: config.pulsating !== false ? config.pulsating[1] : 1.0,
        fadeDistance: config.distance,
        saturation: config.saturation,
        noiseAmount: config.noiseAmount,
        distortion: config.distortion,
        particlesEnabled: config.particles.enabled ? 1.0 : 0.0,
        particleAmount: config.particles.amount,
        particleSizeMin: config.particles.size[0],
        particleSizeMax: config.particles.size[1],
        particleSpeed: config.particles.speed,
        particleOpacity: config.particles.opacity,
        particleDrift: config.particles.drift,
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

        const { anchor, dir } = getAnchorAndDir(configRef.placement, w, h)
        uniformDataRef.lightPos = anchor
        uniformDataRef.lightDir = dir
      }

      const loop = (t: number) => {
        if (!deviceRef || !contextRef || !pipelineRef || !uniformBufferRef || !bindGroupRef || !uniformDataRef) {
          return
        }

        const timeSeconds = t * 0.001
        uniformDataRef.iTime = timeSeconds
        frameCount++

        if (props.onAnimationFrame && frameCount % 2 === 0) {
          const pulsatingMin = configRef.pulsating !== false ? configRef.pulsating[0] : 1.0
          const pulsatingMax = configRef.pulsating !== false ? configRef.pulsating[1] : 1.0
          const pulseCenter = (pulsatingMin + pulsatingMax) * 0.5
          const pulseAmplitude = (pulsatingMax - pulsatingMin) * 0.5
          const pulseValue =
            configRef.pulsating !== false
              ? pulseCenter + pulseAmplitude * Math.sin(timeSeconds * configRef.speed * 3.0)
              : 1.0

          const baseIntensity1 = 0.45 + 0.15 * Math.sin(timeSeconds * configRef.speed * 1.5)
          const baseIntensity2 = 0.3 + 0.2 * Math.cos(timeSeconds * configRef.speed * 1.1)
          const intensity = Math.max((baseIntensity1 + baseIntensity2) * pulseValue, 0.55)

          props.onAnimationFrame({
            time: timeSeconds,
            intensity,
            pulseValue: Math.max(pulseValue, 0.9),
          })
        }

        try {
          if (!uniformArrayRef) {
            uniformArrayRef = new Float32Array(36)
          }
          updateUniformBuffer(uniformArrayRef, uniformDataRef)
          deviceRef.queue.writeBuffer(uniformBufferRef, 0, uniformArrayRef.buffer)

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

    uniformDataRef.color = hexToRgb(config.color)
    uniformDataRef.speed = config.speed
    uniformDataRef.lightSpread = config.spread
    uniformDataRef.lightLength = config.length
    uniformDataRef.sourceWidth = config.width
    uniformDataRef.pulsating = config.pulsating !== false ? 1.0 : 0.0
    uniformDataRef.pulsatingMin = config.pulsating !== false ? config.pulsating[0] : 1.0
    uniformDataRef.pulsatingMax = config.pulsating !== false ? config.pulsating[1] : 1.0
    uniformDataRef.fadeDistance = config.distance
    uniformDataRef.saturation = config.saturation
    uniformDataRef.noiseAmount = config.noiseAmount
    uniformDataRef.distortion = config.distortion
    uniformDataRef.particlesEnabled = config.particles.enabled ? 1.0 : 0.0
    uniformDataRef.particleAmount = config.particles.amount
    uniformDataRef.particleSizeMin = config.particles.size[0]
    uniformDataRef.particleSizeMax = config.particles.size[1]
    uniformDataRef.particleSpeed = config.particles.speed
    uniformDataRef.particleOpacity = config.particles.opacity
    uniformDataRef.particleDrift = config.particles.drift

    const dpr = Math.min(window.devicePixelRatio, 2)
    const { clientWidth: wCSS, clientHeight: hCSS } = containerRef
    const { anchor, dir } = getAnchorAndDir(config.placement, wCSS * dpr, hCSS * dpr)
    uniformDataRef.lightPos = anchor
    uniformDataRef.lightDir = dir
  })

  return (
    <div
      ref={containerRef}
      class={`spotlight-container ${props.class ?? ""}`.trim()}
      style={{ opacity: props.config().opacity }}
    />
  )
}
