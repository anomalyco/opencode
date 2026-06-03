var testCase = require('nodeunit').testCase;
var exif = require('../lib/exif.js');
var BufferStream = require('../lib/bufferstream.js');
var buf = require('fs').readFileSync(__dirname + '/starfish.jpg');

module.exports = testCase({
	"test parseTags": function(test) {
		var expectedTags = require('./expected-exif-tags.json');
		var index = 0;
		exif.parseTags(new BufferStream(buf, 24, 23960), function(ifdSection, tagType, value, format) {
			var t = expectedTags[index];
			test.strictEqual(t.ifdSection, ifdSection);
			test.strictEqual(t.tagType, tagType);
			test.strictEqual(t.format, format);
			if(typeof t.value === 'string' && t.value.indexOf('b:') === 0) {
				test.ok(Buffer.isBuffer(value));
				test.strictEqual(parseInt(t.value.substr(2), 10), value.length);
			} else {
				test.deepEqual(t.value, value);
			}
			++index;
		});
		test.strictEqual(index, expectedTags.length, 'all tags should be passed to the iterator');
		test.done();	
	}
});