# parse-bmfont-ascii

[![stable](http://badges.github.io/stability-badges/dist/stable.svg)](http://github.com/badges/stability-badges)

Parses ASCII (text) [BMFont files](http://www.angelcode.com/products/bmfont/).

Takes a string or Buffer:

```js
var fs = require('fs')
var parse = require('parse-bmfont-xml')

fs.readFileSync(__dirname+'/Arial.fnt', function(err, data) {
  var result = parse(data)
  console.log(result.info.face)   // "Arial"
  console.log(result.pages)       // [ 'sheet0.png' ]
  console.log(result.chars)       // [ ... char data ... ]
  console.log(result.kernings)    // [ ... kernings data ... ]
})
```

The spec for the returned JSON object is [here](https://github.com/mattdesl/bmfont2json/wiki/JsonSpec). The input data should match the spec, see [test/Nexa Light-32.fnt](test/Nexa Light-32.fnt) for an example.

## See Also

See [text-modules](https://github.com/mattdesl/text-modules) for related modules.

## Usage

[![NPM](https://nodei.co/npm/parse-bmfont-ascii.png)](https://www.npmjs.com/package/parse-bmfont-ascii)

#### `result = parse(data)`

Parses `data`, a string or Buffer that represents ASCII (text) data of an AngelCode BMFont file. The returned `result` object looks like this:

```js
{
     pages: [
         "sheet_0.png", 
         "sheet_1.png"
     ],
     chars: [
         { chnl, height, id, page, width, x, y, xoffset, yoffset, xadvance },
         ...
     ],
     info: { ... },
     common: { ... },
     kernings: [
         { first, second, amount }
     ]
}
```

## License

MIT, see [LICENSE.md](http://github.com/mattdesl/parse-bmfont-ascii/blob/master/LICENSE.md) for details.
