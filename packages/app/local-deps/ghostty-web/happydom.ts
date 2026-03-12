/**
 * Happy DOM Setup for Tests
 *
 * This file is preloaded by Bun before running tests (configured in bunfig.toml).
 * It registers Happy DOM's global objects (window, document, HTMLElement, etc.)
 * so that tests requiring DOM APIs can run successfully.
 *
 * @see bunfig.toml - test.preload configuration
 * @see https://bun.sh/docs/test/dom
 */

import { GlobalRegistrator } from '@happy-dom/global-registrator';

// Register Happy DOM globals (window, document, etc.)
GlobalRegistrator.register();

// Mock Canvas 2D Context
// Happy DOM doesn't provide canvas rendering APIs, so we mock them for testing.
// This provides enough functionality for terminal tests to run without actual rendering.
const originalGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (contextType: string, options?: any) {
  if (contextType === '2d') {
    // Return a minimal mock of CanvasRenderingContext2D
    return {
      canvas: this,
      fillStyle: '#000000',
      strokeStyle: '#000000',
      font: '12px monospace',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      imageSmoothingEnabled: true,
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      miterLimit: 10,
      shadowBlur: 0,
      shadowColor: 'rgba(0, 0, 0, 0)',
      shadowOffsetX: 0,
      shadowOffsetY: 0,

      // Drawing methods (no-ops for tests)
      fillRect: () => {},
      strokeRect: () => {},
      clearRect: () => {},
      fillText: () => {},
      strokeText: () => {},
      measureText: (text: string) => ({ width: text.length * 8 }),
      drawImage: () => {},
      save: () => {},
      restore: () => {},
      scale: () => {},
      rotate: () => {},
      translate: () => {},
      transform: () => {},
      setTransform: () => {},
      resetTransform: () => {},
      createLinearGradient: () => ({
        addColorStop: () => {},
      }),
      createRadialGradient: () => ({
        addColorStop: () => {},
      }),
      createPattern: () => null,
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      bezierCurveTo: () => {},
      quadraticCurveTo: () => {},
      arc: () => {},
      arcTo: () => {},
      ellipse: () => {},
      rect: () => {},
      fill: () => {},
      stroke: () => {},
      clip: () => {},
      isPointInPath: () => false,
      isPointInStroke: () => false,
      getTransform: () => ({}),
      getImageData: () => ({
        data: new Uint8ClampedArray(0),
        width: 0,
        height: 0,
      }),
      putImageData: () => {},
      createImageData: () => ({
        data: new Uint8ClampedArray(0),
        width: 0,
        height: 0,
      }),
    } as any;
  }
  return originalGetContext.call(this, contextType, options);
};
