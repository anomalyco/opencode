import { OrthographicCamera, PerspectiveCamera, Scene } from "three";
import { OptimizedBuffer } from "../buffer.js";
import { Renderable, type RenderableOptions } from "../Renderable.js";
import type { RenderContext } from "../types.js";
import { ThreeCliRenderer, type ThreeCliRendererOptions } from "./WGPURenderer.js";
export interface ThreeRenderableOptions extends RenderableOptions<ThreeRenderable> {
    scene?: Scene | null;
    camera?: PerspectiveCamera | OrthographicCamera;
    renderer?: Omit<ThreeCliRendererOptions, "width" | "height" | "autoResize">;
    autoAspect?: boolean;
}
export declare class ThreeRenderable extends Renderable {
    private engine;
    private scene;
    private autoAspect;
    private initPromise;
    private initFailed;
    private drawInFlight;
    private frameCallback;
    private frameCallbackRegistered;
    private cliRenderer;
    private clearColor;
    constructor(ctx: RenderContext, options: ThreeRenderableOptions);
    get aspectRatio(): number;
    get renderer(): ThreeCliRenderer;
    getScene(): Scene | null;
    setScene(scene: Scene | null): void;
    getActiveCamera(): PerspectiveCamera | OrthographicCamera;
    setActiveCamera(camera: PerspectiveCamera | OrthographicCamera): void;
    setAutoAspect(autoAspect: boolean): void;
    protected onResize(width: number, height: number): void;
    protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void;
    protected destroySelf(): void;
    private registerFrameCallback;
    private renderToBuffer;
    private ensureInitialized;
    private updateCameraAspect;
    private getAspectRatio;
    private getRenderSize;
}
