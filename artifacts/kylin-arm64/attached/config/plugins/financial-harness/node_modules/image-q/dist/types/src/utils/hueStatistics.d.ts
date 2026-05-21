export declare class HueStatistics {
    private _numGroups;
    private _minCols;
    private _stats;
    private _groupsFull;
    constructor(numGroups: number, minCols: number);
    check(i32: number): void;
    injectIntoDictionary(histG: Record<string, number>): void;
    injectIntoArray(histG: string[]): void;
}
//# sourceMappingURL=hueStatistics.d.ts.map