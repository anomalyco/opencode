---
title: Image
description: Decode, transform, and encode images with a fast native pipeline
---

`Bun.Image` is a chainable image pipeline for decoding, resizing, rotating, and re-encoding JPEG, PNG, WebP, HEIC, and AVIF — built on libjpeg-turbo, spng, libwebp, and SIMD geometry kernels, with zero npm dependencies and no native addon build step.

```ts
await Bun.file("photo.jpg").image().resize(400, 400, { fit: "inside" }).webp({ quality: 80 }).write("thumb.webp");
```

The API is shaped after [Sharp](https://sharp.pixelplumbing.com/): construct from an input, chain transforms, pick an output format, then `await` a terminal method. Nothing runs until the terminal is awaited, and the work executes off the JavaScript thread.

## Input

The constructor accepts a path, bytes, or a `Blob` — including `Bun.file()` and `Bun.s3()`. `Blob#image()` is shorthand for `new Bun.Image(blob)`:

```ts
new Bun.Image("./photo.jpg"); // file path
new Bun.Image(buffer); // Buffer / ArrayBuffer / TypedArray
new Bun.Image(Bun.file("photo.jpg")); // BunFile (read lazily, off-thread)
Bun.file("photo.jpg").image(); // same as above
Bun.s3("bucket/photo.jpg").image(); // S3File
```

The format is sniffed from the bytes — extensions and `Content-Type` are ignored.

**Path strings are filesystem paths.** Don't pass user-controlled strings directly to the constructor — that's an arbitrary-file-read primitive. Read untrusted input into a `Buffer` (e.g. via `fetch`/`Bun.file` with your own validation) and pass the bytes.

When passing a `TypedArray`/`ArrayBuffer`, don't mutate it while a terminal is pending — decode runs off-thread and borrows the bytes. `SharedArrayBuffer` and resizable buffers are refused; use `buf.slice()` to pass a fixed view.

A second `options` argument guards against decompression bombs and controls EXIF handling:

```ts
new Bun.Image(input, {
  // Reject if width*height > this. Checked after reading the header,
  // before allocating the pixel buffer. Default matches Sharp (~268 MP).
  maxPixels: 4096 * 4096,
  // Apply JPEG EXIF Orientation before any other op. Default: true.
  autoOrient: true,
});
```

## Metadata

Read `width`, `height`, and `format` without decoding pixel data:

```ts
const { width, height, format } = await new Bun.Image(input).metadata();
// => { width: 1920, height: 1080, format: "jpeg" }
```

## Resize

```ts
img.resize(800); // width 800, keep aspect ratio
img.resize(800, 600); // exactly 800×600 (stretch)
img.resize(800, 600, { fit: "inside" }); // fit within 800×600
img.resize(800, 600, { withoutEnlargement: true }); // never upscale
img.resize(800, 600, { filter: "mitchell" });
```

| `fit`              | Behavior                                            |
| ------------------ | --------------------------------------------------- |
| `"fill"` (default) | Stretch to exactly `width × height`                 |
| `"inside"`         | Preserve aspect ratio; result fits _within_ the box |

`filter` selects the resampling kernel. The default `"lanczos3"` is the right choice for photographs.

| Filter                    | Use when                                         |
| ------------------------- | ------------------------------------------------ |
| `"lanczos3"` _(default)_  | General-purpose, sharpest for photos             |
| `"lanczos2"`              | Slightly softer, fewer ringing artifacts         |
| `"mitchell"`              | Smooth gradients; the classic bicubic compromise |
| `"cubic"`                 | Catmull-Rom — sharper than Mitchell, can ring    |
| `"mks2013"` / `"mks2021"` | "Magic Kernel Sharp"; used by Facebook/Instagram |
| `"bilinear"` / `"linear"` | Fast, soft                                       |
| `"box"`                   | Area-average; good for large integer downscales  |
| `"nearest"`               | Pixel art / hard edges                           |

When the source is a JPEG and the target is at most half the source size, decode skips straight to the nearest M/8 IDCT scale, so generating a thumbnail from a 24 MP photo never materializes the full-resolution buffer.

## Rotate · flip

```ts
img.rotate(90); // 90° clockwise (multiples of 90 only)
img.flip(); // mirror vertically (about the x-axis)
img.flop(); // mirror horizontally (about the y-axis)
```

## Modulate

```ts
img.modulate({
  brightness: 1.2, // 1 = unchanged
  saturation: 0, // 0 = greyscale, 1 = unchanged, >1 = boost
});
```

## Output formats

Calling a format method sets the encode target; without one, the source format is reused.

```ts
img.jpeg({ quality: 85 }); // 1–100, default 80
img.png({ compressionLevel: 6 }); // zlib level 0–9
img.png({ palette: true, colors: 64, dither: true }); // indexed PNG
img.webp({ quality: 80 });
img.webp({ lossless: true });
img.heic({ quality: 80 }); // macOS / Windows only
img.avif({ quality: 60 }); // macOS / Windows only
```

`palette: true` quantizes to a ≤256-color palette and emits an indexed (color-type 3) PNG, optionally with Floyd–Steinberg `dither`. This is typically 3–5× smaller than truecolor for screenshots and UI assets.

## Terminals

A pipeline does no work until one of these is awaited:

```ts
await img.bytes(); // Uint8Array
await img.buffer(); // Buffer
await img.blob(); // Blob with .type set to the output MIME
await img.toBase64(); // string
await img.dataurl(); // "data:image/png;base64,…"
await img.write("out.webp"); // number (bytes written)
await img.write(Bun.s3("bucket/out.webp"));
```

`.write()` accepts the same destinations as `Bun.write` — a path string, `Bun.file()`, `Bun.s3()`, or an fd. If you didn't chain a format method and the destination is a path string, the extension picks one (`.jpg`/`.png`/`.webp`/`.heic`/`.avif`).

## Placeholders

For a low-quality placeholder to inline in HTML before the real image loads, `.placeholder()` returns a [ThumbHash](https://evanw.github.io/thumbhash/)-rendered ≤32px blur as a `data:` URL — ~400–700 bytes, no client-side decoder needed:

```ts
const lqip = await Bun.file("hero.jpg").image().placeholder();
// <img src={lqip} … /> — then swap to the real URL on load.
```

For coarse-to-fine rendering of the image _itself_, encode a progressive JPEG:

```ts
img.jpeg({ progressive: true });
```

After the first terminal resolves, `img.width` and `img.height` reflect the _output_ dimensions (they're `-1` before).

## `Bun.serve` integration

A `Bun.Image` pipeline is a valid `Response` body and sets `Content-Type` automatically. To keep the encode off the JS thread in a server handler, await a terminal first:

```ts
Bun.serve({
  routes: {
    "/avatar/:id": async req => {
      // Validate before touching the filesystem (see the Input note above).
      if (!/^[a-z0-9]+$/.test(req.params.id)) return new Response(null, { status: 400 });
      const out = await Bun.file(`avatars/${req.params.id}.png`).image().resize(128, 128).webp().blob();
      return new Response(out);
    },
  },
});
```

Passing the pipeline directly (`new Response(img)`) also works, but currently runs the encode synchronously during body init.

## Clipboard

```ts
const img = Bun.Image.fromClipboard();
if (img) {
  const png = await img.resize(800, 800, { fit: "inside" }).png().bytes();
}
```

`fromClipboard()` reads PNG, TIFF, HEIC, JPEG, WebP, GIF, or BMP from the system pasteboard on macOS and Windows; the regular decode pipeline takes it from there. Returns `null` if there's no image, and always `null` on Linux — call `wl-paste`/`xclip` yourself and pass the bytes to the constructor.

For a passive "image in clipboard, press ⌘V" hint, poll `clipboardChangeCount()` (a single integer read) and call `hasClipboardImage()` only when it moves; macOS has no clipboard-change notification, so this is the documented pattern.

## Platform backends

|                        | Linux                             | macOS             | Windows      |
| ---------------------- | --------------------------------- | ----------------- | ------------ |
| JPEG / PNG / WebP      | libjpeg-turbo · spng · libwebp    | same              | same         |
| BMP / GIF (decode)     | built-in                          | ImageIO           | WIC          |
| TIFF (decode)          | ❌                                | ImageIO           | WIC          |
| Resize / rotate / flip | Highway SIMD                      | Accelerate vImage | Highway SIMD |
| HEIC / AVIF            | ❌ `ERR_IMAGE_FORMAT_UNSUPPORTED` | ImageIO ²         | WIC ¹        |
| Clipboard              | ❌ returns `null`                 | NSPasteboard      | Win32        |

¹ Windows requires the **HEIF Image Extensions** / **AV1 Video Extension** from the Microsoft Store.
² AVIF _encode_ needs an OS AV1 encoder — Apple Silicon M3+ only. Intel Mac and M1/M2 reject with `ERR_IMAGE_FORMAT_UNSUPPORTED`; AVIF _decode_ works everywhere ImageIO does (macOS 13+).

When a system-backend format isn't available on the current machine, the terminal rejects with `error.code === "ERR_IMAGE_FORMAT_UNSUPPORTED"` — branch on that to fall back to a portable format:

```ts
const out = await img
  .avif({ quality: 50 })
  .bytes()
  .catch(e => {
    if (e.code === "ERR_IMAGE_FORMAT_UNSUPPORTED") return img.webp({ quality: 80 }).bytes();
    throw e;
  });
```

Formats handled by the system backend (TIFF, HEIC, AVIF, clipboard) inherit the **OS's** patch level — keep macOS / Windows updated. JPEG, PNG, and WebP go through the same statically-linked codecs on every platform, so encoded output is byte-identical across Linux, macOS, and Windows. To force the portable Highway path for geometry too — e.g. for golden-image tests — set the process-global backend:

```ts
Bun.Image.backend = "bun"; // default is "system" on macOS/Windows
```
