export default function maskColor(maskRed: number, maskGreen: number, maskBlue: number, maskAlpha: number): {
    shiftRed: (x: number) => number;
    shiftGreen: (x: number) => number;
    shiftBlue: (x: number) => number;
    shiftAlpha: (x: number) => number;
};
