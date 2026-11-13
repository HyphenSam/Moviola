# Moviola: specification

What the app does, tool by tool. CLAUDE.md says how it's built; PRODUCT.md and DESIGN.md say how it
looks and speaks. When this file and the code disagree, fix one of them in the same change.

## 1. Scope

**In:** one video (or audio file) open at a time; eight tools (section 6); results saved to disk
or downloaded; installable and offline.

**Out (for now):** batches; multi-clip editing, joining files, transitions; burning in subtitles;
uploads or any server work; AVI, FLV, WMV and other inputs Mediabunny can't read (a later,
optional ffmpeg.wasm fallback, loaded only when needed, may add them; leave room for it but
don't build it).

## 2. Platform

- Static site on Cloudflare Workers at `moviola.hyphensam.com`, set up exactly like Bytesize
  (`wrangler.jsonc`, `public/_headers`, Workers Builds on push to `main`).
- Targets current Chrome, Edge, Firefox and Safari on desktop, and Chrome and Safari on mobile.
  Features are switched on by capability (section 9), never by browser name.
- Needs WebCodecs. If `VideoDecoder` is missing, the empty stage says the browser is too old and
  names the minimum versions; nothing else is shown.

## 3. Opening a file

- Drag and drop onto the window, the "Choose file" button, or the installed app's file handler
  (`launchQueue`, manifest `file_handlers` for video and audio types).
- Accepted: MP4, M4V, MOV, MKV, WebM, TS/M2TS/MTS, and audio files MP3, M4A, WAV, FLAC, OGG/OPUS,
  AAC. The file input's `accept` lists these extensions; dropping anything else is still tried,
  because extensions lie.
