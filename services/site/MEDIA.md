# Site media

The site's heavy media (product videos, arcade sounds, 3D models and download zips; `media-manifest.txt` lists every file with its SHA-256 and size) is not in git and not in the Worker's static assets. It lives in the existing files bucket behind the `/files` route (`services/files`, which already handles ranges, ETags, CORS and caching), under `site/2026-11/` at the same path it has under `public/`.

## How it works

- `src/lib/media.ts` holds the one base path, `mediaBase = "/files/site/2026-11"`, and the file types that live in the bucket (`mediaFile`: `mp4`, `webm`, `mov`, `mp3`, `wav`, `ogg`, `m4a`, `zip`, `glb`, `gltf`).
- Pages build media URLs with `mediaUrl("/product-videos/heroes/sdk-landscape-dark.mp4")`, which returns `/files/site/2026-11/product-videos/heroes/sdk-landscape-dark.mp4`. Nothing redirects at request time.
- The build (`script/build.ts`) drops every `mediaFile` from the Worker's assets, so a local copy in `public/` never ships.
- In development, `vite dev` proxies `/files` to `https://dev.opencode.ai`, so pages play the dev bucket's copies.
- Images (`png`, `jpg`, `webp`, `avif`, `svg`), posters, fonts and the 3D decoders (`arcade3d/draco`, `arcade3d/basis`) stay in git and in the static assets.
- `videoSources()` offers a video's AV1 and HEVC copies (`media/<base>.<width>.<codec>.<hash>.mp4`, listed in `src/component/site/media-manifest.json`) before the H.264 original. The manifest lists only copies that are in the bucket; a video without copies plays its original.

| Folder | Files |
| --- | --- |
| `product-videos/` | hero, card, feature and locked videos |
| `arcade404/audio/` | 404 arcade sounds |
| `arcade3d/` | cabinet models (`*.glb`) |
| `font/film/` | font film videos |
| `press-media/zips/`, `press/anomaly/*.zip` | press kit downloads |
| `brand/badges/*.zip`, `opencode-brand-assets.zip` | brand downloads |

## Upload

Put the files in `public/` at their manifest paths, then:

```sh
cd services/site
bun ./script/upload-media.ts --mode dev          # dry run against opencode-dev-files
bun ./script/upload-media.ts --mode dev --run    # upload to dev
bun ./script/upload-media.ts --run               # upload to opencode-production-files
curl -sI https://dev.opencode.ai/files/site/2026-11/arcade3d/cabinet.glb   # expect 200
```

A changed file gets a new dated prefix (for example `site/2026-12`) and a new `mediaBase`, so cached copies never go stale.
