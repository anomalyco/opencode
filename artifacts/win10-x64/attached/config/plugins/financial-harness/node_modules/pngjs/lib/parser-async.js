"use strict";

let util = require("util");
let zlib = require("zlib");
let ChunkStream = require("./chunkstream");
let FilterAsync = require("./filter-parse-async");
let Parser = require("./parser");
let bitmapper = require("./bitmapper");
let formatNormaliser = require("./format-normaliser");

let ParserAsync = (module.exports = function (options) {
  ChunkStream.call(this);

  this._parser = new Parser(options, {
    read: this.read.bind(this),
    error: this._handleError.bind(this),
    metadata: this._handleMetaData.bind(this),
    gamma: this.emit.bind(this, "gamma"),
    palette: this._handlePalette.bind(this),
    transColor: this._handleTransColor.bind(this),
    finished: this._finished.bind(this),
    inflateData: this._inflateData.bind(this),
    simpleTransparency: this._simpleTransparency.bind(this),
    headersFinished: this._headersFinished.bind(this),
  });
  this._options = options;
  this.writable = true;

  this._parser.start();
});
util.inherits(ParserAsync, ChunkStream);

ParserAsync.prototype._handleError = function (err) {
  this.emit("error", err);

  this.writable = false;

  this.destroy();

  if (this._inflate && this._inflate.destroy) {
    this._inflate.destroy();
  }

  if (this._filter) {
    this._filter.destroy();
    // For backward compatibility with Node 7 and below.
    // Suppress errors due to _inflate calling write() even after
    // it's destroy()'ed.
    this._filter.on("error", function () {});
  }

  this.errord = true;
};

ParserAsync.prototype._inflateData = function (data) {
  if (!this._inflate) {
    if (this._bitmapInfo.interlace) {
      this._inflate = zlib.createInflate();

      this._inflate.on("error", this.emit.bind(this, "error"));
      this._filter.on("complete", this._complete.bind(this));

      this._inflate.pipe(this._filter);
    } else {
      let rowSize =
        ((this._bitmapInfo.width *
          this._bitmapInfo.bpp *
          this._bitmapInfo.depth +
          7) >>
          3) +
        1;
      let imageSize = rowSize * this._bitmapInfo.height;
      let chunkSize = Math.max(imageSize, zlib.Z_MIN_CHUNK);

      this._inflate = zlib.createInflate({ chunkSize: chunkSize });
      let leftToInflate = imageSize;

      let emitError = this.emit.bind(this, "error");
      this._inflate.on("error", function (err) {
        if (!leftToInflate) {
          return;
        }

        emitError(err);
      });
      this._filter.on("complete", this._complete.bind(this));

      let filterWrite = this._filter.write.bind(this._filter);
      this._inflate.on("data", function (chunk) {
        if (!leftToInflate) {
          return;
        }

        if (chunk.length > leftToInflate) {
          chunk = chunk.slice(0, leftToInflate);
        }

        leftToInflate -= chunk.length;

        filterWrite(chunk);
      });

      this._inflate.on("end", this._filter.end.bind(this._filter));
    }
  }
  this._inflate.write(data);
};

ParserAsync.prototype._handleMetaData = function (metaData) {
  this._metaData = metaData;
  this._bitmapInfo = Object.create(metaData);

  this._filter = new FilterAsync(this._bitmapInfo);
};

ParserAsync.prototype._handleTransColor = function (transColor) {
  this._bitmapInfo.transColor = transColor;
};

ParserAsync.prototype._handlePalette = function (palette) {
  this._bitmapInfo.palette = palette;
};

ParserAsync.prototype._simpleTransparency = function () {
  this._metaData.alpha = true;
};

ParserAsync.prototype._headersFinished = function () {
  // Up until this point, we don't know if we have a tRNS chunk (alpha)
  // so we can't emit metadata any earlier
  this.emit("metadata", this._metaData);
};

ParserAsync.prototype._finished = function () {
  if (this.errord) {
    return;
  }

  if (!this._inflate) {
    this.emit("error", "No Inflate block");
  } else {
    // no more data to inflate
    this._inflate.end();
  }
};

ParserAsync.prototype._complete = function (filteredData) {
  if (this.errord) {
    return;
  }

  let normalisedBitmapData;

  try {
    let bitmapData = bitmapper.dataToBitMap(filteredData, this._bitmapInfo);

    normalisedBitmapData = formatNormaliser(
      bitmapData,
      this._bitmapInfo,
      this._options.skipRescale
    );
    bitmapData = null;
  } catch (ex) {
    this._handleError(ex);
    return;
  }

  this.emit("parsed", normalisedBitmapData);
};
