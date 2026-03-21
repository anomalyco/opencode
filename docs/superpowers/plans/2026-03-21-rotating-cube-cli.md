# Rotating Cube CLI Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a command-line animated rotating 3D cube using ASCII art and terminal rendering

**Architecture:** Use mathematical rotation matrices to transform 3D cube vertices, project to 2D using orthographic projection, and render ASCII frames with terminal clearing between frames for smooth animation.

**Tech Stack:** TypeScript, Bun, terminal ASCII rendering with ANSI escape codes

---

## File Structure

- **src/cli/cube-animation.ts** - Main animation logic with cube rotation and rendering
- **src/cli/cube-animation.test.ts** - Unit tests for cube transformation and rendering
- **src/cli/commands/cube.ts** - CLI command wrapper for the animation
- **src/cli/index.ts** - Export CLI commands

## Implementation Tasks

### Task 1: Create Cube Animation Core Module

**Files:**

- Create: `src/cli/cube-animation.ts`
- Create: `src/cli/cube-animation.test.ts`

- [ ] **Step 1: Write failing test for cube vertex structure**

```typescript
import { Cube } from "./cube-animation"

describe("Cube", () => {
  test("should have 8 vertices", () => {
    const cube = new Cube()
    expect(cube.vertices.length).toBe(8)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/cli/cube-animation.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Create cube animation module with basic structure**

```typescript
// src/cli/cube-animation.ts
export class Cube {
  vertices: number[][]

