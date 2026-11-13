# Moviola: build phases

Each phase is one Claude Code session. Paste the prompt, let it finish, check the result yourself
(the "You check" list), then run `/clear` before the next phase so each starts with a fresh
context. The docs carry everything a new session needs.

**Before phase 1:** create an empty GitHub repository `HyphenSam/moviola`, clone it, put
`CLAUDE.md`, `SPEC.md`, `PRODUCT.md`, `DESIGN.md` and this file in it, and start Claude Code there.
Have ffmpeg on your PATH (phase 1 uses it to make test files).

| Phase | What | Status |
|---|---|---|
| 1 | Scaffold, deploy, app shell | ☑ |
| 2 | Open a file, Media info, player | ☐ |
| 3 | Worker jobs, saving, Extract audio (lossless) | ☐ |
| 4 | Extract audio: MP3, WAV, FLAC | ☐ |
| 5 | Timeline and Trim | ☐ |
| 6 | Change container, Remove audio | ☐ |
| 7 | Compress | ☐ |
| 8 | Grab frame, Make GIF | ☐ |
| 9 | Polish, offline, accessibility, README | ☐ |

---

## Phase 1: Scaffold, deploy, app shell

```
Read CLAUDE.md, PRODUCT.md, DESIGN.md and SPEC.md. This is phase 1 of PHASES.md.

Moviola is a sister project of Bytesize. Clone https://github.com/HyphenSam/Bytesize into a
temporary folder outside this repo and use it as the reference for setup: copy and adapt its
package.json scripts, pnpm-workspace.yaml, .node-version, .prettierrc.json, .gitignore,
tsconfig.json, vite.config.ts (PWA, the 25 MiB asset check in scripts/, dev and preview headers),
wrangler.jsonc, public/_headers, .claude/launch.json, src/test-setup.ts, src/lib/cn.ts, the ui/
primitives, the update banner and the About dialog's structure. Use the latest versions of the
same dependencies. Drop the jSquash packages and fflate; add mediabunny. Copy LICENSE-MIT and
LICENSE-APACHE (update the copyright line's project name if it has one).

Then:
1. src/lib/brand.ts with APP_NAME 'Moviola', a one-line description, SOURCE_URL
   https://github.com/HyphenSam/Moviola. Manifest name, short name, description, en-GB,
   file_handlers for the video and audio types in SPEC.md section 3.
2. src/index.css with DESIGN.md's tokens for light and dark, including the dark stage and the
   amber accent with dark text on it. Write a small test that checks every text/background pair
   DESIGN.md names meets its contrast (4.5:1 text, 3:1 UI), converting OKLCH to sRGB in the test.
3. An icon: public/icon.svg, a simple original mark (a film reel or a playhead over a strip, in
   the accent on a dark rounded square), and the PNG sizes Bytesize has, rendered as its
   tools/README.md describes.
4. The app shell from DESIGN.md's Layout section: tool rail with all eight tools (icons from
   lucide, all disabled until a file is open), the settings column with the empty state, the dark
   stage with the "Drop a video here" drop target and "Choose file" button (no behaviour yet beyond
   accepting the file into state), and the mobile layout. About dialog crediting Mediabunny and
   the libraries listed in CLAUDE.md's Licences section.
5. scripts/fixtures.sh and `pnpm fixtures`: generate every file in SPEC.md section 11 with ffmpeg
   and commit them. Check each stays under 300 kB.
6. A WebCodecs check: if VideoDecoder is missing, the stage says the browser is too old.

Follow the TDD rules in CLAUDE.md for every behaviour (rail renders eight tools, drop target
accepts a file, the WebCodecs message). Run pnpm test, pnpm typecheck and pnpm build. Start the
dev server and check the shell in the browser in light and dark, desktop and narrow widths. Then
tick phase 1 in PHASES.md and commit.
```

**You check:** `pnpm dev` shows the shell in both themes. Then deploy: in Cloudflare, create a
Worker from the repository with build command `pnpm build`, deploy command `npx wrangler deploy`,
and add the custom domain `moviola.hyphensam.com`. Push, and confirm the site loads there.

---

## Phase 2: Open a file, Media info, player

