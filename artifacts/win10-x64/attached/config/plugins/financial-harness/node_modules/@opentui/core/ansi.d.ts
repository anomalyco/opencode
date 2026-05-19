export declare const ANSI: {
    switchToAlternateScreen: string;
    switchToMainScreen: string;
    reset: string;
    scrollDown: (lines: number) => string;
    scrollUp: (lines: number) => string;
    moveCursor: (row: number, col: number) => string;
    moveCursorAndClear: (row: number, col: number) => string;
    setRgbBackground: (r: number, g: number, b: number) => string;
    resetBackground: string;
    bracketedPasteStart: string;
    bracketedPasteEnd: string;
};
