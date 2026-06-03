var date = require('../lib/date');

var minutes = 60;
var hours = minutes * 60;
var days = hours * 24;
var years = days * 365;
var leapYears = days * 366;

module.exports = {
	'test parse unix epoch without timezone': function(test) {
		var dateStr = '1970:01:01 00:00:00';
		var timestamp = date.parseDateWithSpecFormat(dateStr);
		test.strictEqual(timestamp, 0);
		test.done();
	},
	'test parse given date without timezone': function(test) {
		var dateStr = '1990:02:14 14:30:14';
		var timestamp = date.parseDateWithSpecFormat(dateStr);
		//between 1970 and 1990 there were 5 leap years: 1972, 1976, 1980, 1984, 1988
		var expectedTimestamp = (15 * years) + (5 * leapYears) +
			((31 + 13) * days) + (14 * hours) + (30 * minutes) + 14;
		test.strictEqual(timestamp, expectedTimestamp);
		test.done();
	},
	'test parse invalid date without timezone should not return anything': function(test) {
		var dateStr = '1990:AA:14 14:30:14';
		var timestamp = date.parseDateWithSpecFormat(dateStr);
		test.strictEqual(timestamp, undefined);
		test.done();
	},
	'test parse given date with timezone': function(test) {
		var dateStr = '2004-09-04T23:39:06-08:00';
		var timestamp = date.parseDateWithTimezoneFormat(dateStr);
		var yearsFromEpoch = 2004 - 1970;
		//1972, 1976, 1980, 1984, 1988, 1992, 1996, 2000
		var leapYearsCount = 8;
		//2004 is a leap year as well, hence 29 days for february
		var dayCount = 31 + 29 + 31 + 30 + 31 + 30 + 31 + 31 + 3;
		var expectedTimestamp = (yearsFromEpoch - leapYearsCount) * years +
			leapYearsCount * leapYears +
			dayCount * days +
			23 * hours +
			39 * minutes +
			6 +
			8 * hours;	//for timezone
		test.strictEqual(timestamp, expectedTimestamp);
		test.done();
	},
	'test parse invalid date with timezone': function(test) {
		var dateStr = '2004-09-04T23:39:06A08:00';
		var timestamp = date.parseDateWithTimezoneFormat(dateStr);
		test.strictEqual(timestamp, undefined);
		test.done();
	},
	'test parseExifDate': function(test) {
		test.strictEqual(date.parseExifDate('1970:01:01 00:00:00'), 0);
		test.strictEqual(date.parseExifDate('1970-01-01T00:00:00-01:00'), 3600);
		test.done();
	}
}