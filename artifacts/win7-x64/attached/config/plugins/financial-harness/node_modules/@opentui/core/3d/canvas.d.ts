import { GPUCanvasContextMock } from "bun-webgpu";
import { SuperSampleType } from "./WGPURenderer.js";
import type { OptimizedBuffer } from "../buffer.js";
export declare enum SuperSampleAlgorithm {
    STANDARD = 0,
    PRE_SQUEEZED = 1
}
export declare class CLICanvas {
    private device;
    private readbackBuffer;
    private width;
    private height;
    private gpuCanvasContext;
    superSampleDrawTimeMs: number;
    mapAsyncTimeMs: number;
    superSample: SuperSampleType;
    private computePipeline;
    private computeBindGroupLayout;
    private computeOutputBuffer;
    private computeParamsBuffer;
    private computeReadbackBuffer;
    private updateScheduled;
    private screenshotGPUBuffer;
    private superSampleAlgorithm;
    private destroyed;
    constructor(device: GPUDevice, width: number, height: number, superSample: SuperSampleType, sampleAlgo?: SuperSampleAlgorithm);
    destroy(): void;
    setSuperSampleAlgorithm(superSampleAlgorithm: SuperSampleAlgorithm): void;
    getSuperSampleAlgorithm(): SuperSampleAlgorithm;
    getContext(type: string, attrs?: WebGLContextAttributes): GPUCanvasContextMock;
    setSize(width: number, height: number): void;
    addEventListener(event: string, listener: any, options?: any): void;
    removeEventListener(event: string, listener: any, options?: any): void;
    dispatchEvent(event: Event): void;
    setSuperSample(superSample: SuperSampleType): void;
    saveToFile(filePath: string): Promise<void>;
    private initComputePipeline;
    private updateComputeParams;
    private scheduleUpdateComputeBuffers;
    private updateComputeBuffers;
    private runComputeShaderSuperSampling;
    private updateReadbackBuffer;
    readPixelsIntoBuffer(buffer: OptimizedBuffer): Promise<void>;
}
