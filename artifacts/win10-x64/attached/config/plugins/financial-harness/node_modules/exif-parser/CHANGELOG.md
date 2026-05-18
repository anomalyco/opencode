# Changelog

## 0.1.11 - July 9th 2017

 - On nodejs, decode strings using UTF-8 instead of ASCII. Ideally we'd do this in the browser (UTF-16 currently) as well but that is a bit more work. 

## 0.1.10 - July 9th 2017

- Ignore unknown tag formats instead of failing. There seem to be images with format 0 that otherwise contain valid data.
- Fix bug in date parsing to not rely on the current date. This broke when the current date was the 31st of the month.
- In case a tag appears more than once, take the first, not the last. For example some pictures taken on an iPhone suffer from duplicate Orientation tags, where the first one is the wrong one.
- treat ModifyDate tag as a date value

## 0.1.9 - April 9th 2015

- parse ISO 8601 dates with timezone offset
