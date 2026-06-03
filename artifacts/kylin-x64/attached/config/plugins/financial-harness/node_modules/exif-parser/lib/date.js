function parseNumber(s) {
	return parseInt(s, 10);
}

//in seconds
var hours = 3600;
var minutes = 60;

//take date (year, month, day) and time (hour, minutes, seconds) digits in UTC
//and return a timestamp in seconds
function parseDateTimeParts(dateParts, timeParts) {
	dateParts = dateParts.map(parseNumber);
	timeParts = timeParts.map(parseNumber);
	var year = dateParts[0];
	var month = dateParts[1] - 1;
	var day = dateParts[2];
	var hours = timeParts[0];
	var minutes = timeParts[1];
	var seconds = timeParts[2];
	var date = Date.UTC(year, month, day, hours, minutes, seconds, 0);
	var timestamp = date / 1000;
	return timestamp;
}

//parse date with "2004-09-04T23:39:06-08:00" format,
//one of the formats supported by ISO 8601, and
//convert to utc timestamp in seconds
function parseDateWithTimezoneFormat(dateTimeStr) {

	var dateParts = dateTimeStr.substr(0, 10).split('-');
	var timeParts = dateTimeStr.substr(11, 8).split(':');
	var timezoneStr = dateTimeStr.substr(19, 6);
	var timezoneParts = timezoneStr.split(':').map(parseNumber);
	var timezoneOffset = (timezoneParts[0] * hours) +
		(timezoneParts[1] * minutes);

	var timestamp = parseDateTimeParts(dateParts, timeParts);
	//minus because the timezoneOffset describes
	//how much the described time is ahead of UTC
	timestamp -= timezoneOffset;

	if(typeof timestamp === 'number' && !isNaN(timestamp)) {
		return timestamp;
	}
}

//parse date with "YYYY:MM:DD hh:mm:ss" format, convert to utc timestamp in seconds
function parseDateWithSpecFormat(dateTimeStr) {
	var parts = dateTimeStr.split(' '),
		dateParts = parts[0].split(':'),
		timeParts = parts[1].split(':');

	var timestamp = parseDateTimeParts(dateParts, timeParts);

	if(typeof timestamp === 'number' && !isNaN(timestamp)) {
		return timestamp;
	}
}

function parseExifDate(dateTimeStr) {
	//some easy checks to determine two common date formats

	//is the date in the standard "YYYY:MM:DD hh:mm:ss" format?
	var isSpecFormat = dateTimeStr.length === 19 &&
		dateTimeStr.charAt(4) === ':';
	//is the date in the non-standard format,
	//"2004-09-04T23:39:06-08:00" to include a timezone?
	var isTimezoneFormat = dateTimeStr.length === 25 &&
		dateTimeStr.charAt(10) === 'T';
	var timestamp;

	if(isTimezoneFormat) {
		return parseDateWithTimezoneFormat(dateTimeStr);
	}
	else if(isSpecFormat) {
		return parseDateWithSpecFormat(dateTimeStr);
	}
}

module.exports = {
	parseDateWithSpecFormat: parseDateWithSpecFormat,
	parseDateWithTimezoneFormat: parseDateWithTimezoneFormat,
	parseExifDate: parseExifDate
};
