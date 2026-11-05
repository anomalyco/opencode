# Media files

The site's heavy media (product videos, arcade sounds, 3D models and download zips; `media-manifest.txt` lists every file) is not in git and not in the Worker's static assets. It is served from the opencode.ai files bucket, the one the desktop downloads already use, under `https://opencode.ai/files/site/2026-11/`, at the same path it has under `public/`.

## How it works

- `src/lib/media.ts` holds the one base URL, `mediaBase` (default `https://opencode.ai/files/site/2026-11`, override with `VITE_MEDIA_URL`), and the file types that live in the bucket (`mediaFile`: `mp4`, `webm`, `mov`, `mp3`, `wav`, `ogg`, `m4a`, `zip`, `glb`, `gltf`).
- Pages keep linking the site path, for example `/product-videos/heroes/sdk-landscape-dark.mp4`.
- In development the file is in `public/` (git-ignored, see `.gitignore`), and the dev server serves it.
- In production the request misses the static assets and reaches the Worker. `middleware.ts` sends a 302 to `mediaBase` plus the path. `/files/*` itself is never redirected.
- Same origin (opencode.ai), so no CORS rule is needed: the arcade's `fetch` of its models and sounds works as is.
- Files that dev already tracked in git (for example `public/opencode-brand-assets.zip`) stay in git and in the static assets.
- Images (`png`, `jpg`, `webp`, `avif`, `svg`), posters, fonts and the 3D decoders (`arcade3d/draco`, `arcade3d/basis`) stay in git.

## Files

`media-manifest.txt` lists only the files the site requests in production (default settings, voice mode off), with SHA-256 and size. `bun ./script/upload-media.ts --manifest` lists every media file in `public/`; remove the ones no page requests before uploading.

| Folder | Files |
|---|---|
| `media/` | AV1 and HEVC copies of the product videos (`media.tsx`) |
| `product-videos/` | hero, card, card loop and feature videos (the originals, the last fallback) |
| `arcade404/audio/` | 404 arcade sounds (WebM Opus and MP3) |
| `arcade3d/` | cabinet models (`*.glb`) |
| `font/film/` | font film videos |
| `press-media/zips/`, `opencode-press-media.zip`, `press/anomaly/*.zip` | press kit downloads |
| `brand/badges/*.zip` | badge downloads |

## Serving

- Videos need HTTP range requests (`206`, `Accept-Ranges: bytes`); the files route supports them.
- Content types: `mp4` `video/mp4`, `webm` `audio/webm`, `mp3` `audio/mpeg`, `zip` `application/zip`, `glb` `model/gltf-binary`.
- `Cache-Control: public, max-age=31536000, immutable`. A changed file goes under a new version prefix (for example `site/2026-12`) and a new `mediaBase`.

## Upload

```sh
cd packages/console/app
bun ./script/upload-media.ts                                     # dry run: lists the uploads
MEDIA_BUCKET=<files bucket> MEDIA_PREFIX=site/2026-11 bun ./script/upload-media.ts --run
curl -sI https://opencode.ai/files/site/2026-11/arcade3d/cabinet.glb   # expect 200 and model/gltf-binary
```

The upload needs the media files in `public/`; they are not in git.