- Opening runs `probe` in the worker: Mediabunny `Input` with a `BlobSource` and the formats
  `MediaInfo.container` lists (`ALL_FORMATS` less HLS, a playlist a single file can't be).
  If no format matches: "Moviola can't open this file. It reads MP4, MOV, MKV, WebM and MPEG-TS
  video." The previous file, if any, stays open.
- Opening a file while a job runs asks first: "Cancel the running job and open the new file?"
- Exports from the previous file stay in the exports strip until removed.
- The file is never read whole into memory. `File` objects are passed to the worker by
  structured clone (cheap; no bytes are copied).

## 4. MediaInfo

The plain data the planners and the UI work from (`src/lib/info.ts`). Sketch:

```ts
type MediaInfo = {
  name: string
  size: number // bytes
  container: 'mp4' | 'mov' | 'mkv' | 'webm' | 'mpegts' | 'mp3' | 'wav' | 'flac' | 'ogg' | 'adts'
  mimeType: string // with codecs, for canPlayType
  start: number // first timestamp ≥ 0 (MPEG-TS often starts near 1.4 s); the playhead's 0
  duration: number // seconds, from start to the end
  tags: Record<string, string> // title, artist, date, comment… as Mediabunny gives them
  tracks: Track[]
}
type Track = VideoTrack | AudioTrack | SubtitleTrack
type Common = {
  id: number // Mediabunny's track id, unique in the file
  codec: string | null // Mediabunny's codec name ('avc', 'aac', 'ac3', …); null if unknown
  codecString: string | null // full codec string ('avc1.64001f'), for the info view
  language: string | null
  name: string | null
  isDefault: boolean
  bitrate: number | null // bits per second, from computePacketStats
  canDecode: boolean
}
type VideoTrack = Common & {
  kind: 'video'
  width: number; height: number // display size, after pixel aspect ratio and rotation
  rotation: 0 | 90 | 180 | 270
  frameRate: number | null
  colour: { primaries?: string; transfer?: string; matrix?: string; fullRange?: boolean; hdr: boolean }
}
type AudioTrack = Common & { kind: 'audio'; sampleRate: number; channels: number }
type SubtitleTrack = Common & { kind: 'subtitle' }
```

Bitrate: `computePacketStats` with a bounded packet count (say 1,000) so probing a long file stays
quick; label it "about" in the UI. Probing must finish in well under a second for a 4 GB MP4 on
a normal machine.

## 5. The stage

### Player
- When `video.canPlayType` accepts the file's MIME type and codecs (or it simply starts playing),
  use a `<video>` element on an object URL of the `File`. Native playback gives sound and smooth
  seeking.
- Otherwise (MKV in Safari, HEVC without hardware support, and so on), show decoded frames with
  Mediabunny's `CanvasSink` at the playhead, no sound, and the chip "Preview without sound". Playing
  in this mode advances frames at real time as fast as decoding allows. If the video track can't be
  decoded at all, the stage shows the thumbnail strip's placeholder and "This browser can't show
  this video, but copying tools still work."
- Audio-only files show a waveform-free panel: the file name, duration and an `<audio>` player.

### Transport
Play/pause, position / duration timecode, frame back / forward, mute and volume. The volume
starts at half and is remembered across visits (`localStorage`; if storage is blocked it just
starts at half).

### Timeline
- A strip of thumbnails generated with `CanvasSink` (`frames.ts`) at evenly spaced timestamps, as
  many as fit the strip's width, made lazily after the file opens. Cache them per file.
- Click or drag to seek. Range tools (Trim, Make GIF) add in and out handles; the range is shared
  between those two tools so switching between them keeps it.
- Keyboard (when focus isn't in a text field): Space play/pause; ← → one second; Shift+← → five
  seconds; `,` `.` one frame; Home End start and end; `I` and `O` set in and out at the playhead.

## 6. Tools

Every tool has: a settings view in the settings column, a planner in `src/lib/plans/`, a primary
action with a verb ("Extract", "Trim", …) and a Lossless or Re-encodes badge, and an output name
(section 8). Planners return problems instead of a plan when the job can't run; problems are
shown above the action, which is disabled.

Video-only tools (Remove audio, Compress, Grab frame, Make GIF, Change container) are dimmed for
audio-only files; Extract audio is dimmed for files with no audio track. The rail tooltip says why.

The default tool on opening a video is **Media info**; on opening an audio-only file, **Extract
audio** (shown as "Convert audio" in that case).

### 6.1 Media info

A read-only view of `MediaInfo` in the settings column, no primary action.

- **File**: name, size (bytes and human), container, duration, overall bitrate.
- **Tracks**: one group per track: kind and number, codec in plain words with the codec string
  below in caption ("H.264 High, avc1.640028"), then video size, frame rate, rotation, colour (SDR
  or HDR, with primaries/transfer when known), or sample rate and channels ("48 kHz, stereo"),
  bitrate (about), language, name, default flag, and "Can't decode in this browser" if so.
- **Tags**: any metadata tags, key and value.
- A secondary button "Copy as text" copies all of it as plain text, one `Key: value` per line, for
  pasting into a forum or bug report.
- Plain words for codec names live in one table in `info.ts` (H.264, HEVC, VP8, VP9, AV1, ProRes,
  AAC, Opus, Vorbis, MP3, FLAC, AC-3, E-AC-3, DTS, TrueHD, PCM 16-bit, …).

### 6.2 Extract audio

Gets the audio out of a video, losslessly by default.

- **Track**: if there's more than one audio track, a list (language, name, codec, channels; the
  default track selected). One track per export.
- **Format** (segmented): "Original" (default), "MP3", "WAV", "FLAC".
- **Original**: copy the track (`copy: { mode: 'forced' }`, video and other tracks discarded) into
  the container that fits its codec, chosen by `losslessAudioContainer(codec)` in `containers.ts`:

  | Codec | Container | Extension |
  |---|---|---|
  | AAC | MP4 (audio only) | `.m4a` |
  | Opus | Ogg | `.opus` |
  | Vorbis | Ogg | `.ogg` |
  | MP3 | MP3 | `.mp3` |
  | FLAC | FLAC | `.flac` |
  | PCM that WAV holds, μ-law, A-law | WAV | `.wav` |
  | AC-3, E-AC-3, DTS, TrueHD, and anything else | Matroska audio | `.mka` |

  If Matroska can't hold it either (check `getSupportedCodecs()`), try MOV (`.mov`). Tests cover
  every row. The settings view shows a caption such as "AAC, copied as is into .m4a. No quality is
  lost." Badge: Lossless.
- **MP3**: bitrate segmented 128 / 192 / 256 / 320 kbps (default 192), CBR. Uses the browser's
  encoder if `canEncodeAudio('mp3')`, else registers `@mediabunny/mp3-encoder`. Badge: Re-encodes.
  If the source is already MP3, a hint says "Already MP3: Original keeps it without loss."
- **WAV**: 16-bit (default) or 24-bit PCM, source sample rate and channels. Badge: "Lossless" when
  the source is PCM or FLAC (or another lossless codec), otherwise "Decodes to WAV", with the caption
  "WAV is uncompressed, but it can't restore what the original codec already lost." (Use the
  Re-encodes badge style.)
- **FLAC**: compression level isn't exposed. Same badge rule and caption as WAV.
  Uses `@mediabunny/flac-encoder` unless the browser can encode FLAC.
- Converting needs the track to be decodable. If it isn't (AC-3, DTS, TrueHD everywhere): MP3, WAV
  and FLAC are disabled with "This browser can't decode AC-3. Original still works."
- Output name: `<stem>.<ext>`, plus ` (track 2)` when the file has more than one audio track and
  the chosen one isn't the first.

### 6.3 Trim

Cuts out a range.

- **Range**: in and out timecode fields (default the whole file), each with "Set to playhead", plus
  the timeline handles and `I`/`O`. Shows the resulting length.
- **Mode** (segmented): "Fast" (default) and "Precise".
- **Fast**: copy everything (`copy: { mode: 'forced', boundaryPolicy: 'expand' }`). The video can
  only start on a keyframe, so the start moves back to the keyframe at or before the in point. The
  planner gets that keyframe's time (from `EncodedPacketSink.getKeyPacket`, looked up in the worker
  when the in point changes, debounced) and the view says, when it differs by more than a frame:
  "Starts at 0:12.000, the nearest keyframe, 0.48 s before your in point." The timeline shows the
  real cut as a dashed marker. Badge: Lossless.