  constructor() {
    // Define cube vertices in 3D space (-1 to 1)
    this.vertices = [
      [-1, -1, -1], // 0: bottom-left-back
      [1, -1, -1], // 1: bottom-right-back
      [1, 1, -1], // 2: top-right-back
      [-1, 1, -1], // 3: top-left-back
      [-1, -1, 1], // 4: bottom-left-front
      [1, -1, 1], // 5: bottom-right-front
      [1, 1, 1], // 6: top-right-front
      [-1, 1, 1], // 7: top-left-front
    ]
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/cli/cube-animation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/cube-animation.ts src/cli/cube-animation.test.ts
git commit -m "feat: add cube vertex structure"
```

### Task 2: Add Rotation Matrix Transformations

**Files:**

- Modify: `src/cli/cube-animation.ts`
- Modify: `src/cli/cube-animation.test.ts`

- [ ] **Step 1: Write failing test for rotation around X axis**

```typescript
test("should rotate vertices around X axis", () => {
  const cube = new Cube()
  const rotated = cube.rotateX(Math.PI / 2) // 90 degrees

  // After 90° rotation around X, Y and Z coordinates should swap
  const originalVertex = cube.vertices[0]
  const rotatedVertex = rotated[0]

  expect(rotatedVertex[0]).toBeCloseTo(originalVertex[0]) // X unchanged
  expect(rotatedVertex[1]).toBeCloseTo(originalVertex[2]) // Y becomes original Z
  expect(rotatedVertex[2]).toBeCloseTo(-originalVertex[1]) // Z becomes -original Y
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/cli/cube-animation.test.ts`
Expected: FAIL with "rotateX is not a function"

- [ ] **Step 3: Implement rotation matrix methods**

```typescript
export class Cube {
  vertices: number[][]

  constructor() {
    this.vertices = [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ]
  }

  rotateX(angle: number): number[][] {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)

    return this.vertices.map((vertex) => {
      const [x, y, z] = vertex
      return [x, y * cos - z * sin, y * sin + z * cos]
    })
  }

  rotateY(angle: number): number[][] {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)

    return this.vertices.map((vertex) => {
      const [x, y, z] = vertex
      return [x * cos + z * sin, y, -x * sin + z * cos]
    })
  }

  rotateZ(angle: number): number[][] {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)

    return this.vertices.map((vertex) => {
      const [x, y, z] = vertex
      return [x * cos - y * sin, x * sin + y * cos, z]
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/cli/cube-animation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/cube-animation.ts src/cli/cube-animation.test.ts
git commit -m "feat: add 3D rotation matrix transformations"
```

### Task 3: Add 3D to 2D Projection

**Files:**

- Modify: `src/cli/cube-animation.ts`
- Modify: `src/cli/cube-animation.test.ts`

- [ ] **Step 1: Write failing test for orthographic projection**

```typescript
test("should project 3D vertices to 2D coordinates", () => {
  const cube = new Cube()
  const vertices2D = cube.projectTo2D(cube.vertices)

  // All projected coordinates should be within screen bounds
  vertices2D.forEach(([x, y]) => {
    expect(x).toBeGreaterThanOrEqual(0)
    expect(x).toBeLessThanOrEqual(1)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(y).toBeLessThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/cli/cube-animation.test.ts`
Expected: FAIL with "projectTo2D is not a function"

- [ ] **Step 3: Implement orthographic projection**

```typescript
export class Cube {
  // ... existing code ...

  projectTo2D(vertices: number[][]): number[][] {
    // Simple orthographic projection - just drop Z coordinate
    // and normalize to [0, 1] range
    return vertices.map((vertex) => {
      const [x, y, z] = vertex
      return [
        (x + 1) / 2, // Convert from [-1,1] to [0,1]
        (y + 1) / 2, // Convert from [-1,1] to [0,1]
      ]
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/cli/cube-animation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/cube-animation.ts src/cli/cube-animation.test.ts
git commit -m "feat: add 3D to 2D orthographic projection"
```

### Task 4: Add ASCII Rendering

**Files:**

- Modify: `src/cli/cube-animation.ts`
- Modify: `src/cli/cube-animation.test.ts`

- [ ] **Step 1: Write failing test for ASCII rendering**

```typescript
test("should render cube as ASCII art", () => {
  const cube = new Cube()
  const frame = cube.renderFrame(40, 20)

  expect(typeof frame).toBe("string")
  expect(frame.length).toBeGreaterThan(0)
  expect(frame).toContain("\n") // Should be multi-line
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/cli/cube-animation.test.ts`
Expected: FAIL with "renderFrame is not a function"

- [ ] **Step 3: Implement ASCII rendering with line drawing**

```typescript
export class Cube {
  // ... existing code ...

  renderFrame(width: number, height: number, vertices2D?: number[][]): string {
    // Create empty canvas
    const canvas: string[][] = Array(height)
      .fill(null)
      .map(() => Array(width).fill(" "))

    // Use provided vertices or default
    const vertices = vertices2D || this.projectTo2D(this.vertices)

    // Define cube edges (connections between vertices)
    const edges = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0], // back face
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4], // front face
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7], // connecting edges
    ]

    // Draw each edge
    for (const [v1, v2] of edges) {
      const [x1, y1] = vertices[v1]
      const [x2, y2] = vertices[v2]

      // Convert normalized coordinates to screen coordinates
      const screenX1 = Math.floor(x1 * (width - 1))
      const screenY1 = Math.floor(y1 * (height - 1))
      const screenX2 = Math.floor(x2 * (width - 1))
      const screenY2 = Math.floor(y2 * (height - 1))

      // Draw line using Bresenham's algorithm
      this.drawLine(canvas, screenX1, screenY1, screenX2, screenY2, "*")
    }

    // Convert canvas to string
    return canvas.map((row) => row.join("")).join("\n")
  }

  private drawLine(canvas: string[][], x1: number, y1: number, x2: number, y2: number, char: string) {
    const dx = Math.abs(x2 - x1)
    const dy = Math.abs(y2 - y1)
    const sx = x1 < x2 ? 1 : -1
    const sy = y1 < y2 ? 1 : -1
    let err = dx - dy

    let x = x1
    let y = y1

    while (true) {
      if (y >= 0 && y < canvas.length && x >= 0 && x < canvas[0].length) {
        canvas[y][x] = char
      }

      if (x === x2 && y === y2) break

      const e2 = 2 * err
      if (e2 > -dy) {
        err -= dy
        x += sx
      }
      if (e2 < dx) {
        err += dx
        y += sy
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/cli/cube-animation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/cube-animation.ts src/cli/cube-animation.test.ts
git commit -m "feat: add ASCII rendering with line drawing"
```

### Task 5: Add Animation Loop

**Files:**

- Modify: `src/cli/cube-animation.ts`
- Modify: `src/cli/cube-animation.test.ts`

- [ ] \*\*Step 1: Write failing test for animation"

```typescript
test("should animate cube rotation", async () => {
  const cube = new Cube()
  const frames: string[] = []

  // Capture 3 frames
  await cube.animate(3, 100, (frame) => {
    frames.push(frame)
  })

  expect(frames.length).toBe(3)
  expect(frames[0]).not.toBe(frames[1]) // Frames should differ
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/cli/cube-animation.test.ts`
Expected: FAIL with "animate is not a function"

- [ ] \*\*Step 3: Implement animation loop with rotation"

```typescript
export class Cube {
  // ... existing code ...

  async animate(frameCount: number, frameDelay: number, onFrame: (frame: string) => void) {
    const width = 40
    const height = 20

    for (let i = 0; i < frameCount; i++) {
      // Calculate rotation angles
      const angleX = (i * Math.PI * 2) / frameCount
      const angleY = (i * Math.PI * 2) / (frameCount * 2)

      // Apply rotations
      let vertices = this.rotateX(angleX)
      vertices = this.rotateY(angleY)

      // Project to 2D and render
      const vertices2D = this.projectTo2D(vertices)
      const frame = this.renderFrame(width, height, vertices2D)

      // Send frame to callback
      onFrame(frame)

      // Wait for next frame
      await new Promise((resolve) => setTimeout(resolve, frameDelay))
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/cli/cube-animation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/cube-animation.ts src/cli/cube-animation.test.ts
git commit -m "feat: add animation loop with rotation"
```

### Task 6: Create CLI Command

**Files:**

- Create: `src/cli/commands/cube.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Create CLI command for cube animation**

```typescript
// src/cli/commands/cube.ts
import { Command } from "commander"
import { Cube } from "../cube-animation"

export function cubeCommand(): Command {
  return new Command("cube")
    .description("Display rotating 3D cube animation")
    .option("-f, --frames <number>", "Number of frames to display", "60")
    .option("-d, --delay <number>", "Delay between frames in ms", "100")
    .action(async (options) => {
      const frames = parseInt(options.frames)
      const delay = parseInt(options.delay)

      const cube = new Cube()

      console.log("Starting cube animation... (Ctrl+C to stop)")

      await cube.animate(frames, delay, (frame) => {
        // Clear terminal and display frame
        process.stdout.write("\x1B[2J\x1B[0f") // Clear screen and move cursor to top
        console.log(frame)
      })

      console.log("Animation complete!")
    })
}
```

- [ ] **Step 2: Export CLI command in index**

```typescript
// src/cli/index.ts
export { cubeCommand } from "./commands/cube"
```

- [ ] **Step 3: Test CLI command manually**

Run: `bun run src/cli/commands/cube.ts` (or integrate with existing CLI)
Expected: Should compile without errors

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/cube.ts src/cli/index.ts
git commit -m "feat: add cube animation CLI command"
```

### Task 7: Integration and Polish

**Files:**

- Modify: `src/cli/cube-animation.ts`
- Modify: `src/cli/commands/cube.ts`

- [ ] \*\*Step 1: Add terminal size detection"

```typescript
// In cube.ts action function
const terminalWidth = process.stdout.columns || 80
const terminalHeight = process.stdout.rows || 24

// Use smaller dimensions for margins
const width = Math.min(terminalWidth - 4, 60)
const height = Math.min(terminalHeight - 4, 20)
```

- [ ] \*\*Step 2: Add smooth animation with proper clearing"

```typescript
// In cube.ts action function
await cube.animate(frames, delay, (frame) => {
  process.stdout.write("\x1B[2J\x1B[0f") // Clear entire screen
  process.stdout.write("Rotating Cube Animation\n\n")
  process.stdout.write(frame)
  process.stdout.write("\n\nPress Ctrl+C to stop")
})
```

- [ ] \*\*Step 3: Test full animation"

Run the CLI command and verify:

- Cube rotates smoothly
- Animation can be stopped with Ctrl+C
- Terminal clears properly between frames

- [ ] \*\*Step 4: Commit final polish"

```bash
git add src/cli/cube-animation.ts src/cli/commands/cube.ts
git commit -m "feat: polish cube animation with terminal sizing and smooth rendering"
```

## Summary

This plan creates a complete rotating 3D cube animation for the command line with:

- Mathematical 3D transformations using rotation matrices
- Orthographic projection to 2D
- ASCII art rendering with line drawing
- Smooth animation loop with configurable frame rate
- CLI command integration with terminal size detection
- Comprehensive test coverage
