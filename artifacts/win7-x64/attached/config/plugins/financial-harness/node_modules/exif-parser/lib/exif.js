/*jslint browser: true, devel: true, bitwise: false, debug: true, eqeq: false, es5: true, evil: false, forin: false, newcap: false, nomen: true, plusplus: true, regexp: false, unparam: false, sloppy: true, stupid: false, sub: false, todo: true, vars: true, white: true */

function readExifValue(format, stream) {
	switch(format) {
		case 1: return stream.nextUInt8();
		case 3: return stream.nextUInt16();
		case 4: return stream.nextUInt32();
		case 5: return [stream.nextUInt32(), stream.nextUInt32()];
		case 6: return stream.nextInt8();
		case 8: return stream.nextUInt16();
		case 9: return stream.nextUInt32();
		case 10: return [stream.nextInt32(), stream.nextInt32()];
		case 11: return stream.nextFloat();
		case 12: return stream.nextDouble();
		default: throw new Error('Invalid format while decoding: ' + format);
	}
}

function getBytesPerComponent(format) {
	switch(format) {
		case 1:
		case 2:
		case 6:
		case 7:
			return 1;
		case 3:
		case 8:
			return 2;
		case 4:
		case 9:
		case 11:
			return 4;
		case 5:
		case 10:
		case 12:
			return 8;
		default:
			return 0;
	}
}

function readExifTag(tiffMarker, stream) {
	var tagType = stream.nextUInt16(),
		format = stream.nextUInt16(),
		bytesPerComponent = getBytesPerComponent(format),
		components = stream.nextUInt32(),
		valueBytes = bytesPerComponent * components,
		values,
		value,
		c;

	/* if the value is bigger then 4 bytes, the value is in the data section of the IFD
	and the value present in the tag is the offset starting from the tiff header. So we replace the stream
	with a stream that is located at the given offset in the data section. s*/
	if(valueBytes > 4) {
		stream = tiffMarker.openWithOffset(stream.nextUInt32());
	}
	//we don't want to read strings as arrays
	if(format === 2) {
		values = stream.nextString(components);
		//cut off \0 characters
		var lastNull = values.indexOf('\0');
		if(lastNull !== -1) {
			values = values.substr(0, lastNull);
		}
	}
	else if(format === 7) {
		values = stream.nextBuffer(components);
	}
	else if(format !== 0) {
		values = [];
		for(c = 0; c < components; ++c) {
			values.push(readExifValue(format, stream));
		}
	}
	//since our stream is a stateful object, we need to skip remaining bytes
	//so our offset stays correct
	if(valueBytes < 4) {
		stream.skip(4 - valueBytes);
	}

	return [tagType, values, format];
}

function readIFDSection(tiffMarker, stream, iterator) {
	var numberOfEntries = stream.nextUInt16(), tag, i;
	for(i = 0; i < numberOfEntries; ++i) {
		tag = readExifTag(tiffMarker, stream);
		iterator(tag[0], tag[1], tag[2]);
	}
}

function readHeader(stream) {
	var exifHeader = stream.nextString(6);
	if(exifHeader !== 'Exif\0\0') {
		throw new Error('Invalid EXIF header');
	}

	var tiffMarker = stream.mark();
	var tiffHeader = stream.nextUInt16();
	if(tiffHeader === 0x4949) {
		stream.setBigEndian(false);
	} else if(tiffHeader === 0x4D4D) {
		stream.setBigEndian(true);
	} else {
		throw new Error('Invalid TIFF header');
	}
	if(stream.nextUInt16() !== 0x002A) {
		throw new Error('Invalid TIFF data');
	}
	return tiffMarker;
}

module.exports = {
	IFD0: 1,
	IFD1: 2,
	GPSIFD: 3,
	SubIFD: 4,
	InteropIFD: 5,
	parseTags: function(stream, iterator) {
		var tiffMarker;
		try {
			tiffMarker = readHeader(stream);
		} catch(e) {
			return false;	//ignore APP1 sections with invalid headers
		}
		var subIfdOffset, gpsOffset, interopOffset;
		var ifd0Stream = tiffMarker.openWithOffset(stream.nextUInt32()),
			IFD0 = this.IFD0;
		readIFDSection(tiffMarker, ifd0Stream, function(tagType, value, format) {
			switch(tagType) {
				case 0x8825: gpsOffset = value[0]; break;
				case 0x8769: subIfdOffset = value[0]; break;
				default: iterator(IFD0, tagType, value, format); break;
			}
		});
		var ifd1Offset = ifd0Stream.nextUInt32();
		if(ifd1Offset !== 0) {
			var ifd1Stream = tiffMarker.openWithOffset(ifd1Offset);
			readIFDSection(tiffMarker, ifd1Stream, iterator.bind(null, this.IFD1));
		}

		if(gpsOffset) {
			var gpsStream = tiffMarker.openWithOffset(gpsOffset);
			readIFDSection(tiffMarker, gpsStream, iterator.bind(null, this.GPSIFD));
		}

		if(subIfdOffset) {
			var subIfdStream = tiffMarker.openWithOffset(subIfdOffset), InteropIFD = this.InteropIFD;
			readIFDSection(tiffMarker, subIfdStream, function(tagType, value, format) {
				if(tagType === 0xA005) {
					interopOffset = value[0];
				} else {
					iterator(InteropIFD, tagType, value, format);
				}
			});
		}

		if(interopOffset) {
			var interopStream = tiffMarker.openWithOffset(interopOffset);
			readIFDSection(tiffMarker, interopStream, iterator.bind(null, this.InteropIFD));
		}
		return true;
	}
};