/*jslint browser: true, devel: true, bitwise: false, debug: true, eqeq: false, es5: true, evil: false, forin: false, newcap: false, nomen: true, plusplus: true, regexp: false, unparam: false, sloppy: true, stupid: false, sub: false, todo: true, vars: true, white: true */

var jpeg = require('./jpeg'),
	exif = require('./exif'),
	simplify = require('./simplify');

function ExifResult(startMarker, tags, imageSize, thumbnailOffset, thumbnailLength, thumbnailType, app1Offset) {
	this.startMarker = startMarker;
	this.tags = tags;
	this.imageSize = imageSize;
	this.thumbnailOffset = thumbnailOffset;
	this.thumbnailLength = thumbnailLength;
	this.thumbnailType = thumbnailType;
	this.app1Offset = app1Offset;
}

ExifResult.prototype = {
	hasThumbnail: function(mime) {
		if(!this.thumbnailOffset || !this.thumbnailLength) {
			return false;
		}
		if(typeof mime !== 'string') {
			return true;
		}
		if(mime.toLowerCase().trim() === 'image/jpeg') {
			return this.thumbnailType === 6;
		}
		if(mime.toLowerCase().trim() === 'image/tiff') {
			return this.thumbnailType === 1;
		}
		return false;
	},
	getThumbnailOffset: function() {
		return this.app1Offset + 6 + this.thumbnailOffset;
	},
	getThumbnailLength: function() {
		return this.thumbnailLength;
	},
	getThumbnailBuffer: function() {
		return this._getThumbnailStream().nextBuffer(this.thumbnailLength);
	},
	_getThumbnailStream: function() {
		return this.startMarker.openWithOffset(this.getThumbnailOffset());
	},
	getImageSize: function() {
		return this.imageSize;
	},
	getThumbnailSize: function() {
		var stream = this._getThumbnailStream(), size;
		jpeg.parseSections(stream, function(sectionType, sectionStream) {
			if(jpeg.getSectionName(sectionType).name === 'SOF') {
				size = jpeg.getSizeFromSOFSection(sectionStream);
			}
		});
		return size;
	}
};

function Parser(stream) {
	this.stream = stream;
	this.flags = {
		readBinaryTags: false,
		resolveTagNames: true,
		simplifyValues: true,
		imageSize: true,
		hidePointers: true,
		returnTags: true
	};
}

Parser.prototype = {
	enableBinaryFields: function(enable) {
		this.flags.readBinaryTags = !!enable;
		return this;
	},
	enablePointers: function(enable) {
		this.flags.hidePointers = !enable;
		return this;
	},
	enableTagNames: function(enable) {
		this.flags.resolveTagNames = !!enable;
		return this;
	},
	enableImageSize: function(enable) {
		this.flags.imageSize = !!enable;
		return this;
	},
	enableReturnTags: function(enable) {
		this.flags.returnTags = !!enable;
		return this;
	},
	enableSimpleValues: function(enable) {
		this.flags.simplifyValues = !!enable;
		return this;
	},
	parse: function() {
		var start = this.stream.mark(),
			stream = start.openWithOffset(0),
			flags = this.flags,
			tags,
			imageSize,
			thumbnailOffset,
			thumbnailLength,
			thumbnailType,
			app1Offset,
			tagNames,
			getTagValue, setTagValue;
		if(flags.resolveTagNames) {
			tagNames = require('./exif-tags');
		}
		if(flags.resolveTagNames) {
			tags = {};
			getTagValue = function(t) {
				return tags[t.name];
			};
			setTagValue = function(t, value) {
				tags[t.name] = value;
			};
		} else {
			tags = [];
			getTagValue = function(t) {
				var i;
				for(i = 0; i < tags.length; ++i) {
					if(tags[i].type === t.type && tags[i].section === t.section) {
						return tags.value;
					}
				}
			};
			setTagValue = function(t, value) {
				var i;
				for(i = 0; i < tags.length; ++i) {
					if(tags[i].type === t.type && tags[i].section === t.section) {
						tags.value = value;
						return;
					}
				}
			};
		}

		jpeg.parseSections(stream, function(sectionType, sectionStream) {
			var validExifHeaders, sectionOffset = sectionStream.offsetFrom(start);
			if(sectionType === 0xE1) {
				validExifHeaders = exif.parseTags(sectionStream, function(ifdSection, tagType, value, format) {
					//ignore binary fields if disabled
					if(!flags.readBinaryTags && format === 7) {
						return;
					}

					if(tagType === 0x0201) {
						thumbnailOffset = value[0];
						if(flags.hidePointers) {return;}
					} else if(tagType === 0x0202) {
						thumbnailLength = value[0];
						if(flags.hidePointers) {return;}
					} else if(tagType === 0x0103) {
						thumbnailType = value[0];
						if(flags.hidePointers) {return;}
					}
					//if flag is set to not store tags, return here after storing pointers
					if(!flags.returnTags) {
						return;
					}

					if(flags.simplifyValues) {
						value = simplify.simplifyValue(value, format);
					}
					if(flags.resolveTagNames) {
						var sectionTagNames = ifdSection === exif.GPSIFD ? tagNames.gps : tagNames.exif;
						var name = sectionTagNames[tagType];
						if(!name) {
							name = tagNames.exif[tagType];
						}
						if (!tags.hasOwnProperty(name)) {
							tags[name] = value;
						}
					} else {
						tags.push({
							section: ifdSection,
							type: tagType,
							value: value
						});
					}
				});
				if(validExifHeaders) {
					app1Offset = sectionOffset;
				}
			}
			else if(flags.imageSize && jpeg.getSectionName(sectionType).name === 'SOF') {
				imageSize = jpeg.getSizeFromSOFSection(sectionStream);
			}
		});

		if(flags.simplifyValues) {
			simplify.castDegreeValues(getTagValue, setTagValue);
			simplify.castDateValues(getTagValue, setTagValue);
		}

		return new ExifResult(start, tags, imageSize, thumbnailOffset, thumbnailLength, thumbnailType, app1Offset);
	}
};



module.exports = Parser;
