import HeaderTypes from './header-types.js';
function createInteger(numbers) {
    return numbers.reduce((final, n) => (final << 1) | n, 0);
}
function createColor(color) {
    return ((color.quad << 24) | (color.red << 16) | (color.green << 8) | color.blue);
}
export default class BmpEncoder {
    fileSize;
    reserved1;
    reserved2;
    offset;
    width;
    flag;
    height;
    planes;
    bitPP;
    compress;
    hr;
    vr;
    colors;
    importantColors;
    rawSize;
    headerSize;
    data;
    palette;
    extraBytes;
    buffer;
    bytesInColor;
    pos;
    constructor(imgData) {
        this.buffer = imgData.data;
        this.width = imgData.width;
        this.height = imgData.height;
        this.headerSize = HeaderTypes.BITMAP_INFO_HEADER;
        // Header
        this.flag = 'BM';
        this.bitPP = imgData.bitPP || 24;
        this.offset = 54;
        this.reserved1 = imgData.reserved1 || 0;
        this.reserved2 = imgData.reserved2 || 0;
        this.planes = 1;
        this.compress = 0;
        this.hr = imgData.hr || 0;
        this.vr = imgData.vr || 0;
        this.importantColors = imgData.importantColors || 0;
        this.colors = Math.min(2 ** (this.bitPP - 1 || 1), imgData.colors || Infinity);
        this.palette = imgData.palette || [];
        if (this.colors && this.bitPP < 16) {
            this.offset += this.colors * 4;
        }
        else {
            this.colors = 0;
        }
        switch (this.bitPP) {
            case 32:
                this.bytesInColor = 4;
                break;
            case 16:
                this.bytesInColor = 2;
                break;
            case 8:
                this.bytesInColor = 1;
                break;
            case 4:
                this.bytesInColor = 1 / 2;
                break;
            case 1:
                this.bytesInColor = 1 / 8;
                break;
            default:
                this.bytesInColor = 3;
                this.bitPP = 24;
        }
        const rowWidth = (this.width * this.bitPP) / 32;
        const rowBytes = Math.ceil(rowWidth);
        this.extraBytes = (rowBytes - rowWidth) * 4;
        // Why 2?
        this.rawSize = this.height * rowBytes * 4 + 2;
        this.fileSize = this.rawSize + this.offset;
        this.data = Buffer.alloc(this.fileSize, 0x1);
        this.pos = 0;
        this.encode();
    }
    encode() {
        this.pos = 0;
        this.writeHeader();
        switch (this.bitPP) {
            case 32:
                this.bit32();
                break;
            case 16:
                this.bit16();
                break;
            case 8:
                this.bit8();
                break;
            case 4:
                this.bit4();
                break;
            case 1:
                this.bit1();
                break;
            default:
                this.bit24();
        }
    }
    writeHeader() {
        this.data.write(this.flag, this.pos, 2);
        this.pos += 2;
        this.writeUInt32LE(this.fileSize);
        // Writing 2 UInt16LE resulted in a weird bug
        this.writeUInt32LE((this.reserved1 << 16) | this.reserved2);
        this.writeUInt32LE(this.offset);
        this.writeUInt32LE(this.headerSize);
        this.writeUInt32LE(this.width);
        this.writeUInt32LE(this.height);
        this.data.writeUInt16LE(this.planes, this.pos);
        this.pos += 2;
        this.data.writeUInt16LE(this.bitPP, this.pos);
        this.pos += 2;
        this.writeUInt32LE(this.compress);
        this.writeUInt32LE(this.rawSize);
        this.writeUInt32LE(this.hr);
        this.writeUInt32LE(this.vr);
        this.writeUInt32LE(this.colors);
        this.writeUInt32LE(this.importantColors);
    }
    bit1() {
        if (this.palette.length && this.colors === 2) {
            this.initColors(1);
        }
        else {
            this.writeUInt32LE(0x00ffffff); // Black
            this.writeUInt32LE(0x00000000); // White
        }
        this.pos += 1; // ?
        let lineArr = [];
        this.writeImage((p, index, x) => {
            let i = index;
            i++;
            const b = this.buffer[i++];
            const g = this.buffer[i++];
            const r = this.buffer[i++];
            const brightness = r * 0.2126 + g * 0.7152 + b * 0.0722;
            lineArr.push(brightness > 127 ? 0 : 1);
            if ((x + 1) % 8 === 0) {
                this.data[p - 1] = createInteger(lineArr);
                lineArr = [];
            }
            else if (x === this.width - 1 && lineArr.length > 0) {
                this.data[p - 1] = createInteger(lineArr) << 4;
                lineArr = [];
            }
            return i;
        });
    }
    bit4() {
        const colors = this.initColors(4);
        let integerPair = [];
        this.writeImage((p, index, x) => {
            let i = index;
            const colorInt = createColor({
                quad: this.buffer[i++],
                blue: this.buffer[i++],
                green: this.buffer[i++],
                red: this.buffer[i++],
            });
            const colorExists = colors.findIndex((c) => c === colorInt);
            if (colorExists !== -1) {
                integerPair.push(colorExists);
            }
            else {
                integerPair.push(0);
            }
            if ((x + 1) % 2 === 0) {
                this.data[p] = (integerPair[0] << 4) | integerPair[1];
                integerPair = [];
            }
            return i;
        });
    }
    bit8() {
        const colors = this.initColors(8);
        this.writeImage((p, index) => {
            let i = index;
            const colorInt = createColor({
                quad: this.buffer[i++],
                blue: this.buffer[i++],
                green: this.buffer[i++],
                red: this.buffer[i++],
            });
            const colorExists = colors.findIndex((c) => c === colorInt);
            if (colorExists !== -1) {
                this.data[p] = colorExists;
            }
            else {
                this.data[p] = 0;
            }
            return i;
        });
    }
    bit16() {
        this.writeImage((p, index) => {
            let i = index + 1;
            const b = this.buffer[i++] / 8; // b
            const g = this.buffer[i++] / 8; // g
            const r = this.buffer[i++] / 8; // r
            const color = (r << 10) | (g << 5) | b;
            this.data[p] = color & 0x00ff;
            this.data[p + 1] = (color & 0xff00) >> 8;
            return i;
        });
    }
    bit24() {
        this.writeImage((p, index) => {
            let i = index + 1;
            this.data[p] = this.buffer[i++]; //b
            this.data[p + 1] = this.buffer[i++]; //g
            this.data[p + 2] = this.buffer[i++]; //r
            return i;
        });
    }
    bit32() {
        this.writeImage((p, index) => {
            let i = index;
            this.data[p + 3] = this.buffer[i++]; // a
            this.data[p] = this.buffer[i++]; // b
            this.data[p + 1] = this.buffer[i++]; // g
            this.data[p + 2] = this.buffer[i++]; // r
            return i;
        });
    }
    writeImage(writePixel) {
        const rowBytes = this.extraBytes + this.width * this.bytesInColor;
        let i = 0;
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const p = Math.floor(this.pos + (this.height - 1 - y) * rowBytes + x * this.bytesInColor);
                i = writePixel.call(this, p, i, x, y);
            }
        }
    }
    initColors(bit) {
        const colors = [];
        if (this.palette.length) {
            for (let i = 0; i < this.colors; i++) {
                const rootColor = createColor(this.palette[i]);
                this.writeUInt32LE(rootColor);
                colors.push(rootColor);
            }
        }
        else {
            throw new Error(`To encode ${bit}-bit BMPs a pallette is needed. Please choose up to ${this.colors} colors. Colors must be 32-bit integers.`);
        }
        return colors;
    }
    writeUInt32LE(value) {
        this.data.writeUInt32LE(value, this.pos);
        this.pos += 4;
    }
}
//# sourceMappingURL=encoder.js.map