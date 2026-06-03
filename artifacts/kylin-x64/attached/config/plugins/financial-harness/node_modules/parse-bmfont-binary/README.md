# parse-bmfont-binary

[![stable](http://badges.github.io/stability-badges/dist/stable.svg)](http://github.com/badges/stability-badges)

Encodes a BMFont from a binary Buffer into JSON, as per the [BMFont Spec](http://www.angelcode.com/products/bmfont/doc/file_format.html). Can be used in Node or the browser (e.g. with browserify).

```js
var parse = require('parse-bmfont-binary')

fs.readFile('fonts/Lato.bin', function(err, data) {
  if (err) throw err
  var font = parse(data)
  
  //do something with your font
  console.log(font.info.face)
  console.log(font.info.size)
  console.log(font.common.lineHeight)
  console.log(font.chars)
  console.log(font.kernings)
})
```

## See Also

See [text-modules](https://github.com/mattdesl/text-modules) for related modules.

## Usage

[![NPM](https://nodei.co/npm/parse-bmfont-binary.png)](https://www.npmjs.com/package/parse-bmfont-binary)

#### `font = parse(buffer)`

Reads a binary BMFont Buffer and returns a new JSON representation of that font. See [here](https://github.com/mattdesl/bmfont2json/wiki/JsonSpec) for details on the return format.

## License

MIT, see [LICENSE.md](http://github.com/Jam3/parse-bmfont-binary/blob/master/LICENSE.md) for details.
