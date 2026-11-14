# Moviola

**[moviola.hyphensam.com](https://moviola.hyphensam.com)**

Everyday video jobs in your browser: pull the sound out of a video, cut a clip, make a file small
enough to send, rewrap an MKV for a phone, save a still or a GIF. Videos never leave your device: the
work is done by [Mediabunny](https://mediabunny.dev/) and the browser's own decoders and encoders
(WebCodecs). Install it as an app and it works offline, and opens videos straight from your file
manager.

## Lossless first

Most jobs don't need to touch the picture or the sound, so Moviola copies the streams as they are
and nothing is lost. When a job has to re-encode, the action says so before it runs: every action
carries a **Lossless** or **Re-encodes** label, with a line saying what is copied and what isn't.

## Tools

- **Media info:** the container, every track's codec, size, frame rate, colour (SDR or HDR), sample
  rate, channels and bitrate, and the file's tags. Copies as plain text for a forum or bug report.
- **Extract audio:** copies the audio track into the file type that fits its codec (AAC to `.m4a`,
  Opus to `.opus`, AC-3 and DTS to `.mka` and so on), losslessly. Or converts to MP3 (128 to
  320 kbps), WAV (16 or 24-bit) or FLAC; WAV and FLAC are marked lossless only when every sample
  survives. Surround is mixed down to stereo for MP3. On an audio file it's Convert audio.
- **Trim:** Fast cuts without re-encoding, starting on the keyframe at or before your in point (it
  says how far back that is). Precise re-encodes the video so the cut lands on the exact frame and
  copies the audio. In and out from the timeline's handles, timecode fields or the `I` and `O` keys.
- **Change container:** rewraps the streams into MP4, MOV, MKV or WebM without touching them, and
  says which tracks the new container can't hold.
- **Remove audio:** copies the video without its sound, or keeps the audio tracks you tick.
- **Compress:** re-encodes to a quality (Smaller, Balanced, High) or to a target size such as 10 MB,
  optionally at 1080p, 720p or 480p, a lower frame rate, and H.264, HEVC, VP9 or AV1, whichever this
  browser can encode. The audio is kept, made smaller or removed. It says when a result misses its
  target or came out larger.
- **Grab frame:** the frame at the playhead at full size, as PNG, JPEG or WebP (lossy or lossless),
  saved or copied to the clipboard.
- **Make animation:** up to a minute as a GIF or an animated WebP, at 320, 480 or 640 px wide and
  10, 15 or 20 fps, looping or not.

It opens MP4, M4V, MOV, MKV, WebM and MPEG-TS (`.ts`, `.m2ts`, `.mts`) video, and MP3, M4A, WAV,
FLAC, Ogg, Opus and AAC audio. AVI, FLV and WMV aren't supported.

## Browsers

Moviola needs WebCodecs: Chrome or Edge 94, Firefox 130 or Safari 16.4, or newer. What it can
convert depends on what the browser can decode and encode, which differs between browsers and between
machines; the tools check and say what isn't available rather than failing partway.

- **Saving:** Chrome and Edge write results straight to a file you choose, at any size. Other
  browsers build the result in memory and download it, so a very long video needs plenty of free
  memory.
- **AC-3, E-AC-3, DTS and TrueHD** can't be decoded by any browser. They copy fine (Extract audio,
  Trim, Change container), but can't be converted.
- **HEVC** decodes and encodes only on some machines. Firefox on Windows has no HEVC in WebCodecs;
  Edge decodes it but can't encode it.
- **MP3, FLAC and AAC** encoders come with the app as WebAssembly for browsers that lack them
  (Firefox has none of the three, Chrome lacks MP3 and FLAC).
- **VP9 and AV1** are slow to encode in Firefox and land above the bitrate they're given; Chrome's
  are fast and accurate.
- **Playback:** files the browser can't play natively (MPEG-TS, HEVC without hardware support) are
  previewed as decoded frames, without sound. The tools still work.

## Keyboard

Space plays and pauses; ← and → move a second (five with Shift); `,` and `.` step a frame; Home and End
go to the start and end; `I` and `O` set the in and out points. The timeline's playhead and handles
are sliders: arrow keys move the playhead a second and a handle a frame (a second with Shift).

## Licence

Licensed under either of [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.

[Mediabunny](https://mediabunny.dev/) and its encoder add-ons are MPL-2.0, used unmodified. The
add-ons are WebAssembly builds of [LAME](https://lame.sourceforge.io/) (LGPL),
[libFLAC](https://xiph.org/flac/) (BSD-style) and [FFmpeg](https://ffmpeg.org/)'s AAC encoder
(LGPL). GIFs are written with [gifenc](https://github.com/mattdesl/gifenc) (MIT).

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in the
work by you, as defined in the Apache-2.0 licence, shall be dual licensed as above, without any
additional terms or conditions.

## Development

Needs Node 24+ and pnpm 11 (pinned in `package.json` and `.node-version`, which Cloudflare's builds
read too).

```bash
pnpm install
pnpm test          # Vitest
pnpm dev           # http://localhost:5173
```

This project is test-driven: see [CLAUDE.md](CLAUDE.md) for the rules and the architecture,
[SPEC.md](SPEC.md) for what each tool does, and [DESIGN.md](DESIGN.md) for the interface. The test
videos in `fixtures/` are made with ffmpeg by `pnpm fixtures`.

## Deploying

Cloudflare Workers Builds builds it from this repository on every push to `main` and serves it at
moviola.hyphensam.com (a custom domain on the Worker). The Worker's build settings:

- **Build command:** `pnpm build`
- **Deploy command:** `npx wrangler deploy`

The Worker only serves the static files in `dist/`, as set in [`wrangler.jsonc`](wrangler.jsonc).
The build fails if any file is over the 25 MiB limit on static assets, or if the service worker would
leave a file out of its precache (so the whole app, encoders included, works offline).
`public/_headers` sets cross-origin isolation headers, which a future ffmpeg.wasm fallback will need
for threads. To try the production build on the Workers runtime locally:
`pnpm build && pnpm exec wrangler dev`.