- **Precise**: re-encodes the video (`copy: false` for video) so the cut lands on the exact frame;
  audio is copied. The encoder is the source codec if the browser can encode it, else H.264; the
  bitrate matches the source video's measured bitrate so quality stays close. If the browser can't
  encode any usable codec, Precise is disabled with the reason. Badge: Re-encodes, caption "Video
  re-encoded, audio copied."
- Output container: the source's, when Mediabunny can write it; MPEG-TS stays MPEG-TS; otherwise
  MKV. Precise trim with a fallback codec that the source container can't hold uses MP4.
- Works for audio-only files too (Fast is always exact enough for audio; hide the mode control).
- Output name: `<stem> (trimmed).<ext>`.
- Problems: out not after in; range shorter than one frame.

### 6.4 Change container

Rewraps the streams in another container without touching them.

- **Container** (segmented): MP4, MOV, MKV, WebM. The source's own container is shown but disabled
  ("Already MKV").
- **Tracks**: every track with a checkbox (codec, language, name). Tracks the chosen container can
  hold are ticked; tracks it can't hold are unticked, disabled and say why ("WebM can't hold H.264").
- If no video track survives, problem: "WebM can't hold this video's H.264. Use Compress to convert
  it to VP9 or AV1." (worded from the actual codecs).
- `copy: { mode: 'forced' }`. Badge: Lossless.
- Subtitle tracks other than WebVTT can't be read by Mediabunny; if the info shows none but the user
  expects some, that's why. Note it once under the track list when the source is MKV: "Subtitles
  other than WebVTT aren't carried over."
- Metadata tags are copied.
- Output name: `<stem>.<ext>`.

### 6.5 Remove audio

Copies the video without its sound.

- If there's one audio track: no settings, just the explanation "Copies the video without its
  audio. Nothing is re-encoded."
- If there are several: a list of audio tracks with "Keep" checkboxes, all unticked (so the default
  removes all audio; ticking keeps a language, for example).
- Subtitles are kept. Container: the source's (fallbacks as Trim). `copy: { mode: 'forced' }`.
  Badge: Lossless.
- Output name: `<stem> (no audio).<ext>`, or `<stem> (edited).<ext>` when some audio was kept.

### 6.6 Compress

Re-encodes to make the file smaller, optionally resized.

