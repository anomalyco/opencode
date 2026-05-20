import BmpDecoder from './decoder.js';
import BmpEncoder from './encoder.js';
export function decode(bmpData, options) {
    return new BmpDecoder(bmpData, options);
}
export function encode(imgData) {
    return new BmpEncoder(imgData);
}
export * from './types.js';
//# sourceMappingURL=index.js.map