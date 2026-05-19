var xml2js = require('xml2js')
var parseAttributes = require('./parse-attribs')

module.exports = function parseBMFontXML(data) {
  data = data.toString().trim()

  var output = {
    pages: [],
    chars: [],
    kernings: []
  }

  xml2js.parseString(data, function(err, result) {
    if (err)
      throw err
    if (!result.font)
      throw "XML bitmap font doesn't have <font> root"
    result = result.font

    output.common = parseAttributes(result.common[0].$)
    output.info = parseAttributes(result.info[0].$)

    for (var i = 0; i < result.pages.length; i++) {
      var p = result.pages[i].page[0].$

      if (typeof p.id === "undefined")
        throw new Error("malformed file -- needs page id=N")
      if (typeof p.file !== "string")
        throw new Error("malformed file -- needs page file=\"path\"")

      output.pages[parseInt(p.id, 10)] = p.file
    }

    if (result.chars) {
      var chrArray = result.chars[0]['char'] || []
      for (var i = 0; i < chrArray.length; i++) {
        output.chars.push(parseAttributes(chrArray[i].$))
      }
    }

    if (result.kernings) {
      var kernArray = result.kernings[0]['kerning'] || []
      for (var i = 0; i < kernArray.length; i++) {
        output.kernings.push(parseAttributes(kernArray[i].$))
      }
    }
  })
  return output
}
