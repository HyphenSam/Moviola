# Moviola

A static web app (Cloudflare Workers, static assets only) of everyday video tools that run entirely on
the user's device, with Mediabunny and the browser's WebCodecs. Installable (PWA) and works offline. The
name lives in `src/lib/brand.ts` and `vite.config.ts` (manifest) only. Sister project of Bytesize and
Art Cleaner; its setup and UI system are Bytesize's, refitted for video.

SPEC.md says what every tool does and is the authority for behaviour. PHASES.md is the build order;
tick a phase's status there when it's finished.

## Test-driven development is mandatory

Every change to behaviour follows red, green, refactor:

1. **Red.** Write or change a test that states the behaviour. Run it (`pnpm test <file>`) and watch it
   fail for the reason you expect. A test you never saw fail proves nothing.
2. **Green.** Write the least code that makes it pass.
3. **Refactor** with the tests green, then run the whole suite (`pnpm test`) and `pnpm typecheck`.

Rules:

- No production code without a failing test first. That includes bug fixes: reproduce the bug in a
  test, then fix it.
- Don't weaken, skip or delete a test to get green. If a test is wrong, say why in the change.
- Keep logic testable: planning each tool's job, choosing containers, bitrate and size maths,
  timecodes, file naming and settings are pure modules in `src/lib/`. They never import Mediabunny's
  runtime or the DOM (`import type` is fine). They take a `MediaInfo` (plain data) and settings and
  return a `Plan` (plain data) or a list of problems written for the user.
- `src/media/` is the only place that calls Mediabunny: `probe.ts` turns an `Input` into `MediaInfo`,
  `run.ts` turns a `Plan` into a `Conversion`. Copy-only jobs (extract audio losslessly, change
  container, remove audio, fast trim) need no WebCodecs, so they're tested end to end in Node against
  the real files in `fixtures/`. Check the bytes that come out, not just that nothing threw.
- Fakes over mocks: the worker client and job runner are tested with fakes from `src/lib/testing.ts`.
- Components get React Testing Library tests for behaviour users see (`// @vitest-environment jsdom`
  at the top of the file). Test what the user does and sees, not implementation details.
- Things only a real browser can show (WebCodecs decoding and encoding, playback, the save picker,
  the service worker) are checked in a real browser after the unit tests pass: Chrome in the built-in
  browser, Firefox through Playwright (the `playwright-cli` skill). Check both at least. Say what you
  checked when you report.

## Commands

```bash
pnpm install
pnpm dev              # http://localhost:5173
pnpm test             # Vitest, once
pnpm test:watch
pnpm typecheck
pnpm build            # typecheck + build to dist/; fails if any file is over the 25 MiB asset limit
                      # or left out of the service worker's precache
pnpm preview          # serves dist/ with the same headers as production
pnpm fixtures         # regenerates fixtures/ with ffmpeg (needs ffmpeg on PATH; the output is committed)
pnpm exec wrangler dev  # serves dist/ on the Workers runtime, reading public/_headers as production does
```

## Design