```
Read CLAUDE.md, SPEC.md, DESIGN.md. This is phase 2 of PHASES.md; phase 1 is done.

Build:
1. src/lib/info.ts: the MediaInfo type (SPEC.md section 4), the plain-word codec names table and
   helpers (display size, HDR from the transfer characteristic, "48 kHz, stereo" and so on).
2. src/media/probe.ts: Mediabunny Input → MediaInfo. Test it in Node against every fixture: codecs,
   sizes, rotation, durations, languages, track counts; notvideo.txt gives the "can't open" error.
3. src/lib/protocol.ts and src/worker/ with the probe request only (SPEC.md section 7), a fake
   for tests in src/lib/testing.ts, and src/hooks/useSource.ts. App takes the client as a prop.
4. Opening a file: drop, Choose file, launchQueue. Errors as SPEC.md section 3. The file card.
   Tools enable and dim per SPEC.md section 6's rules; Media info opens by default.
5. The Media info tool (SPEC.md 6.2) with "Copy as text".
6. The player (SPEC.md section 5): native <video> when it plays, otherwise CanvasSink frames with
   the "Preview without sound" chip; the audio-only panel; the transport bar; keyboard shortcuts
   that don't need the timeline. The timeline comes in phase 5.

TDD throughout: planners and helpers in Node, components with Testing Library. Then check by hand
in Chrome and Firefox with the fixtures and with a real phone video and a large (1 GB+) file if
you have one: opening is quick, info is right, playback works, the fallback preview works for an
MKV in a browser that won't play it natively. Report what you checked. Tick phase 2 and commit.
```

**You check:** open a few of your own videos and compare the Media info with
`ffprobe -hide_banner <file>`.

---

## Phase 3: Worker jobs, saving, Extract audio (lossless)

```
Read CLAUDE.md, SPEC.md, DESIGN.md. This is phase 3 of PHASES.md; phases 1–2 are done.

Build the job machinery and the first real tool:
1. The Plan type and src/media/run.ts: Plan → Mediabunny Conversion with copy mode, discarded
   tracks turned into sentences, isValid checked, progress, cancel. Output to StreamTarget or
   BufferTarget per SPEC.md section 7, fastStart per CLAUDE.md.
2. The run, cancel and progress messages in the protocol and worker; src/hooks/useJob.ts.
3. Saving: showSaveFilePicker inside the click where available, streaming to disk; memory and a
   Download button otherwise. Cancelling the picker cancels quietly. beforeunload while running.
4. The progress component, the Lossless/Re-encodes badge, and the exports strip (DESIGN.md).
5. src/lib/containers.ts with losslessAudioContainer (SPEC.md 6.1's table, every row tested),
   src/lib/names.ts (SPEC.md section 8), and src/lib/plans/extract-audio.ts for the Original format
   only, with the track picker.
6. End-to-end Node tests: extract from each fixture and check the output's container, extension and
   codec, and that its audio packets are byte-identical to the source's.

TDD throughout. Then by hand in Chrome (save to disk) and Firefox (download): extract from the
fixtures and from a real video; open the results in a desktop player; cancel midway on a large
file and confirm no partial file is left. Report what you checked. Tick phase 3 and commit.
```

**You check:** extract the audio from the video that started this, then compare with
`ffprobe` that the codec, bitrate and sample rate match the original's audio stream.

---

## Phase 4: Extract audio: MP3, WAV, FLAC

```
Read CLAUDE.md, SPEC.md. This is phase 4 of PHASES.md; phases 1–3 are done.

1. src/lib/capabilities.ts and its probe in the worker (SPEC.md section 9), passed to planners.
2. src/media/encoders.ts: register @mediabunny/mp3-encoder, @mediabunny/flac-encoder and
   @mediabunny/aac-encoder only when the browser can't encode the codec, loaded lazily so they
   aren't in the first download.
3. Extend the extract-audio planner and view with MP3, WAV and FLAC exactly as SPEC.md 6.1
   describes: options, badges and captions, the undecodable-codec rule (test with the AC-3
   fixture's info), the "Already MP3" hint, and the audio-only "Convert audio" naming.
4. Add the encoders' credits to About.

TDD for the planner and view (use Capabilities fakes for "no MP3 encoder" and similar). Encoding
needs WebCodecs, so check by hand in Chrome and Firefox: each format from each fixture plays, MP3
at each bitrate has the right bitrate, WAV at 16 and 24 bits, FLAC decodes. Report what you
checked. Tick phase 4 and commit.
```

---

## Phase 5: Timeline and Trim

```
Read CLAUDE.md, SPEC.md, DESIGN.md. This is phase 5 of PHASES.md; phases 1–4 are done.

1. src/lib/timecode.ts: parse and format per DESIGN.md's timecode field (90, 1:30, 1:30.5,
   0:01:30.500), frame stepping from the frame rate. Many small tests.
2. src/media/frames.ts thumbnails and the thumbnails request; the timeline component (DESIGN.md):
   seek by click and drag, range handles as accessible sliders, dimmed outside, the dashed
   keyframe marker; the remaining keyboard shortcuts (I, O, `,` `.`). The range lives in shared
   state so Make GIF can reuse it later.
3. The keyframe request in the worker (EncodedPacketSink.getKeyPacket), debounced from the page.
4. src/lib/plans/trim.ts and the Trim view (SPEC.md 6.3): Fast and Precise, the keyframe sentence,
   container fallbacks, audio-only behaviour, problems.
5. Node tests: fast trim of h264-aac.mp4 from 3.0 s starts at the 2.0 s keyframe, keeps every
   packet from there to the out point byte for byte, and has the expected duration.

TDD throughout. By hand in Chrome and Firefox: trim fixtures and a real video both ways; check the
fast trim's start matches what the UI promised; check the precise trim starts on the exact frame
(grab the first frame in a desktop player). Report what you checked. Tick phase 5 and commit.
```

