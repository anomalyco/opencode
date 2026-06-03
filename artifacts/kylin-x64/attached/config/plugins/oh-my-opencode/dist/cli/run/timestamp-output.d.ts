export declare function createTimestampTransformer(now?: () => Date): (chunk: string) => string;
export declare function createTimestampedStdoutController(stdout?: NodeJS.WriteStream): {
    enable: () => void;
    restore: () => void;
};
