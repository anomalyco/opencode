export type RenderGeometryScreenMode = "alternate-screen" | "main-screen" | "split-footer";
export interface RenderGeometry {
    effectiveFooterHeight: number;
    renderOffset: number;
    renderWidth: number;
    renderHeight: number;
}
export declare function calculateRenderGeometry(screenMode: RenderGeometryScreenMode, terminalWidth: number, terminalHeight: number, footerHeight: number): RenderGeometry;
