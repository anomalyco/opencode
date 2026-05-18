import { PerspectiveCamera, OrthographicCamera, Scene } from "three";
import type { OptimizedBuffer } from "../buffer.js";
import { RGBA } from "../lib/RGBA.js";
import { SuperSampleAlgorithm } from "./canvas.js";
import { type CliRenderer } from "../renderer.js";
export declare enum SuperSampleType {
    NONE = "none",
    GPU = "gpu",
    CPU = "cpu"
}
export interface ThreeCliRendererOptions {
    width: number;
    height: number;
    focalLength?: number;
    backgroundColor?: RGBA;
    superSample?: SuperSampleType;
    alpha?: boolean;
    autoResize?: boolean;
    libPath?: string;
}
export declare class ThreeCliRenderer {
    private readonly cliRenderer;
    private outputWidth;
    private outputHeight;
    private renderWidth;
    private renderHeight;
    private superSample;
    private backgroundColor;
    private alpha;
    private threeRenderer?;
    private canvas?;
    private device;
    private activeCamera;
    private _aspectRatio;
    private doRenderStats;
    private resizeHandler;
    private debugToggleHandler;
    private destroyHandler;
    private renderTimeMs;
    private readbackTimeMs;
    private totalDrawTimeMs;
    private renderMethod;
    get aspectRatio(): number;
    constructor(cliRenderer: CliRenderer, options: ThreeCliRendererOptions);
    toggleDebugStats(): void;
    init(): Promise<void>;
    getSuperSampleAlgorithm(): SuperSampleAlgorithm;
    setSuperSampleAlgorithm(superSampleAlgorithm: SuperSampleAlgorithm): void;
    saveToFile(filePath: string): Promise<void>;
    setActiveCamera(camera: PerspectiveCamera | OrthographicCamera): void;
    getActiveCamera(): PerspectiveCamera | OrthographicCamera;
    setBackgroundColor(color: RGBA): void;
    setSize(width: number, height: number, forceUpdate?: boolean): void;
    drawScene(root: Scene, buffer: OptimizedBuffer, deltaTime: number): Promise<void>;
    private rendering;
    private destroyed;
    doDrawScene(root: Scene, camera: PerspectiveCamera | OrthographicCamera, buffer: OptimizedBuffer, deltaTime: number): Promise<void>;
    toggleSuperSampling(): void;
    renderStats(buffer: OptimizedBuffer): void;
    destroy(): void;
}
