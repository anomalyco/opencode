import path from "node:path"

/**
 * A 2 s, 160x90, 10 fps H.264 MP4 with no audio track, so playback opens no audio device. Generated with:
 * ffmpeg -f lavfi -i testsrc2=size=160x90:rate=10 -t 2 -c:v libx264 -pix_fmt yuv420p -profile:v baseline
 *   -movflags +faststart -an -map_metadata -1 -fflags +bitexact video-only.mp4
 */
export const videoFixture = path.join(import.meta.dir, "media", "video-only.mp4")

/** The same clip at 4 s, long enough for a poster frame past the start. Generated with `-t 4`. */
export const longVideoFixture = path.join(import.meta.dir, "media", "video-long.mp4")

/** A 96x48 PNG, the bytes of `diffImageFixture`. */
export const imageFixture = path.join(import.meta.dir, "media", "image.png")