PRODUCT.md (who it's for, voice, principles) and DESIGN.md (tokens and rules) are the authorities
for UI work; tokens live in `src/index.css`. Keep to them: zinc neutrals, one amber accent for action,
selection and progress, a dark neutral stage so the picture can be judged, sentence-case labels,
state shown by form as well as colour, light and dark both first-class. Every action says whether it
is lossless or re-encodes.

## Code style

- KISS. Small modules, plain functions, no premature abstraction.
- TypeScript strict, Prettier (no semicolons, single quotes, 120 columns).
- Comment the why, briefly, in the style of the existing code.
- UI copy uses British spelling ("colour", "optimise", "licence").
- Stack: Vite, React 19, Tailwind v4, Radix primitives (`radix-ui`), lucide icons, Vitest, Mediabunny.
- pnpm only.

## Layout

- `src/lib/` pure logic: `info.ts` (the `MediaInfo` type and helpers), `capabilities.ts` (what this
  browser can decode and encode, as plain data), `containers.ts` (which container holds which codecs;
  the lossless audio container), `plans/` (one module per tool: settings + info + capabilities in,
  `Plan` or problems out; `plan.ts` holds the `Plan` type and the image jobs' `FramePlan` and `AnimationPlan`), `discarded.ts` (Mediabunny's discarded
  tracks as sentences), `progress.ts` (percentage, time left, size change), `bitrate.ts` (target
  size and quality maths), `gif.ts` (gifenc: RGBA frames in, GIF bytes out), `wav.ts` (a WAV's size, and RIFF's 4 GiB limit), `webp.ts` (still WebPs in, animated WebP bytes out), `timecode.ts`, `names.ts`, `settings.ts`, `protocol.ts` (page ↔ worker),
  `format-bytes.ts`, `plan-problems.ts` (what's wrong with a plan, against itself and the file; `run`
  checks every plan with it, and `plans/planners.test.ts` runs every planner through it), `theme.ts` (auto, light, dark; the cookie), `apps.ts` (the app launcher's list).
- `src/media/` Mediabunny wiring: `probe.ts`, `run.ts`, `formats.ts` (the output formats, and what
  each container holds as plain data for the planners), `frames.ts` (thumbnails and the page's
  preview frames), `images.ts` (Grab frame and Make animation, from `CanvasSink` in the worker), `encoders.ts` (registers the MP3, FLAC and AAC encoder add-ons when the browser lacks them),
  `gpu-scaler.ts` (resizes frames with WebGL for Mediabunny; the maths is in `src/lib/scale.ts`).
- `src/worker/` the Web Worker: receives a `File` and a `Plan`, runs it with `src/media/`, posts
  progress, cancels on request.
- `src/components/` the UI (`ui/` holds the primitives). `src/App.tsx` puts it together; it takes the
  worker client as a prop so tests pass a fake. `src/main.tsx` creates the real worker.
- `src/hooks/` state: `useSource` (the open file and its info), `useJob` (the running job), `usePlayer`,
  `useTheme` (applies and remembers the theme).
- `fixtures/` tiny media files made by `scripts/fixtures.sh`. Don't edit them by hand.

## How a job runs

1. The user picks a tool and its settings. The tool's planner (`src/lib/plans/`) turns the source's
   `MediaInfo`, the settings and the browser's capabilities into a `Plan`, or into problems that the
   settings column shows and that disable the action.
2. The page picks where the output goes: a file the user chooses with `showSaveFilePicker` (streamed
   to disk, any size) where the browser has it, or memory otherwise (downloaded at the end).
3. The worker opens the `File` with a `BlobSource` (read lazily, never all at once), runs the `Plan`
   as a Mediabunny `Conversion`, and posts progress.
4. The result joins the exports list with its size and a download or "saved" state.

Cancelling calls `conversion.cancel()` and aborts the file stream, so a half-written file is
discarded.

## Media facts that bite

- Decide by capability, never by user agent: `canEncodeVideo`, `canEncodeAudio`, and each track's
  `canDecode()`. Capabilities differ between browsers and between machines with the same browser.
- Lossless tools pass `copy: { mode: 'forced' }`, so Mediabunny can never quietly transcode. Check
  `conversion.isValid` and `discardedTracks` and turn every reason into a sentence for the user.
- Anything that re-encodes says so in the UI before it runs.
- Audio-only MP4 is named `.m4a`. Ogg holding Opus is named `.opus`, holding Vorbis `.ogg`.
- WebM takes only VP8, VP9 and AV1 video and Opus and Vorbis audio. Check with
  `format.getSupportedCodecs()`; don't keep a second copy of these tables.
- H.264 and HEVC need even dimensions; round resized sizes down to even numbers.
- MP4 and MOV written to a stream use `fastStart: 'reserve'`; written to memory, `'in-memory'`.
- Timestamps don't always start at 0. MPEG-TS starts near 1.4 s, and MP4 AAC priming goes slightly
  negative. `MediaInfo.start` is the playhead's 0 (first timestamp, clamped at 0); add it when
  asking Mediabunny for a time. The first video frame can be a little later than `start`.
- Chrome and Firefox both play MKV natively now; MPEG-TS is what reaches the fallback preview, with
  Firefox's late-starting MP4 (below).
- A media element's clock for a file starting 10 s in: Chrome counts the file's timestamps (the first
  frame at 10 s), Firefox counts from the first one, as the playhead does. Chrome's `currentTime` is
  still 0 at `loadedmetadata` and moves at `loadeddata`, so `NativeMedia` takes the position at
  `loadeddata` as the playhead's 0 and holds seeks until then. `seekable` starts at 0 in both.
- Element lengths of late files are wrong: Chrome's MP4 one (an empty edit) starts at 0.34 s and grows
  as it plays, and seeks clamp to it; Firefox's MKV and WebM one counts from 0 (14 s for 4 s), so it
  plays on to it. The player uses the probed length, stops there, and logs a mismatch once.
- Firefox plays an MP4 with an empty edit (`-output_ts_offset`) with its picture 0.56 s late against its
  own clock and sound, so no offset mends it. `buffered` starts there (0.573 s), which sends it to the
  frames preview.
- Firefox (158) seeks H.264 with B-frames in MKV up to 4 frames short of the time asked (x264's 3
  B-frames at 25 fps: 0 to 0.16 s), late start or not. It acts as if each frame lasts until the next
  block in the file, which is decode order, and shows the first frame whose end passes the time: with
  frames stored 0 4 2 1 3 8…, frame 3 "ends" at 8, so frames 4 to 7 show frame 3 and no seek reaches
  them. Without B-frames (`-bf 0`, all-intra), VP9 in MKV, and MP4 land on the frame, as Chrome does on
  all of them. `currentTime` and `requestVideoFrameCallback`'s `mediaTime` both echo the time asked, so
  the player can't see the miss; the playhead, Trim and Grab frame are right and only Firefox's picture
  is early. Without cues it's worse: seeks land on a keyframe up to 2 s off. Its 0 for a late WebM with
  Opus is after the Opus pre-skip, 6.5 ms past the probed start, which shows the next frame when the
  playhead is within that of one.
- Browsers can't decode AC-3, E-AC-3, DTS or TrueHD. Copying them works; converting them doesn't,
  and the UI says so.
- Mediabunny closes a `StreamTarget`'s stream when an output is cancelled, and closing a file stream
  commits it. `run.ts` wraps the stream so only a finished output closes it; anything else aborts.
- Mediabunny's MKV writer can't start before 0 either, so MP4's AAC priming (−21 ms) moves every track
  21 ms later when copied into MKV. The tracks stay in sync and the packets are untouched; the Node tests
  check that every track shifts by the same amount.
- Opus in WebM starts before 0 (pre-roll, −7 ms in the fixture) and Ogg can't, so copies use
  `shiftTolerance: Infinity`; Mediabunny keeps the tracks in sync when it shifts.
- AAC packets read from MPEG-TS keep their ADTS headers; MP4 stores the frames without them.
- Mediabunny mixes 5.1 down to stereo properly but has no rule for 7.1 (it keeps only the front pair,
  losing the centre's dialogue), so `run.ts` mixes 7.1 itself in `process`. Its WAV writer has no
  channel mask, so players infer 5.1 or 7.1 from the channel count.
- `copy: { mode: 'forced' }` can't be combined with `forceTranscode` on some tracks: Mediabunny 1.65
  discards those as `cannot_copy`. So a plan that re-encodes one kind runs in `'preferred'`, which may
  also transcode a track the plan copies. Nothing on the `Conversion` says which, but each of
  `output.tracks` (in `utilizedTracks` order) is fed by an `Encoded*PacketSource` only when copied;
  `transcodedCopies` in `run.ts` refuses the rest.
- A copied trim into MP4 keeps the in point and writes the keyframe lead-in at negative times behind
  an edit list. `run.ts` moves the start back to the keyframe itself, so the cut is where the UI says.
- `new Quality(n)` is a quality level from 0 to 1, not a bitrate; a bitrate is `new Quality({ bitrate })`.
- A quality level (`new Quality('medium')`) makes Mediabunny encode at a fixed quantizer where the codec
  allows, so the size follows the picture: a noisy 12 Mbps phone video at `'high'` came out 63% larger.
  Compress passes the level's bitrate (`presetBitrate`) instead, and a constant bitrate for a target size.
- An MP4 streamed to disk (`fastStart: 'reserve'`) carries a few hundred kB of reserved index space that
  one built in memory doesn't (about 0.4 MB on 90 s of 30 fps video with audio).
- Firefox's VP9 and AV1 encoders are slow (5–6 fps at 720p in release Firefox 159, against Chrome's
  200+) and overshoot the bitrate they're given (VP9 about 1.55×, AV1 1.65× on noisy video; a constant
  bitrate brings that to 1.2× and 1.5× at the same speed). Chrome's land on it. `latencyMode: 'realtime'`
  is faster (VP9 6×, AV1 1.4×) but overshoots 2.2–2.7×, and a Conversion can't set it anyway.
- Firefox on Windows has no HEVC in WebCodecs, encoding or decoding, even with `media.hevc.enabled`
  and `dom.media.webcodecs.h265.enabled` set and Microsoft's HEVC extension installed; `<video>` plays it.
- Edge on Windows decodes HEVC in WebCodecs but can't encode it: it ships Chromium's
  `PlatformHEVCEncoderSupport` off (Edge 157), where Chrome on the same machine has it on. Launching Edge
  with `--enable-features=PlatformHEVCEncoderSupport` turns it on. A playback test passing proves nothing
  about encoding.
- Chrome reports a media element's `currentTime` cut to the microsecond, so a seek to 1 / 30 reads back
  as 0.033333, a hair short of frame 1. `stepFrames` allows a millisecond for this.
- Headed Firefox decodes on the GPU, and Mediabunny resizes each frame through a 2D canvas (twice past a
  2× downscale, for mipmapping): about 22 ms a frame at 720p and 40 ms at 480p, which made a downscaled
  Compress slower than Original there (76 s and 111 s against 42 s on 90 s of 1080p). So the worker
  registers `gpu-scaler.ts` as a Mediabunny transformer: one textured WebGL draw, about 5 ms, bringing
  those to 26 s and 17 s; Chrome's times don't change (within half a second). It takes plain resizes of
  the whole frame and returns `null` for anything else, and Mediabunny's canvas is the fallback where
  WebGL 2 is missing. Headless Firefox decodes in software, which hides most of the cost.
- GIF delays are hundredths of a second, which 15 fps doesn't divide; `gif.ts` ends each frame where
  its own time rounds to (7, 6, 7…), so a second of frames lasts a second. Animated WebP does the same
  in milliseconds (67, 66, 67).
- A canvas asked for a type it can't write (WebP in some browsers) quietly writes a PNG, so check the
  blob's `type`. Chrome won't encode an `OffscreenCanvas` that has no context at all; Firefox will.
  Both write lossless WebP at quality 1, and Chrome adds an ICC profile chunk to its stills.
- The desktop app's built-in browser denies `clipboard-write` outright (even text), so Grab frame's Copy
  can't be checked there; check it through Playwright (Chrome or Firefox), with a real click.
- Mediabunny 1.65 misreads a bare FLAC file's duration and packet stats when both are computed at
  once, so `probe` reads the length before the tracks.
- Firefox makes a `<video>` without controls a tab stop with nothing to announce, so the player's has
  `tabIndex={-1}`; the transport is the keyboard way in.
- The encoder add-ons inline their WebAssembly in their JS chunks and start it in a blob worker, so
  there's no `.wasm` file to precache: precaching the chunks is enough. Chrome lacks MP3 and FLAC
  encoders, Firefox all three; both run every add-on offline from the precache.

## Hosting facts that bite

- Workers Builds deploys `main` with `npx wrangler deploy`, using `wrangler.jsonc` (assets only, no
  Worker script; unknown paths get `index.html`). pnpm 11 refuses dependency install scripts it
  hasn't been told about, so `workerd` is allowed in `pnpm-workspace.yaml`; a new dependency with an
  install script needs the same.
- Static assets are capped at 25 MiB a file.
- `public/_headers` sets COOP `same-origin` and COEP `require-corp`. Nothing needs them yet, but a
  future ffmpeg.wasm fallback will (threads), and keeping them now stops a cross-origin resource
  from sneaking in. Everything is same-origin; a cross-origin resource (fonts, analytics, a CDN)
  will break unless it sends CORP headers.
- WebCodecs needs a secure context: localhost or HTTPS.
- The theme choice is a `theme` cookie on `Domain=hyphensam.com`, shared with the sister sites (Bytesize,
  Art Cleaner); on localhost it stays on the host. `index.html` applies it before the first paint, and its
  hex values and `THEME_COLOURS` in `src/lib/theme.ts` are the canvas colours of the theme-color metas.
- The app launcher (grid button) reads `https://apps.hyphensam.com/apps.json` when first opened, a
  separate static Worker (`../hyphensam-apps`) that every sister site reads, so a site is added there
  once. It must send CORS and `Cross-Origin-Resource-Policy: cross-origin`, or COEP blocks it.
  `FALLBACK_APPS` in `src/lib/apps.ts` is used until it arrives or if it can't; the service worker
  caches the list and icons (stale while revalidate), so the launcher works offline after one opening.
- The service worker precaches everything, the encoder add-ons included (about 2 MB of the 3.6 MB),
  so the whole app works offline after one visit. `scripts/precache.ts` fails the build if a built file
  is missing from `sw.js`'s list. vite-plugin-pwa adds the manifest's icons on its own as well as the
  glob's, so the config sets `includeManifestIcons: false`, or they're listed twice.

## Licences

The code is MIT OR Apache-2.0. Mediabunny and its encoder add-ons are MPL-2.0, used unmodified (if a
file of theirs is ever changed, that file stays MPL-2.0). The add-ons wrap LAME (LGPL; its authors ask
for a credit with a link), libFLAC (BSD-style) and FFmpeg's AAC encoder (LGPL). gifenc is MIT. Keep
the credits in About.
