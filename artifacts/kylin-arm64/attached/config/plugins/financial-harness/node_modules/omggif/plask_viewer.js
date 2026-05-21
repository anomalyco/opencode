
var plask = require('plask');
var fs = require('fs');
var omggif = require('./omggif');

if (process.argv.length < 3) throw "Usage: <filename.gif>";
var buf = fs.readFileSync(process.argv[2]);
var gr = new omggif.GifReader(buf);

var pixels = plask.SkCanvas.create(gr.width, gr.height);

plask.simpleWindow({
  settings: {
    width: 800,
    height: 600
  },

  init: function() {
    var canvas = this.canvas, paint = this.paint;

    canvas.clear(230, 230, 230, 255);  // Draw the background, just once.
  },

  draw: function() {
    var canvas = this.canvas, paint = this.paint;

    var frame_num = this.framenum % gr.numFrames();
    var frame_info = gr.frameInfo(frame_num);

    if (frame_num === 0 || frame_info.disposal === 2 /* restore to bg */)
      pixels.clear(0, 0, 0, 255);

    var start = Date.now();
    gr.decodeAndBlitFrameBGRA(frame_num, pixels.pixels || pixels);
    console.log('Decoded and blit frame in: '  + (Date.now() - start) + 'ms');

    canvas.drawCanvas(paint, pixels, 0, 0, gr.width, gr.height);

    var this_ = this;
    setTimeout(function() { this_.redraw(); }, frame_info.delay * 10);
  }
});
