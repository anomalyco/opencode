export declare class ProgressTracker {
    static readonly steps = 100;
    progress: number;
    private _step;
    private _range;
    private _last;
    private _progressRange;
    constructor(valueRange: number, progressRange: number);
    shouldNotify(current: number): boolean;
}
//# sourceMappingURL=progressTracker.d.ts.map