var exifParser = require('../index');

var buf = require('fs').readFileSync(process.argv[2]);
var parser = exifParser.create(buf);
var result = parser.parse();

Object.keys(result.tags).forEach(function(name) {
	console.log(name+': ' + result.tags[name]);
});