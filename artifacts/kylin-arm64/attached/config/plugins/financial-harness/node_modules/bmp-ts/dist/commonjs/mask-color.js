"use strict";
// We have these:
//
// const sample = 0101 0101 0101 0101
// const mask   = 0111 1100 0000 0000
// 256        === 0000 0001 0000 0000
//
// We want to take the sample and turn it into an 8-bit value.
//
// 1. We extract the last bit of the mask:
//
// 0000 0100 0000 0000
//       ^
//
// Like so:
//
// const a = ~mask =    1000 0011 1111 1111
// const b = a + 1 =    1000 0100 0000 0000
// const c = b & mask = 0000 0100 0000 0000
//
// 2. We shift it to the right and extract the bit before the first:
//
// 0000 0000 0010 0000
//             ^
//
// Like so:
//
// const d = mask / c = 0000 0000 0001 1111
// const e = mask + 1 = 0000 0000 0010 0000
//
// 3. We apply the mask and the two values above to a sample:
//
// const f = sample & mask = 0101 0100 0000 0000
// const g = f / c =         0000 0000 0001 0101
// const h = 256 / e =       0000 0000 0000 0100
// const i = g * h =         0000 0000 1010 1000
//                                     ^^^^ ^
//
// Voila, we have extracted a sample and "stretched" it to 8 bits. For samples
// which are already 8-bit, h === 1 and g === i.
Object.defineProperty(exports, "__esModule", { value: true });
function maskColor(maskRed, maskGreen, maskBlue, maskAlpha) {
    const maskRedR = (~maskRed + 1) & maskRed;
    const maskGreenR = (~maskGreen + 1) & maskGreen;
    const maskBlueR = (~maskBlue + 1) & maskBlue;
    const maskAlphaR = (~maskAlpha + 1) & maskAlpha;
    const shiftedMaskRedL = maskRed / maskRedR + 1;
    const shiftedMaskGreenL = maskGreen / maskGreenR + 1;
    const shiftedMaskBlueL = maskBlue / maskBlueR + 1;
    const shiftedMaskAlphaL = maskAlpha / maskAlphaR + 1;
    return {
        shiftRed: (x) => (((x & maskRed) / maskRedR) * 0x100) / shiftedMaskRedL,
        shiftGreen: (x) => (((x & maskGreen) / maskGreenR) * 0x100) / shiftedMaskGreenL,
        shiftBlue: (x) => (((x & maskBlue) / maskBlueR) * 0x100) / shiftedMaskBlueL,
        shiftAlpha: maskAlpha !== 0
            ? (x) => (((x & maskAlpha) / maskAlphaR) * 0x100) / shiftedMaskAlphaL
            : () => 255,
    };
}
exports.default = maskColor;
//# sourceMappingURL=mask-color.js.map