- **Aim** (segmented): "Quality" (default) or "Target size".
  - **Quality**: "Smaller", "Balanced" (default), "High", mapped to Mediabunny's `QUALITY_LOW`,
    `QUALITY_MEDIUM`, `QUALITY_HIGH` for video. If the source's video bitrate is lower than what the
    preset would use, the preset is capped at the source bitrate and a hint warns "This video is
    already compact; the result may not be much smaller."
  - **Target size**: a number field in MB (decimal: 1 MB = 1,000,000 bytes), default half the source
    rounded to a whole MB, with quick picks 8 / 10 / 25 / 50 MB. Maths in `bitrate.ts`:
    `videoBitrate = (target × 8 × 0.98 − audioBits) / duration`, where 0.98 leaves room for the
    container and `audioBits` is the audio's bitrate × duration (measured when copied, set when
    encoded). Problem if the video bitrate comes out under 0.02 bits per pixel per frame at the
    chosen size: "8 MB is too small for 4 minutes at 1080p. Try 480p or a larger size." The result
    is single pass, so it can miss; after the job, if the file is over the target by more than 5%,
    the export says so in danger text.
- **Resolution** (segmented): Original, 1080p, 720p, 480p. The number is the shorter side (so it
  works for portrait video), never scales up (options above the source are disabled), keeps the
  aspect ratio, rounds down to even numbers.
- **Frame rate** (segmented): Original, 30, 24. Never raises it. Hidden behind "More options".
- **Codec** (segmented, under "More options"): H.264 (default; MP4), HEVC (MP4, `hvc1`), VP9
  (WebM), AV1 (MP4). Each is enabled only if `canEncodeVideo` says yes at the chosen size; otherwise
  disabled with "Not available in this browser". H.264's caption: "Plays everywhere."
- **Audio** (segmented): "Keep" (default), "Smaller", "Remove". Keep copies the audio when the output
  container holds its codec, otherwise encodes it at 128 kbps (AAC in MP4, Opus in WebM). Smaller
  encodes at 96 kbps. The AAC add-on is registered if the browser can't encode AAC.
- `hardwareAcceleration: 'no-preference'`. Badge: Re-encodes, with a caption saying what is copied.
- Output name: `<stem> (compressed).<ext>`.
- The export shows the size change. If the result is larger than the source, it says so plainly
  ("4% larger than the original") and suggests a lower quality.

### 6.7 Grab frame

Saves the frame at the playhead as an image.

- **Format** (segmented): PNG (default) or JPEG (quality 90).
- **Size**: the video's full display size, rotation applied (`CanvasSink` with the track's rotation).
- The frame is the one shown at the playhead. The settings view shows the playhead's timecode and
  "Set to playhead" is implied; frame-step buttons sit beside it for convenience.
- Copies to the clipboard as well, with a secondary "Copy" button (PNG only; `ClipboardItem`).
- HDR video is tone-mapped by the browser's decoder; say "HDR frames are converted to SDR" in a
  caption when the track is HDR.
