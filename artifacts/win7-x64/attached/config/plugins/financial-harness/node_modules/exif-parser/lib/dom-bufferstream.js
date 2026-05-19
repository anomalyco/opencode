/*jslint browser: true, devel: true, bitwise: false, debug: true, eqeq: false, es5: true, evil: false, forin: false, newcap: false, nomen: true, plusplus: true, regexp: false, unparam: false, sloppy: true, stupid: false, sub: false, todo: true, vars: true, white: true */

function DOMBufferStream(arrayBuffer, offset, length, bigEndian, global, parentOffset) {
	this.global = global;
	offset = offset || 0;
	length = length || (arrayBuffer.byteLength - offset);
	this.arrayBuffer = arrayBuffer.slice(offset, offset + length);
	this.view = new global.DataView(this.arrayBuffer, 0, this.arrayBuffer.byteLength);
	this.setBigEndian(bigEndian);
	this.offset = 0;
	this.parentOffset = (parentOffset || 0) + offset;
}

DOMBufferStream.prototype = {
	setBigEndian: function(bigEndian) {
		this.littleEndian = !bigEndian;
	},
	nextUInt8: function() {
		var value = this.view.getUint8(this.offset);
		this.offset += 1;
		return value;
	},
	nextInt8: function() {
		var value = this.view.getInt8(this.offset);
		this.offset += 1;
		return value;
	},
	nextUInt16: function() {
		var value = this.view.getUint16(this.offset, this.littleEndian);
		this.offset += 2;
		return value;
	},
	nextUInt32: function() {
		var value = this.view.getUint32(this.offset, this.littleEndian);
		this.offset += 4;
		return value;
	},
	nextInt16: function() {
		var value = this.view.getInt16(this.offset, this.littleEndian);
		this.offset += 2;
		return value;
	},
	nextInt32: function() {
		var value = this.view.getInt32(this.offset, this.littleEndian);
		this.offset += 4;
		return value;
	},
	nextFloat: function() {
		var value = this.view.getFloat32(this.offset, this.littleEndian);
		this.offset += 4;
		return value;
	},
	nextDouble: function() {
		var value = this.view.getFloat64(this.offset, this.littleEndian);
		this.offset += 8;
		return value;
	},
	nextBuffer: function(length) {
		//this won't work in IE10
		var value = this.arrayBuffer.slice(this.offset, this.offset + length);
		this.offset += length;
		return value;
	},
	remainingLength: function() {
		return this.arrayBuffer.byteLength - this.offset;
	},
	nextString: function(length) {
		var value = this.arrayBuffer.slice(this.offset, this.offset + length);
		value = String.fromCharCode.apply(null, new this.global.Uint8Array(value));
		this.offset += length;
		return value;
	},
	mark: function() {
		var self = this;
		return {
			openWithOffset: function(offset) {
				offset = (offset || 0) + this.offset;
				return new DOMBufferStream(self.arrayBuffer, offset, self.arrayBuffer.byteLength - offset, !self.littleEndian, self.global, self.parentOffset);
			},
			offset: this.offset,
			getParentOffset: function() {
				return self.parentOffset;
			}
		};
	},
	offsetFrom: function(marker) {
		return this.parentOffset + this.offset - (marker.offset + marker.getParentOffset());
	},
	skip: function(amount) {
		this.offset += amount;
	},
	branch: function(offset, length) {
		length = typeof length === 'number' ? length : this.arrayBuffer.byteLength - (this.offset + offset);
		return new DOMBufferStream(this.arrayBuffer, this.offset + offset, length, !this.littleEndian, this.global, this.parentOffset);
	}
};

module.exports = DOMBufferStream;
