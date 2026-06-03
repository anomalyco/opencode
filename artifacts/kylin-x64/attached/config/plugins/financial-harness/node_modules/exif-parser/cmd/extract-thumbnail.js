var exifParser = require('../index');

var buf = require('fs').readFileSync(process.argv[2]);
var parser = exifParser.create(buf).enableReturnTags(false);
var result = parser.parse();

if(!result.hasThumbnail('image/jpeg')) {
	console.log('no jpeg thumbnail in this image');
	process.exit(1);
} else {
	var size = result.getThumbnailSize();
	var buffer = result.getThumbnailBuffer();
	require('fs').writeFileSync(process.argv[3], buffer);
	console.log('wrote thumbnail of size ' + size.width + 'x' + size.height + ' to ' + process.argv[3] + ' (' + buffer.length + ' bytes)');
	process.exit(0);
}