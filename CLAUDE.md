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
  the service worker) are checked by hand in the browser after the unit tests pass. Check Chrome and
  Firefox at least. Say what you checked when you report.

## Commands

```bash
pnpm install
pnpm dev              # http://localhost:5173
pnpm test             # Vitest, once
pnpm test:watch
pnpm typecheck
pnpm build            # typecheck + build to dist/; fails if any file is over the 25 MiB asset limit
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
  `Plan` or problems out; `plan.ts` holds the `Plan` type), `discarded.ts` (Mediabunny's discarded
  tracks as sentences), `progress.ts` (percentage, time left, size change), `bitrate.ts` (target
  size and quality maths), `timecode.ts`, `names.ts`, `settings.ts`, `protocol.ts` (page ↔ worker),
  `format-bytes.ts`.
- `src/media/` Mediabunny wiring: `probe.ts`, `run.ts`, `formats.ts` (the output formats, and what
  each container holds as plain data for the planners), `frames.ts` (thumbnails, frame grabs and GIF
  frames), `encoders.ts` (registers the MP3, FLAC and AAC encoder add-ons when the browser lacks them).
- `src/worker/` the Web Worker: receives a `File` and a `Plan`, runs it with `src/media/`, posts
  progress, cancels on request.
- `src/components/` the UI (`ui/` holds the primitives). `src/App.tsx` puts it together; it takes the
  worker client as a prop so tests pass a fake. `src/main.tsx` creates the real worker.
- `src/hooks/` state: `useSource` (the open file and its info), `useJob` (the running job), `usePlayer`.
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
- Chrome and Firefox both play MKV natively now; MPEG-TS is what reaches the fallback preview.
- Browsers can't decode AC-3, E-AC-3, DTS or TrueHD. Copying them works; converting them doesn't,
  and the UI says so.
- Mediabunny closes a `StreamTarget`'s stream when an output is cancelled, and closing a file stream
  commits it. `run.ts` wraps the stream so only a finished output closes it; anything else aborts.
- Opus in WebM starts before 0 (pre-roll, −7 ms in the fixture) and Ogg can't, so copies use
  `shiftTolerance: Infinity`; Mediabunny keeps the tracks in sync when it shifts.
- AAC packets read from MPEG-TS keep their ADTS headers; MP4 stores the frames without them.
- Mediabunny mixes 5.1 down to stereo properly but has no rule for 7.1 (it keeps only the front pair,
  losing the centre's dialogue), so `run.ts` mixes 7.1 itself in `process`. Its WAV writer has no
  channel mask, so players infer 5.1 or 7.1 from the channel count.
- Mediabunny 1.65 misreads a bare FLAC file's duration and packet stats when both are computed at
  once, so `probe` reads the length before the tracks.

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
- The service worker precaches everything, the encoder add-ons included (a few hundred kB), so the
  whole app works offline once installed.

## Licences

The code is MIT OR Apache-2.0. Mediabunny and its encoder add-ons are MPL-2.0, used unmodified (if a
file of theirs is ever changed, that file stays MPL-2.0). The add-ons wrap LAME (LGPL; its authors ask
for a credit with a link), libFLAC (BSD-style) and FFmpeg's AAC encoder (LGPL). gifenc is MIT. Keep
the credits in About.
