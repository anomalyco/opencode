# xml-parse-from-string

[![stable](http://badges.github.io/stability-badges/dist/stable.svg)](http://github.com/badges/stability-badges)

A light browser wrapper around `DOMParser.parseFromString` for XML, with fallback for IE8 and other browsers.

- attempts to use DOMParser with `"application/xml"`
- falls back to `ActiveXObject('Microsoft.XMLDOM')`
- then falls back to `createElement` / `innerHTML`  

```js
var parseXML = require('xml-parse-from-string')

var str = '<root><foobar id="blah"></foobar></root>'
var doc = parseXML(str)
var tag = doc.getElementsByTagName('foobar')[0]

console.log(tag.getAttribute('id')) // -> "blah"
```

Be wary of subtle differences between implementations, such as case-sensitivity in `attribute.nodeName`.

PRs for Node version welcome.

## Usage

[![NPM](https://nodei.co/npm/xml-parse-from-string.png)](https://www.npmjs.com/package/xml-parse-from-string)

#### `root = parse(str)`

Parses the string as XML and returns the `root` element as a DOM element, so you can do operations similar to `document.getElementById`, `document.getElementsByTagName`, and so forth.

## License

MIT, see [LICENSE.md](http://github.com/Jam3/xml-parse-from-string/blob/master/LICENSE.md) for details.