- Badge: none for images (it isn't a copy of the stream); the action is "Save frame".
- Output name: `<stem> frame 0-01-23.456.png` (colons aren't allowed in Windows file names).

### 6.8 Make GIF

Turns a short range into an animated GIF.

- **Range**: as Trim (shared range), default the first 5 seconds, or the trim range if set. A hint
  appears past 15 seconds ("Long GIFs get large; consider a video instead."); past 60 seconds the
  action is disabled.
- **Width** (segmented): 320, 480 (default), 640 px, never above the source; height follows.
- **Frame rate** (segmented): 10, 15 (default), 20 fps.
- **Loop** switch, on by default.
- Frames come from `CanvasSink` at the chosen size and rate; encoding uses gifenc (`quantize` per
  frame to 256 colours, `applyPalette`, `writeFrame`) in the worker. Progress counts frames.
- Badge: Re-encodes. Caption: "GIFs are limited to 256 colours."
- Output name: `<stem>.gif`.

## 7. Running a job

### Worker protocol (`src/lib/protocol.ts`)
Like Bytesize's: a promise-based client on the page, a dispatcher in the worker.

```ts
type Request =
  | { type: 'probe'; id: number; file: File }
  | { type: 'keyframe'; id: number; file: File; trackId: number; time: number }
  | { type: 'thumbnails'; id: number; file: File; times: number[]; height: number }
  | { type: 'run'; id: number; file: File; plan: Plan; target: TargetSpec }
  | { type: 'cancel'; id: number }
type Reply =
  | { type: 'progress'; id: number; fraction: number | null } // null = indeterminate
  | { type: 'done'; id: number; value: unknown } // MediaInfo, number, ImageBitmap[], RunResult
  | { type: 'failed'; id: number; message: string }
```

One job runs at a time. Probing, keyframe lookups and thumbnails may run alongside a job (they're
cheap) but never block the UI.

### Where results go
- If `window.showSaveFilePicker` exists, the primary action first opens the save dialog (suggested
  name and type from the plan) inside the click, then sends the `FileSystemWritableFileStream` to
  the worker, which writes through Mediabunny's `StreamTarget` (`chunked: true`). The export shows
  "Saved" with the name. Cancelling the dialog cancels the job quietly.
- Otherwise the worker uses `BufferTarget` and returns the bytes as a `Blob` (transferred); the
  export has a Download button (an object URL, revoked when the export is removed). When the source
  is over 2 GB in this mode, a hint under the action warns that the result is held in memory until
  downloaded.
- Images (frame, GIF) always go through memory; they're small.

### Progress and cancel
- Mediabunny's `onProgress` gives the fraction. Time remaining is estimated from elapsed time and
  the fraction once past 3%; until then show only the percentage.
- Cancel: `conversion.cancel()`, then `writable.abort()` when streaming. The export isn't added.
- Errors become an export card in danger style with the message in plain words. Unknown errors keep
  Mediabunny's message after "Something went wrong:".

### Leaving the page
While a job runs, `beforeunload` asks the browser to confirm.

## 8. Naming (`src/lib/names.ts`)

- The stem is the source name without its last extension.
- Suffixes as listed per tool. Repeats in the exports strip are numbered `name (2).ext`, ignoring
  case, as Bytesize does.
- Characters invalid on Windows (`<>:"/\|?*`) never appear in generated parts; times use `-` for `:`.

## 9. Capabilities (`src/lib/capabilities.ts`)

Probed once at start-up in the worker and kept as plain data:

```ts
type Capabilities = {
  saveToDisk: boolean // showSaveFilePicker (checked on the page)
  encodeVideo: Partial<Record<'avc' | 'hevc' | 'vp9' | 'av1', boolean>> // at 1080p; re-checked at the chosen size before running
  encodeAudio: Partial<Record<'aac' | 'opus' | 'mp3' | 'flac', boolean>> // after add-ons, all true where wasm runs
}
```

Planners take `Capabilities` as an argument, so tests cover "Firefox without AAC" and "no HEVC"
without a browser. Decoding is per track (`MediaInfo.tracks[].canDecode`).

## 10. Copy and tone

Plain, short, British spelling. Say what happened and what to do next. No exclamation marks, no
"Oops". Name codecs in plain words (H.264, not avc1). Every problem a planner returns is a full
sentence naming the actual codec, container or number involved.

## 11. Fixtures (`fixtures/`, made by `scripts/fixtures.sh`)

Small (each under 300 kB, a few seconds long), generated with ffmpeg's `testsrc2` and `sine`
sources, committed. At least:

| File | Contents | Used for |
|---|---|---|
| `h264-aac.mp4` | H.264 + AAC, keyframe every 2 s | most tools, fast trim snapping |
| `h264-aac-2audio.mkv` | H.264 + two AAC tracks (eng, fra) | track lists, remove audio keeping one |
| `vp9-opus.webm` | VP9 + Opus | extract to .opus, container change to MP4 |
| `h264-ac3.mkv` | H.264 + AC-3 | extract to .mka, WebM refusal |
| `h264-mp3.mov` | H.264 + MP3 | extract to .mp3 (copied); Mediabunny 1.65 can't name MOV's `.mp3` entry yet |
| `h264-pcm.mov` | H.264 + PCM s16le | extract to .wav |
| `h264-flac.mkv` | H.264 + FLAC | extract to .flac |
| `h264-only.mp4` | H.264, no audio | Extract audio dimmed |
| `rotated.mp4` | H.264 with 90° rotation metadata | display size, frame grab |
| `h264-aac.ts` | `h264-aac.mp4` in MPEG-TS, starting near 1.4 s | non-zero start, the fallback preview |
| `aac.m4a` | AAC audio only | audio-only behaviour |
| `notvideo.txt` | text | the "can't open" message |

Node tests open these with `FilePathSource` (or a `BlobSource` over the file's bytes) and check
outputs by probing them again: codecs unchanged, durations right, packet data byte-identical to the
source's for copy jobs.

## 12. Later

- ffmpeg.wasm fallback for inputs Mediabunny can't read (AVI, FLV, WMV), loaded on demand from the
  same origin. COOP/COEP are already in place for its threads.
- Subtitle extraction to `.vtt`.
- Batches (the same tool over several files).
