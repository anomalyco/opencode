var simplify = require('../lib/simplify');

module.exports = {
	'test castDateValues': function(test) {
		var values = {
			'DateTimeOriginal': '1970:01:01 00:00:00',
			'CreateDate': '1970-01-01T00:00:00-05:00',
			'ModifyDate': '1970-01-01T00:00:00-05:00'
		};
		var setValues = {};
		function getTagValue(tag) {
			return values[tag.name];
		}
		function setTagValue(tag, value) {
			setValues[tag.name] = value;
		}
		simplify.castDateValues(getTagValue, setTagValue);
		test.strictEqual(Object.keys(setValues).length, 3);
		test.strictEqual(setValues.DateTimeOriginal, 0);
		test.strictEqual(setValues.CreateDate, 5 * 3600);
		test.strictEqual(setValues.ModifyDate, 5 * 3600);
		test.done();
	}
}