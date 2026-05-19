export declare function createSpy(): {
    (...args: any[]): void;
    calls: any[][];
    callCount(): number;
    calledWith(...expected: any[]): boolean;
    reset(): number;
};
