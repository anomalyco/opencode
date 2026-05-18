# Change Log

All notable changes to this project are documented in this file. This project adheres to [Semantic Versioning](http://semver.org/#semantic-versioning-200).

## [11.0.0] - 2019-02-18
- Calling `end()` with arguments no longer overwrites writer options. See [#120](https://github.com/oozcitak/xmlbuilder-js/issues/120).
- Added writer state and customizable space and endline functions to help customize writer behavior. Also added `openNode` and `closeNode` functions to writer. See [#193](https://github.com/oozcitak/xmlbuilder-js/issues/193).
- Fixed a bug where writer functions would not be called for nodes with a single child node in pretty print mode. See [#195](https://github.com/oozcitak/xmlbuilder-js/issues/195).
- Renamed `elEscape` to `textEscape` in `XMLStringifier`.
- Fixed a bug where empty arrays would produce child nodes. See [#190](https://github.com/oozcitak/xmlbuilder-js/issues/190).
- Removed the `skipNullAttributes` option. `null` attributes are now skipped by default. Added the `keepNullAttributes` option in case someone needs the old behavior.
- Removed the `skipNullNodes` option. `null` nodes are now skipped by default. Added the `keepNullNodes` option in case someone needs the old behavior.
- `undefined` values are now skipped when converting JS objects.
- Renamed stringify functions. See [#194](https://github.com/oozcitak/xmlbuilder-js/issues/194):
  * `eleName` -> `name`
  * `attName` -> `name`
  * `eleText` -> `text`
- Fixed argument order for `attribute` function in the writer. See [#196](https://github.com/oozcitak/xmlbuilder-js/issues/196).
- Added `openAttribute` and `closeAttribute` functions to writer. See [#196](https://github.com/oozcitak/xmlbuilder-js/issues/196).
- Added node types to node objects. Node types and writer states are exported by the module with the `nodeType` and `writerState` properties.
- Fixed a bug where array items would not be correctly converted. See [#159](https://github.com/oozcitak/xmlbuilder-js/issues/159).
- Fixed a bug where mixed-content inside JS objects with `#text` decorator would not be correctly converted. See [#171](https://github.com/oozcitak/xmlbuilder-js/issues/171).
- Fixed a bug where JS objects would not be expanded in callback mode. See [#173](https://github.com/oozcitak/xmlbuilder-js/issues/173).
- Fixed a bug where character validation would not obey document's XML version. Added separate validation for XML 1.0 and XML 1.1 documents. See [#169](https://github.com/oozcitak/xmlbuilder-js/issues/169).
- Fixed a bug where names would not be validated according to the spec. See [#49](https://github.com/oozcitak/xmlbuilder-js/issues/49).
- Renamed `text` property to `value` in comment and cdata nodes to unify the API.
- Removed `doctype` function to prevent name clash with DOM implementation. Use the `dtd` function instead.
- Removed dummy nodes from the XML tree (Those were created while chain-building the tree).
- Renamed `attributes`property to `attribs` to prevent name clash with DOM property with the same name.
- Implemented the DOM standard (read-only) to support XPath lookups. XML namespaces are not currently supported. See [#122](https://github.com/oozcitak/xmlbuilder-js/issues/122).

## [10.1.1] - 2018-10-24
- Fixed an edge case where a null node at root level would be printed although `skipNullNodes` was set. See [#187](https://github.com/oozcitak/xmlbuilder-js/issues/187).

## [10.1.0] - 2018-10-10
- Added the `skipNullNodes` option to skip nodes with null values. See [#158](https://github.com/oozcitak/xmlbuilder-js/issues/158).

## [10.0.0] - 2018-04-26
- Added current indentation level as a parameter to the onData function when in callback mode. See [#125](https://github.com/oozcitak/xmlbuilder-js/issues/125).
- Added name of the current node and parent node to error messages where possible. See [#152](https://github.com/oozcitak/xmlbuilder-js/issues/152). This has the potential to break code depending on the content of error messages.
- Fixed an issue where objects created with Object.create(null) created an error. See [#176](https://github.com/oozcitak/xmlbuilder-js/issues/176).
- Added test builds for node.js v8 and v10.

## [9.0.7] - 2018-02-09
- Simplified regex used for validating encoding.

## [9.0.4] - 2017-08-16
- `spacebeforeslash` writer option accepts `true` as well as space char(s).

## [9.0.3] - 2017-08-15
- `spacebeforeslash` writer option can now be used with XML fragments.

## [9.0.2] - 2017-08-15
- Added the `spacebeforeslash` writer option to add a space character before closing tags of empty elements. See
[#157](https://github.com/oozcitak/xmlbuilder-js/issues/157).

## [9.0.1] - 2017-06-19
- Fixed character validity checks to work with node.js 4.0 and 5.0. See
[#161](https://github.com/oozcitak/xmlbuilder-js/issues/161).

## [9.0.0] - 2017-05-05
- Removed case conversion options.
- Removed support for node.js 4.0 and 5.0. Minimum required version is now 6.0.
- Fixed valid char filter to use XML 1.1 instead of 1.0. See
[#147](https://github.com/oozcitak/xmlbuilder-js/issues/147).
- Added options for negative indentation and suppressing pretty printing of text
nodes. See
[#145](https://github.com/oozcitak/xmlbuilder-js/issues/145).

## [8.2.2] - 2016-04-08
- Falsy values can now be used as a text node in callback mode.

## [8.2.1] - 2016-04-07
- Falsy values can now be used as a text node. See 
[#117](https://github.com/oozcitak/xmlbuilder-js/issues/117).

## [8.2.0] - 2016-04-01
- Removed lodash dependency to keep the library small and simple. See
[#114](https://github.com/oozcitak/xmlbuilder-js/issues/114),
[#53](https://github.com/oozcitak/xmlbuilder-js/issues/53),
and [#43](https://github.com/oozcitak/xmlbuilder-js/issues/43).
- Added title case to name conversion options.

## [8.1.0] - 2016-03-29
- Added the callback option to the `begin` export function. When used with a
callback function, the XML document will be generated in chunks and each chunk
will be passed to the supplied function. In this mode, `begin` uses a different
code path and the builder should use much less memory since the entire XML tree
is not kept. There are a few drawbacks though. For example, traversing the document
tree or adding attributes to a node after it is written is not possible. It is
also not possible to remove nodes or attributes.

``` js
var result = '';

builder.begin(function(chunk) { result += chunk; })
  .dec()
  .ele('root')
    .ele('xmlbuilder').up()
  .end();
```

- Replaced native `Object.assign` with `lodash.assign` to support old JS engines.  See [#111](https://github.com/oozcitak/xmlbuilder-js/issues/111).

## [8.0.0] - 2016-03-25
- Added the `begin` export function. See the wiki for details.
- Added the ability to add comments and processing instructions before and after the root element. Added `commentBefore`, `commentAfter`, `instructionBefore` and `instructionAfter` functions for this purpose.
- Dropped support for old node.js releases. Minimum required node.js version is now 4.0.

## [7.0.0] - 2016-03-21
- Processing instructions are now created as regular nodes. This is a major breaking change if you are using processing instructions. Previously processing instructions were inserted before their parent node. After this change processing instructions are appended to the children of the parent node. Note that it is not currently possible to insert processing instructions before or after the root element.
```js
root.ele('node').ins('pi');
// pre-v7
<?pi?><node/>
// v7
<node><?pi?></node>
```

## [6.0.0] - 2016-03-20
- Added custom XML writers. The default string conversion functions are now collected under the `XMLStringWriter` class which can be accessed by the `stringWriter(options)` function exported by the module. An `XMLStreamWriter` is also added which outputs the XML document to a writable stream. A stream writer can be created by calling the `streamWriter(stream, options)` function exported by the module. Both classes are heavily customizable and the details are added to the wiki. It is also possible to write an XML writer from scratch and use it when calling `end()` on the XML document.

## [5.0.1] - 2016-03-08
- Moved require statements for text case conversion to the top of files to reduce lazy requires.

## [5.0.0] - 2016-03-05
- Added text case option for element names and attribute names. Valid cases are `lower`, `upper`, `camel`, `kebab` and `snake`.
- Attribute and element values are escaped according to the [Canonical XML 1.0 specification](http://www.w3.org/TR/2000/WD-xml-c14n-20000119.html#charescaping). See [#54](https://github.com/oozcitak/xmlbuilder-js/issues/54) and [#86](https://github.com/oozcitak/xmlbuilder-js/issues/86).
- Added the `allowEmpty` option to `end()`. When this option is set, empty elements are not self-closed.
- Added support for [nested CDATA](https://en.wikipedia.org/wiki/CDATA#Nesting). The triad `]]>` in CDATA is now automatically replaced with `]]]]><![CDATA[>`.

## [4.2.1] - 2016-01-15
- Updated lodash dependency to 4.0.0.

## [4.2.0] - 2015-12-16
- Added the `noDoubleEncoding` option to `create()` to control whether existing html entities are encoded.

## [4.1.0] - 2015-11-11
- Added the `separateArrayItems` option to `create()` to control how arrays are handled when converting from objects. e.g.

```js
root.ele({ number: [ "one", "two"  ]});
// with separateArrayItems: true
<number>
  <one/>
  <two/>
</number>
// with separateArrayItems: false
<number>one</number>
<number>two</number>
```

## [4.0.0] - 2015-11-01
- Removed the `#list` decorator. Array items are now created as child nodes by default.
- Fixed a bug where the XML encoding string was checked partially.

## [3.1.0] - 2015-09-19
- `#list` decorator ignores empty arrays.

## [3.0.0] - 2015-09-10
- Allow `\r`, `\n` and `\t` in attribute values without escaping. See [#86](https://github.com/oozcitak/xmlbuilder-js/issues/86).

## [2.6.5] - 2015-09-09
- Use native `isArray` instead of lodash.
- Indentation of processing instructions are set to the parent element's.

## [2.6.4] - 2015-05-27
- Updated lodash dependency to 3.5.0.

## [2.6.3] - 2015-05-27
- Bumped version because previous release was not published on npm.

## [2.6.2] - 2015-03-10
- Updated lodash dependency to 3.5.0.

## [2.6.1] - 2015-02-20
- Updated lodash dependency to 3.3.0.

## [2.6.0] - 2015-02-20
- Fixed a bug where the `XMLNode` constructor overwrote the super class parent.
- Removed document property from cloned nodes.
- Switched to mocha.js for testing.

## [2.5.2] - 2015-02-16
- Updated lodash dependency to 3.2.0.

## [2.5.1] - 2015-02-09
- Updated lodash dependency to 3.1.0.
- Support all node >= 0.8.

## [2.5.0] - 2015-00-03
- Updated lodash dependency to 3.0.0.

## [2.4.6] - 2015-01-26
-	Show more information from attribute creation with null values.
-	Added iojs as an engine.
-	Self close elements with empty text.

## [2.4.5] - 2014-11-15
- Fixed prepublish script to run on windows.
- Fixed  bug in XMLStringifier where an undefined value was used while reporting an invalid encoding value.
- Moved require statements to the top of files to reduce lazy requires. See [#62](https://github.com/oozcitak/xmlbuilder-js/issues/62).

## [2.4.4] - 2014-09-08
- Added the `offset` option to `toString()` for use in XML fragments.

## [2.4.3] - 2014-08-13
- Corrected license in package description.

## [2.4.2] - 2014-08-13
- Dropped performance test and memwatch dependency.

## [2.4.1] - 2014-08-12
- Fixed a bug where empty indent string was omitted when pretty printing. See [#59](https://github.com/oozcitak/xmlbuilder-js/issues/59).

## [2.4.0] - 2014-08-04
- Correct cases of pubID and sysID.
- Use single lodash instead of separate npm modules. See [#53](https://github.com/oozcitak/xmlbuilder-js/issues/53).
- Escape according to Canonical XML 1.0. See [#54](https://github.com/oozcitak/xmlbuilder-js/issues/54).

## [2.3.0] - 2014-07-17
- Convert objects to JS primitives while sanitizing user input.
- Object builder preserves items with null values. See [#44](https://github.com/oozcitak/xmlbuilder-js/issues/44).
- Use modularized lodash functions to cut down dependencies.
- Process empty objects when converting from objects so that we don't throw on empty child objects.

## [2.2.1] - 2014-04-04
- Bumped version because previous release was not published on npm.

## [2.2.0] - 2014-04-04
- Switch to lodash from underscore.
- Removed legacy `ext` option from `create()`.
- Drop old node versions: 0.4, 0.5, 0.6. 0.8 is the minimum requirement from now on.

## [2.1.0] - 2013-12-30
- Removed duplicate null checks from constructors.
- Fixed node count in performance test.
- Added option for skipping null attribute values. See [#26](https://github.com/oozcitak/xmlbuilder-js/issues/26).
- Allow multiple values in `att()` and `ins()`.
- Added ability to run individual performance tests.
- Added flag for ignoring decorator strings.

## [2.0.1] - 2013-12-24
- Removed performance tests from npm package.

## [2.0.0] - 2013-12-24
- Combined loops for speed up.
- Added support for the DTD and XML declaration.
- `clone` includes attributes.
- Added performance tests.
- Evaluate attribute value if function.
- Evaluate instruction value if function.

## [1.1.2] - 2013-12-11
- 	Changed processing instruction decorator to `?`.

## [1.1.1] - 2013-12-11
- 	Added processing instructions to JS object conversion.

## [1.1.0] - 2013-12-10
- Added license to package.
- `create()` and `element()` accept JS object to fully build the document.
- Added `nod()` and `n()` aliases for `node()`.
- Renamed `convertAttChar` decorator to `convertAttKey`.
- Ignore empty decorator strings when converting JS objects.

## [1.0.2] - 2013-11-27
- Removed temp file which was accidentally included in the package.

## [1.0.1] - 2013-11-27
- Custom stringify functions affect current instance only.

## [1.0.0] - 2013-11-27
- Added processing instructions.
- Added stringify functions to sanitize and convert input values.
- Added option for headless XML documents.
- Added vows tests.
- Removed Makefile. Using npm publish scripts instead.
- Removed the `begin()` function. `create()` begins the document by creating the root node.

## [0.4.3] - 2013-11-08
- Added option to include surrogate pairs in XML content. See [#29](https://github.com/oozcitak/xmlbuilder-js/issues/29).
- Fixed empty value string representation in pretty mode.
- Added pre and postpublish scripts to package.json.
- Filtered out prototype properties when appending attributes. See [#31](https://github.com/oozcitak/xmlbuilder-js/issues/31).

## [0.4.2] - 2012-09-14
- Removed README.md from `.npmignore`.

## [0.4.1] - 2012-08-31
- Removed `begin()` calls in favor of `XMLBuilder` constructor.
- Added the `end()` function. `end()` is a convenience over `doc().toString()`.

## [0.4.0] - 2012-08-31
- Added arguments to `XMLBuilder` constructor to allow the name of the root element and XML prolog to be defined in one line.
- Soft deprecated `begin()`.

## [0.3.11] - 2012-08-13
- Package keywords are fixed to be an array of values.

## [0.3.10] - 2012-08-13
- Brought back npm package contents which were lost due to incorrect configuration of `package.json` in previous releases.

## [0.3.3] - 2012-07-27
- Implemented `importXMLBuilder()`.

## [0.3.2] - 2012-07-20
- Fixed a duplicated escaping problem on `element()`.
- Fixed a problem with text node creation from empty string.
- Calling `root()` on the document element returns the root element.
- `XMLBuilder` no longer extends `XMLFragment`.

## [0.3.1] - 2011-11-28
- Added guards for document element so that nodes cannot be inserted at document level.

## [0.3.0] - 2011-11-28
- Added `doc()` to return the document element.

## [0.2.2] - 2011-11-28
- Prevent code relying on `up()`'s older behavior to break.

## [0.2.1] - 2011-11-28
- Added the `root()` function.

## [0.2.0] - 2011-11-21
- Added Travis-CI integration.
- Added coffee-script dependency.
- Added insert, traversal and delete functions.

## [0.1.7] - 2011-10-25
- No changes. Accidental release.

## [0.1.6] - 2011-10-25
- Corrected `package.json` bugs link to `url` from `web`.

## [0.1.5] - 2011-08-08
- Added missing npm package contents.

## [0.1.4] - 2011-07-29
- Text-only nodes are no longer indented.
- Added documentation for multiple instances.

## [0.1.3] - 2011-07-27
- Exported the `create()` function to return a new instance. This allows multiple builder instances to be constructed.
- Fixed `u()` function so that it now correctly calls `up()`.
- Fixed typo in `element()` so that `attributes` and `text` can be passed interchangeably.

## [0.1.2] - 2011-06-03
- `ele()` accepts element text.
- `attributes()` now overrides existing attributes if passed the same attribute name.

## [0.1.1] - 2011-05-19
- Added the raw output option.
- Removed most validity checks.

## [0.1.0] - 2011-04-27
- `text()` and `cdata()` now return parent element.
- Attribute values are escaped.

## [0.0.7] - 2011-04-23
-	Coerced text values to string.

## [0.0.6] - 2011-02-23
- Added support for XML comments.
- Text nodes are checked against CharData.

## [0.0.5] - 2010-12-31
- Corrected the name of the main npm module in `package.json`.

## [0.0.4] - 2010-12-28
- Added `.npmignore`.

## [0.0.3] - 2010-12-27
- root element is now constructed in `begin()`.
- moved prolog to `begin()`.
- Added the ability to have CDATA in element text.
- Removed unused prolog aliases.
- Removed `builder()` function from main module.
- Added the name of the main npm module in `package.json`.

## [0.0.2] - 2010-11-03
- `element()` expands nested arrays.
- Added pretty printing.
- Added the `up()`, `build()` and `prolog()` functions.
- Added readme.

## 0.0.1 - 2010-11-02
- Initial release

[11.0.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v10.1.1...v11.0.0
[10.1.1]: https://github.com/oozcitak/xmlbuilder-js/compare/v10.1.0...v10.1.1
[10.1.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v10.0.0...v10.1.0
[10.0.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v9.0.7...v10.0.0
[9.0.7]: https://github.com/oozcitak/xmlbuilder-js/compare/v9.0.4...v9.0.7
[9.0.4]: https://github.com/oozcitak/xmlbuilder-js/compare/v9.0.3...v9.0.4
[9.0.3]: https://github.com/oozcitak/xmlbuilder-js/compare/v9.0.2...v9.0.3
[9.0.2]: https://github.com/oozcitak/xmlbuilder-js/compare/v9.0.1...v9.0.2
[9.0.1]: https://github.com/oozcitak/xmlbuilder-js/compare/v9.0.0...v9.0.1
[9.0.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v8.2.2...v9.0.0
[8.2.2]: https://github.com/oozcitak/xmlbuilder-js/compare/v8.2.1...v8.2.2
[8.2.1]: https://github.com/oozcitak/xmlbuilder-js/compare/v8.2.0...v8.2.1
[8.2.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v8.1.0...v8.2.0
[8.1.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v8.0.0...v8.1.0
[8.0.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v7.0.0...v8.0.0
[7.0.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v6.0.0...v7.0.0
[6.0.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v5.0.1...v6.0.0
[5.0.1]: https://github.com/oozcitak/xmlbuilder-js/compare/v5.0.0...v5.0.1
[5.0.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v4.2.1...v5.0.0
[4.2.1]: https://github.com/oozcitak/xmlbuilder-js/compare/v4.2.0...v4.2.1
[4.2.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v4.1.0...v4.2.0
[4.1.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v4.0.0...v4.1.0
[4.0.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v3.1.0...v4.0.0
[3.1.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.6.5...v3.0.0
[2.6.5]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.6.4...v2.6.5
[2.6.4]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.6.3...v2.6.4
[2.6.3]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.6.2...v2.6.3
[2.6.2]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.6.1...v2.6.2
[2.6.1]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.6.0...v2.6.1
[2.6.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.5.2...v2.6.0
[2.5.2]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.5.1...v2.5.2
[2.5.1]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.5.0...v2.5.1
[2.5.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.4.6...v2.5.0
[2.4.6]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.4.5...v2.4.6
[2.4.5]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.4.4...v2.4.5
[2.4.4]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.4.3...v2.4.4
[2.4.3]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.4.2...v2.4.3
[2.4.2]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.4.1...v2.4.2
[2.4.1]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.4.0...v2.4.1
[2.4.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.2.1...v2.3.0
[2.2.1]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/oozcitak/xmlbuilder-js/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v1.1.2...v2.0.0
[1.1.2]: https://github.com/oozcitak/xmlbuilder-js/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/oozcitak/xmlbuilder-js/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/oozcitak/xmlbuilder-js/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/oozcitak/xmlbuilder-js/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.4.3...v1.0.0
[0.4.3]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.3.11...v0.4.0
[0.3.11]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.3.10...v0.3.11
[0.3.10]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.3.3...v0.3.10
[0.3.3]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.1.7...v0.2.0
[0.1.7]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.0.7...v0.1.0
[0.0.7]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/oozcitak/xmlbuilder-js/compare/v0.0.1...v0.0.2

