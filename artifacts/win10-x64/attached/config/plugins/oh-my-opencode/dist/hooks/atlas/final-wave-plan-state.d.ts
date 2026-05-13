export type FinalWavePlanState = {
    pendingImplementationTaskCount: number;
    pendingFinalWaveTaskCount: number;
};
export declare function readFinalWavePlanState(planPath: string): FinalWavePlanState | null;
