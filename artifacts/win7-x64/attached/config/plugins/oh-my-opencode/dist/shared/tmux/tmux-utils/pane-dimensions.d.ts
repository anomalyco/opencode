export interface PaneDimensions {
    paneWidth: number;
    windowWidth: number;
}
export declare function getPaneDimensions(paneId: string): Promise<PaneDimensions | null>;
