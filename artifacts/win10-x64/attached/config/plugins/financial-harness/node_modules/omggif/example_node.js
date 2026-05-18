// (c) Dean McNamee <dean@gmail.com>, 2013.
// Node omggif example to write out a few example images.

var fs = require('fs');
var omggif = require('./omggif');

// Needs to be large enough for the final full file size.  Can be any type of
// buffer that supports [] (an Array, Uint8Array, Node Buffer, etc).
var buf = new Buffer(1024 * 1024);

function gen_static_global() {
  var gf = new omggif.GifWriter(buf, 2, 2, {palette: [0xff0000, 0x0000ff]});
  gf.addFrame(0, 0, 2, 2,
              [0, 1, 1, 0]);
  return buf.slice(0, gf.end());
}

function gen_static_local() {
  var gf = new omggif.GifWriter(buf, 2, 2);
  gf.addFrame(0, 0, 2, 2,
              [0, 1, 1, 0],
              {palette: [0xff0000, 0x0000ff]});
  return buf.slice(0, gf.end());
}

function gen_anim() {
  // The loop parameter is the number of times to loop, or 0 for forever.
  // A value of 1 will play twice (first time, and then one loop time).
  // To play only once do not specify loop or pass null.
  var gf = new omggif.GifWriter(buf, 2, 2, {loop: 1});
  gf.addFrame(0, 0, 2, 2,
              [0, 1, 1, 0],
              {palette: [0xff0000, 0x0000ff]});
  gf.addFrame(0, 0, 2, 2,
              [1, 0, 0, 1],
              {palette: [0xff0000, 0x0000ff],
               delay: 10});  // Delay in hundredths of a sec (100 = 1s).
  return buf.slice(0, gf.end());
}

function gen_gray_strip() {
  var gf = new omggif.GifWriter(buf, 256, 1);
  var palette = [ ];
  var indices = [ ];
  for (var i = 0; i < 256; ++i) {
    palette.push(i << 16 | i << 8 | i);
    indices.push(i);
  }
  gf.addFrame(0, 0, 256, 1, indices, {palette: palette});
  return buf.slice(0, gf.end());
}

// More than 8-bit color (via tiling of several frames).  Browsers seem to
// treat this as an animation though, with an enforced minimum time between
// frames which makes it animated instead of the intended static image.
function gen_color_strip() {
  var gf = new omggif.GifWriter(buf, 256, 256, {palette: [0x000000, 0xff0000],
                                               background: 1});

  var indices = [ ];
  for (var i = 0; i < 256; ++i) indices.push(i);

  for (var j = 0; j < 256; ++j) {
    var palette = [ ];
    for (var i = 0; i < 256; ++i)
      palette.push(j << 16 | i << 8 | i);
    gf.addFrame(0, j, 256, 1, indices, {palette: palette, disposal: 1});
  }
  return buf.slice(0, gf.end());
}

// 1x1 white, generates the same as Google's 35 byte __utm.gif, except for some
// reason that I'm not sure of they set their background index to 255.
function gen_empty_white() {
  var gf = new omggif.GifWriter(buf, 1, 1, {palette: [0xffffff, 0x000000]});
  gf.addFrame(0, 0, 1, 1, [0]);
  return buf.slice(0, gf.end());
}

// 1x1 transparent 43 bytes.
function gen_empty_trans() {
  var gf = new omggif.GifWriter(buf, 1, 1, {palette: [0x000000, 0x000000]});
  gf.addFrame(0, 0, 1, 1, [0], {transparent: 0});
  return buf.slice(0, gf.end());
}

// with lzw block of 256.
// see: https://github.com/deanm/omggif/issues/5
function gen_block256() {
  var width = 4840;
  var gf = new omggif.GifWriter(buf, width, 1, {
    palette: [0x000000, 0x000000, 0x000000, 0x000000,
              0x000000, 0x000000, 0x000000, 0x000000]
  });
  var stream = Array(width);
  for (var i = 0; i < width; ++i) stream[i] = i & 0x7;
  gf.addFrame(0, 0, width, 1, stream, {transparent: 0});
  var data = buf.slice(0, gf.end());
  // Make sure it decodes.
  var gr = new omggif.GifReader(data);
  var fi0 = gr.frameInfo(0);
  /*
  console.log(fi0);
  console.log(buf.slice(fi0.data_offset, fi0.data_offset + fi0.data_length));
  */
  return data;
}

fs.writeFileSync('./test_static_global_palette.gif', gen_static_global());
fs.writeFileSync('./test_static_local_palette.gif', gen_static_local());
fs.writeFileSync('./test_anim.gif', gen_anim());
fs.writeFileSync('./test_gray_strip.gif', gen_gray_strip());
fs.writeFileSync('./test_color_strip.gif', gen_color_strip());
fs.writeFileSync('./test_empty_white.gif', gen_empty_white());
fs.writeFileSync('./test_empty_trans.gif', gen_empty_trans());
fs.writeFileSync('./test_block256.gif', gen_block256());
