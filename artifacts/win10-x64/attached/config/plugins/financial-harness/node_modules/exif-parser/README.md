exif-parser
========
exif-parser is a parser for image metadata in the exif format, the most popular metadata format for jpeg and tiff images. It is written in pure javascript and has no external dependencies. It can also get the size of jpeg images and the size of the jpeg thumbnail embedded in the exif data. It can also extract the embedded thumbnail image.

### Installing

    npm install exif-parser

You can also build a browser bundle to include it with a `<script>` tag in a HTML document, like this:

	git clone git@github.com:bwindels/exif-parser.git
	cd exif-parser/
	make build-browser-bundle

Built versions of the bundles are also available in the [exif-parser-browser-bundles repo](https://github.com/bwindels/exif-parser-browser-bundles).

This will generate a `dist/exif-parser-(version).js` and `dist/exif-parser-(version)-min.js` file. These bundles expose the parser on the `ExifParser` global variable, which you would use like this:

	var parser = window.ExifParser.create(arrayBuffer);

### Creating a parser
To start parsing exif data, create a new parser like below. Note that the buffer you pass does not have to be the buffer for the full jpeg file. The exif section of a jpeg file has a maximum size of 65535 bytes and the section seems to always occur within the first 100 bytes of the file. So it is safe to only fetch the first 65635 bytes of a jpeg file and pass those to the parser.

The buffer you pass to create can be a node buffer or a DOM ArrayBuffer.

```
var parser = require('exif-parser').create(buffer);
var result = parser.parse();
```

### Setting the flags

Before calling parse, you can set a number of flags on the parser, telling it how to behave while parsing.

Add fields in the binary format to result. Since these fields are mostly used for internal fields like Padding, you generally are not interested in these. If enabled, values for these fields will be a Buffer object in node or an ArrayBuffer in DOM environments (browsers).

    parser.enableBinaryFields([boolean]), default false;

EXIF tags are organized into different sections, and to tell you the offset to other sections, EXIF uses certain tags. These tags don't tell you anything about the image, but are more for parsers to find out about all tags. Hence, these "pointer" fields are not included in the result tags field by default. Change this flag to include them nonetheless.

    parser.enablePointers([boolean]), default false;

Resolve tags to their textual name, making result.tags a dictonary object instead of an array with the tag objects with no textual tag name.

    parser.enableTagNames([boolean]), default true;

Read the image size while parsing.

    parser.enableImageSize([boolean]), default true;

Read the EXIF tags. Could be useful to disable if you only want to read the image size.

    parser.enableReturnTags([boolean]), default true;

EXIF values can be represented in a number of formats (fractions, degrees, arrays, ...) with different precision.
Enabling this tries to cast values as much as possible to the appropriate javascript types like number, Date.

    parser.enableSimpleValues([boolean]), default true;

### working with the result

#### Getting the tags
the tags that were found while parsing are stored in ```result.tags``` unless you set ```parser.enableReturnTags(false)```. If ```parser.enableTagNames``` is set to true, ```result.tags``` will be an object with the key being the tag name and the value being the tag value. If ```parser.enableTagNames``` is set to false, ```result.tags``` will be an array of objects containing section, type and value properties.

#### Getting the image size
If ```parser.enableImageSize``` is set to true, ```result.getImageSize()``` will give you the image size as an object with width and height properties.

#### Getting the thumbnail

You can check if there is a thumbnail present in the exif data with ```result.hasThumbnail()```. Exif supports thumbnails is jpeg and tiff format, though most are in jpeg format. You can check if there is a thumbnail present in a give format by passing the mime type: ```result.hasThumbnail("image/jpeg")```.

You can also get the image size of the thumbnail as an object with width and height properties: ```result.getThumbnailSize()```.

To get the node buffer or arraybuffer containing just the thumbnail, call ```result.getThumbnailBuffer()```

# Running the unit tests

Install `nodeunit` globally from npm if you haven't done so already.
You can run the tests with `nodeunit test/test-*.js`.

# Contributions

I welcome external contributions through pull requests. If you do so, please don't use regular expressions. I don't like them, and don't want to maintain a project where they are used. Also, when fixing a bug please provide a regression unit test if it makes sense.
