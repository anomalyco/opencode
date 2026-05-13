type StdinLike = {
    isTTY?: boolean;
    isRaw?: boolean;
    setRawMode?: (mode: boolean) => void;
    isPaused?: () => boolean;
    resume: () => void;
    pause: () => void;
    on: (event: "data", listener: (chunk: string | Uint8Array) => void) => void;
    removeListener: (event: "data", listener: (chunk: string | Uint8Array) => void) => void;
};
export declare function suppressRunInput(stdin?: StdinLike, onInterrupt?: () => void): () => void;
export {};
