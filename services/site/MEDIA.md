# Site media

The site's heavy media (product videos, arcade sounds, 3D models and download zips; `media-manifest.txt` lists every file with its SHA-256 and size) is not in git and not in the Worker's static assets. It lives in the existing files bucket behind the `/files` route (`services/files`, which already handles ranges, ETags, CORS and caching), under `site/2026-11/` at the same path it has under `public/`.

## How it works

- `src/lib/media.ts` holds the one base path, `mediaBase = "/files/site/2026-11"`, and the file types that live in the bucket (`mediaFile`: `mp4`, `webm`, `mov`, `mp3`, `wav`, `ogg`, `m4a`, `zip`, `glb`, `gltf`).
- Pages build media URLs with `mediaUrl("/product-videos/heroes/sdk-landscape-dark.mp4")`, which returns `/files/site/2026-11/product-videos/heroes/sdk-landscape-dark.mp4`. Nothing redirects at request time.
- The build (`script/build.ts`) drops every `mediaFile` from the Worker's assets, so a local copy in `public/` never ships.
- In development, `vite dev` proxies `/files` to `https://dev.opencode.ai`, so pages play the dev bucket's copies.
- Images (`png`, `jpg`, `webp`, `avif`, `svg`), posters, fonts and the 3D decoders (`arcade3d/draco`, `arcade3d/basis`) stay in git and in the static assets.
- OG Studio's link cards are in the bucket too, under `site/og/` (see [Link cards](#link-cards)). `inBucket` leaves `og/` in the static assets only for a version 1 manifest, which copies its files there.
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

## Link cards

OG Studio (the local design tool that makes the link cards) uploads every card PNG and `og:video` MP4 to both files buckets under `site/og/`, and commits only `src/asset/og-studio/manifest.json`. File names end in a hash of their content (`home-98637499f6.png`, `home-uk-7dbf00d466.png`, `home-ec8331a4d6.mp4`), so an object never changes and a redesign only adds new objects; nothing is overwritten and nothing grows the repo.

The manifest (version 2) names the files and where they are served:

```json
{
  "version": 2,
  "generator": "og-studio",
  "width": 1200,
  "height": 630,
  "base": "/files/site/og",
  "cards": {
    "/": {
      "image": "home-98637499f6.png",
      "alt": "…",
      "video": "home-ec8331a4d6.mp4",
      "locales": { "uk": { "image": "home-uk-7dbf00d466.png", "alt": "…" } }
    }
  }
}
```

`script/og.ts` writes `${base}/<file>` into `src/lib/og-images.json`, and `ShareMeta` prefixes `https://opencode.ai`, so every stage's `og:image` and `og:video` load from the production bucket. Pages that are not in the manifest still get a card rendered by `script/og.ts` into `public/og/`.

Upload new files to both buckets before you merge the manifest that names them. The buckets are in different accounts (`services/files/wrangler.jsonc`): `opencode-dev-files` in the dev account and `opencode-production-files` in the production account. To upload by hand, from a folder without a `cloudflare.config.ts` (so `cf` doesn't load this one):

```sh
CLOUDFLARE_ACCOUNT_ID=d8e944f537ceef3f06a5bd3aec1d7a53 cf r2 objects put site/og/home-98637499f6.png \
  --bucket-name opencode-dev-files --file home-98637499f6.png --content-type image/png
CLOUDFLARE_ACCOUNT_ID=15d29c8639fd3733b1b5486a2acfd968 cf r2 objects put site/og/home-98637499f6.png \
  --bucket-name opencode-production-files --file home-98637499f6.png --content-type image/png
curl -sI https://dev.opencode.ai/files/site/og/home-98637499f6.png   # expect 200 and image/png
curl -sI https://opencode.ai/files/site/og/home-98637499f6.png       # expect 200 and image/png
```

Use `--content-type video/mp4` for videos. Never delete an object that a merged manifest names: old link previews keep loading it.