---

## Phase 6: Change container, Remove audio

```
Read CLAUDE.md, SPEC.md. This is phase 6 of PHASES.md; phases 1–5 are done.

1. src/lib/plans/change-container.ts and its view (SPEC.md 6.4): container choice, the track list
   with reasons from getSupportedCodecs, the WebM-can't-hold problems worded from the real codecs,
   the MKV subtitle note, tags copied.
2. src/lib/plans/remove-audio.ts and its view (SPEC.md 6.5): single and multiple audio tracks,
   naming.
3. Node tests for both: vp9-opus.webm → MP4; h264-aac.mp4 → MKV and back; h264-ac3.mkv → WebM gives
   the problem; h264-aac-2audio.mkv keeping only the French track; every kept packet byte-identical.

TDD throughout. By hand: open the outputs in Chrome, Firefox and a desktop player. Report what you
checked. Tick phase 6 and commit.
```

---

## Phase 7: Compress

```
Read CLAUDE.md, SPEC.md, DESIGN.md. This is phase 7 of PHASES.md; phases 1–6 are done.

1. src/lib/bitrate.ts: target-size maths, the bits-per-pixel floor, resolution choice from the
   shorter side with even rounding and no upscaling, frame-rate capping. Exhaustive tests,
   including portrait and rotated sources.
2. src/lib/plans/compress.ts and its view (SPEC.md 6.6): Quality and Target size, resolution,
   "More options" (frame rate, codec), audio keep/smaller/remove, capability-driven codec options
   re-checked at the chosen size, every problem and hint, the caption of what's copied.
3. After a target-size job, the export flags results more than 5% over the target, and any result
   larger than the source.

TDD for the maths and planner; Capabilities fakes for missing encoders. Encoding needs a browser,
so check by hand in Chrome and Firefox with a real 1080p phone video: each preset, 720p and 480p,
a 10 MB target (report how close it landed), each codec the browser offers, audio options, and
cancelling a long job. Report timings and what you checked. Tick phase 7 and commit.
```

**You check:** play the compressed results on your phone, and post one to whatever chat app
you'd normally use, to confirm it's accepted and plays inline.

---

## Phase 8: Grab frame, Make GIF

```
Read CLAUDE.md, SPEC.md. This is phase 8 of PHASES.md; phases 1–7 are done.

1. Grab frame (SPEC.md 6.7): full-size frame at the playhead with rotation applied, PNG or JPEG,
   Copy to clipboard, the HDR caption, naming with the timecode.
2. Make GIF (SPEC.md 6.8): add gifenc; frames from CanvasSink at the chosen width and rate,
   quantised and written in the worker with per-frame progress; shared range with Trim; the length
   hint and limit; loop switch. Credit gifenc in About.
3. Planners and naming tested in Node; the GIF writer tested in Node with synthetic frames (decode
   the result's header and frame count).

By hand in Chrome and Firefox: frames from the rotated fixture come out upright and full size;
GIFs at each width and rate play and loop in the browser. Report what you checked. Tick phase 8 and
commit.
```

---

## Phase 9: Polish, offline, accessibility, README

```
Read CLAUDE.md, SPEC.md, PRODUCT.md, DESIGN.md. This is phase 9 of PHASES.md; phases 1–8 are done.

1. PWA: precache everything including the encoder add-ons and their wasm; confirm the app works
   offline after one visit; the update banner; file_handlers launching straight into the file.
2. Accessibility pass against PRODUCT.md: keyboard through every tool, the timeline and exports;
   visible focus in both themes; labels and live regions for progress and errors; reduced motion.
3. Mobile pass at 375 px: layout from DESIGN.md, primary action fixed at the bottom, tool chips.
4. Copy pass against SPEC.md section 10: every message a full sentence naming the real codec or
   number, British spelling.
5. README.md in the style of Bytesize's: what it does tool by tool, the lossless promise, browser
   notes, licence and credits, development and deploying.
6. Re-read SPEC.md against the app and fix any drift, in the code or the spec.

Test what can be tested; check the rest by hand in Chrome, Firefox and, through the deployed site,
Safari on an iPhone if one is available. Report what you checked. Tick phase 9 and commit.
```

**You check:** install the app from the deployed site on Windows and Linux, open a video with
it from the file manager, and try each tool once more.
