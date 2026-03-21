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
