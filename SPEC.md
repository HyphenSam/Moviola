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

- Drag and drop onto the window, pasting a file anywhere on the page, the "Choose file" button, or the
  installed app's file handler (`launchQueue`, manifest `file_handlers` for video and audio types).
- Accepted: MP4, M4V, MOV, MKV, WebM, TS/M2TS/MTS, and audio files MP3, M4A, WAV, FLAC, OGG/OPUS,
  AAC. The file input's `accept` lists these extensions; dropping anything else is still tried,
  because extensions lie.
- Opening runs `probe` in the worker: Mediabunny `Input` with a `BlobSource` and the formats
  `MediaInfo.container` lists (`ALL_FORMATS` less HLS, a playlist a single file can't be).
  If no format matches: "Moviola can't open this file. It reads MP4, MOV, MKV, WebM and MPEG-TS
  video." The previous file, if any, stays open.
- Opening a file while a job runs asks first: "Cancel the running job and open the new file?" A job
  whose save dialog is still open counts as running; one that is already being cancelled doesn't ask
  again.
- Starting a job drops a file that is still opening (its "Opening…" line goes and the open file
  stays), so the source can't change under the job. The last thing asked for wins, as it does between
  two opens.
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
  reordered: boolean // frames stored out of display order (B-frames), from the first packets
  colour: { primaries?: string; transfer?: string; matrix?: string; fullRange?: boolean; hdr: boolean }
}
type AudioTrack = Common & {
  kind: 'audio'
  sampleRate: number
  channels: number
  bitDepth: number | null // PCM (from the codec) and FLAC (from STREAMINFO); null for lossy codecs
}
type SubtitleTrack = Common & { kind: 'subtitle' }
```

Bitrate: `computePacketStats` with a bounded packet count (say 1,000) so probing a long file stays
quick; label it "about" in the UI. Probing must finish in well under a second for a 4 GB MP4 on
a normal machine.

## 5. The stage

### Player
- When `video.canPlayType` accepts the file's MIME type and codecs (or it simply starts playing),
  use a `<video>` element on an object URL of the `File`. Native playback gives sound and smooth
  seeking. The element's clock isn't always the playhead's (Chrome counts a late-starting file from
  its timestamps, Firefox from its first one), so its position once the first frame is in is taken
  as the playhead's 0, and times are translated both ways. Its length is the probed one: reported
  times stay within 0 to `duration`, playing stops there, and an element that disagrees by more
  than a frame is logged once. Where the video is Matroska with frames stored out of display order
  (B-frames), which Firefox seeks up to 4 frames short, the paused picture is the frame decoded at
  the playhead with `CanvasSink`, drawn over the video; playing shows the video.
- Otherwise (MKV in Safari, HEVC without hardware support, a picture that starts well after the
  element's 0 as in Firefox's late-starting MP4, and so on), show decoded frames with
  Mediabunny's `CanvasSink` at the playhead, no sound, and the chip "Preview without sound". Playing
  in this mode advances frames at real time as fast as decoding allows. If the video track can't be
  decoded at all, the stage shows the thumbnail strip's placeholder and "This browser can't show
  this video, but copying tools still work."
- Audio-only files show a waveform-free panel: the file name, duration and an `<audio>` player.

### Transport
Play/pause, position / duration timecode, frame back / forward, mute and volume. The volume
starts at half, unmuted. Volume and mute are remembered across visits (`localStorage`; if
storage is blocked they just start at their defaults).

### Timeline
- A strip of thumbnails generated with `CanvasSink` (`frames.ts`) at evenly spaced timestamps, as
  many as fit the strip's width, made lazily after the file opens. Cache them per file.
- Click or drag to seek. Range tools (Trim, Make animation) add in and out handles; the range is shared
  between those two tools so switching between them keeps it.
- Keyboard (when focus isn't in a text field): Space play/pause; ← → one second; Shift+← → five
  seconds; `,` `.` one frame; Home End start and end; `I` and `O` set in and out at the playhead.

## 6. Tools

Every tool has: a settings view in the settings column, a planner in `src/lib/plans/`, a primary
action with a verb ("Extract", "Trim", …) and a Lossless or Re-encodes badge, and an output name
(section 8). Planners return problems instead of a plan when the job can't run; problems are
shown above the action, which is disabled.

Video-only tools (Remove audio, Compress, Grab frame, Make animation, Change container) are dimmed for
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
- **Size changes**: VP8, VP9 and AV1 can change frame size mid-stream while the container names only
  the first size (clips made to shrink once shared). Once a file opens, the worker reads the header of
  every keyframe of the first video track (`frame-size.ts`) and Media info's size says "960 × 720,
  changes as it plays", with the smallest and largest sizes and the number of changes in caption.
  Until it answers, the caption says "Checking for size changes…". Opening another file cancels it.
  A change between keyframes, and H.264 or HEVC changing size, go unseen.
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
  encoder if `canEncodeAudio('mp3')`, else registers `@mediabunny/mp3-encoder`. Badge: Re-encodes,
  caption "AAC re-encoded to MP3 at 192 kbps." More than two channels are mixed down to stereo (the
  centre and surrounds at √½ into their side, the LFE left out), and the caption adds ", mixed down
  to stereo". MP3
  reaches 320 kbps only at 32, 44.1 and 48 kHz (lower rates top out at 160 kbps, higher ones it can't
  hold), so other rates are resampled to 44.1 kHz (multiples of 11.025 kHz) or 48 kHz, and the
  caption adds ", resampled to 48 kHz". If the source is already MP3, a hint says "Already MP3:
  Original keeps it without loss."
- **WAV**: 16-bit (default) or 24-bit PCM, source sample rate and channels. Badge: "Lossless" only
  when every sample survives: the source is PCM or FLAC with integer samples no deeper than the
  chosen depth ("FLAC, decoded to 24-bit WAV. No quality is lost."). Otherwise "Decodes to WAV" (in
  the Re-encodes badge style), with the caption "WAV is uncompressed, but it can't restore what the
  original codec already lost." for a lossy source, or, for a lossless one that doesn't fit, "24-bit
  FLAC is rounded to 16 bits. Choose 24-bit to keep every sample." (float PCM: "PCM 32-bit float is
  rounded to 24 bits.").
- **A lossless source whose depth can't be read** (a FLAC whose decoder description is missing or
  shorter than STREAMINFO) may be deeper than 16 bits, so it's never called lossless. WAV keeps the
  chosen depth; FLAC is written at 24 bits. Badge "Decodes to WAV" / "Decodes to FLAC", caption
  "Moviola can't read this FLAC's bit depth, so it may be rounded to 16 bits. Choose 24-bit to be
  safe." at 16 bits, or "…so it's written at 24 bits to be safe." at 24.
- **WAV stops at 4 GiB** (RIFF's sizes are 32-bit; Mediabunny's writer throws there). The size is
  known before the job (`wavBytes` in `wav.ts`: duration × sample rate × channels × bytes a sample,
  plus the 44-byte header), so a WAV that would reach 2^32 bytes is refused, as WAV and as an
  Original copy of PCM into `.wav`: "This would be a 5.2 GB WAV, and WAV files stop at 4 GB. Choose
  FLAC, which is lossless and smaller." (float PCM: "…Choose FLAC, which is smaller.", since FLAC
  rounds it to 24 bits). 5.1 at 48 kHz reaches it after 83 minutes at 24 bits, 124 at 16. RF64
  (`large: true`) isn't used: not every player opens it.
- **FLAC**: compression level isn't exposed. The depth follows the source: 24 bits for lossless
  sources deeper than 16 bits (or float), 16 otherwise, lossy sources included. Same badge rule as WAV
  ("Decodes to FLAC"): "PCM 16-bit, compressed into 16-bit FLAC. No quality is lost.", "FLAC is
  lossless, but it can't restore what the original codec already lost.", or "PCM 32-bit float is
  rounded to 24 bits." Uses `@mediabunny/flac-encoder` unless the browser can encode FLAC.
- The integer samples for FLAC are made in `run.ts` from a float copy, not by the browser's
  `AudioData.copyTo`: Chrome's s32 to s16 and Firefox's float to s32 conversions both land a step off,
  which would break the Lossless promise. Checked sample for sample in both browsers.
- Without an encoder (no WebAssembly), MP3 and FLAC are disabled with "This browser can't encode
  MP3." WAV needs none: Mediabunny writes PCM itself.
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
  real cut as a dashed marker. `run.ts` moves the trim's start back to that same keyframe (verified
  from the bitstream) before converting, so every track starts there in every container; left to
  Mediabunny, MP4 would keep the in point and hide the lead-in behind an edit list. Badge: Lossless.
- **Precise**: re-encodes the video (`copy: false` for video) so the cut lands on the exact frame;
  audio is copied. The encoder is the source codec if the browser can encode it, else H.264; the
  bitrate matches the source video's measured bitrate so quality stays close. If the browser can't
  encode any usable codec, Precise is disabled with the reason. Badge: Re-encodes, caption "Video
  re-encoded, audio copied."
- Output container: the source's, when Mediabunny can write it; MPEG-TS stays MPEG-TS; otherwise
  MKV. Precise trim with a fallback codec that the source container can't hold uses MP4.
- Works for audio-only files too (Fast is always exact enough for audio; hide the mode control).
  Copies cut between packets, so the result can run a packet over at each end (96 ms for FLAC, more
  for PCM in WAV) plus the codec's pre-roll.
- A track whose codec Mediabunny can't name is left out, with a hint saying so.
- Output name: `<stem> (trimmed).<ext>`.
- Problems: out not after in; range shorter than one frame.

### 6.4 Change container

Rewraps the streams in another container without touching them.

- **Container** (segmented): MP4, MOV, MKV, WebM. The source's own container is shown but disabled
  ("Already MKV."). The default is MP4, or MKV for an MP4 source; the choice carries over to the next
  file.
- **Tracks**: every track with a checkbox (codec, language, name). Tracks the chosen container can
  hold are ticked; tracks it can't hold are unticked, disabled and say why ("WebM can't hold H.264.",
  or "Moviola can't tell which codec this track uses." when Mediabunny can't name it).
- Unticking a track the container holds leaves it out. Unticking the video on purpose writes the audio on
  its own (`.m4a` from MP4); unticking everything is a problem ("Tick at least one track to keep.").
- If no video track survives, problem: "WebM can't hold this video's H.264. Use Compress to convert
  it to VP9 or AV1." (worded from the actual codecs).
- `copy: { mode: 'forced' }`. Action "Rewrap". Badge: Lossless.
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
  Action "Remove audio". Badge: Lossless. Ticking every audio track is a problem: "Every audio track is
  ticked, so nothing would be removed."
- Output name: `<stem> (no audio).<ext>`, or `<stem> (edited).<ext>` when some audio was kept.

### 6.6 Compress

Re-encodes to make the file smaller, optionally resized.

- **Aim** (segmented): "Quality" (default) or "Target size".
  - **Quality**: "Smaller", "Balanced" (default), "High": the bitrates Mediabunny gives its `low`,
    `medium` and `high` quality levels for the codec at the output size (`presetBitrate` repeats
    Mediabunny's private sum; a Node test checks they agree). They're passed as bitrates, not as
    quality levels: a quality level makes Mediabunny encode at a fixed quantizer, whose size depends
    on the picture, and a noisy phone video at High came out 63% larger than it went in. If the
    source's video bitrate is lower than the preset's, the preset is capped at the source bitrate and
    a hint warns "This video is already compact; the result may not be much smaller."
  - **Target size**: a number field in MB (decimal: 1 MB = 1,000,000 bytes), default half the source
    rounded to a whole MB, with quick picks 8 / 10 / 25 / 50 MB. Maths in `bitrate.ts`:
    `videoBitrate = (target × 8 × 0.98 − audioBits) / duration`, where 0.98 leaves room for the
    container and `audioBits` is the audio's bitrate × duration (measured when copied, 128 kbps
    assumed when it can't be; set when encoded). The video is encoded at a constant bitrate, which
    lands nearer the target than a variable one. A hint gives the video's bitrate ("About 679 kbps
    for the video."), and another says when the file is already under the target. Problem if the
    video bitrate comes out under 0.02 bits per pixel per frame at the chosen size and frame rate
    (30 fps assumed when unknown): "12 MB is too small for 4 minutes at 1080p. Try 480p or a larger
    size.", suggesting the largest smaller resolution that would work, or only a larger size when
    none would. Durations under ten minutes keep their seconds ("1 minute 30 seconds"). The result
    is single pass, so it can miss; after the job, if the file is over the target by more than 5%,
    the export says so in danger text ("6% over the 10 MB target.", rounded up).
- **Resolution** (segmented): Original, 1080p, 720p, 480p. The number is the shorter side (so it
  works for portrait video), never scales up (options above the source are disabled), keeps the
  aspect ratio, rounds down to even numbers. Frames are resized with WebGL where the browser has it in
  workers (Mediabunny's 2D canvas otherwise), which is several times faster where frames are decoded
  on the GPU.
- **Frame rate** (segmented): Original, 30, 24. Never raises it: a cap at or above the source's rate
  is disabled. A source whose rate isn't known (variable) can be capped. Hidden behind "More
  options".
- **Codec** (segmented, under "More options"): H.264 (default; MP4), HEVC (MP4, `hvc1`), VP9
  (WebM), AV1 (MP4). Each is enabled only if `canEncodeVideo` says yes at the chosen size (the
  worker's `encodable` request, asked once per size; until it replies the action waits, as in
  section 9, and if the question fails the 1080p answer stands in until the next change of settings
  asks again);
  the disabled ones are named under the control: "Not available in this browser: HEVC, AV1." A
  codec that becomes unavailable falls back to the first that is. Captions: H.264 "Plays
  everywhere."; HEVC "Smaller files. Plays on most phones and Macs, but not in every browser."; VP9
  "A WebM file. Plays in browsers, less widely elsewhere. Slow to make in some browsers."; AV1 "The
  smallest files, and the slowest to make. Plays on newer devices."
- **Audio** (segmented, shown only when there is audio): "Keep" (default), "Smaller", "Remove". Every
  audio track is kept. Keep copies them when the output container holds all their codecs, otherwise
  encodes them at 128 kbps (AAC in MP4, Opus in WebM). Smaller encodes at 96 kbps. Encoding mixes
  surround down to stereo. The AAC add-on is registered if the browser can't encode AAC. Audio that
  must be encoded but can't be decoded (AC-3 into WebM, say), or a missing Opus encoder, is a
  problem worded with the codec and container. Subtitles go along when the container holds them;
  otherwise a hint says "Subtitles aren't carried over."
- The settings carry over to the next file; the target size starts at half of each file. A
  resolution or frame rate the next file can't take falls back to Original.
- `hardwareAcceleration: 'no-preference'`. Badge: Re-encodes, with a caption saying what is copied.
- Output name: `<stem> (compressed).<ext>`.
- The export shows the size change. If the result is larger than the source, it says so plainly
  and suggests what to change ("4% larger than the original. Try a lower quality.", or "Try a
  smaller target." after a target-size job).

### 6.7 Grab frame

Saves the frame at the playhead as an image.

- **Format** (segmented): PNG (default), JPEG (quality 90) or WebP (quality 90). With WebP a
  **Lossless** switch (off by default) writes lossless WebP instead: canvases do that at quality 1, in
  Chrome and Firefox alike. Captions: PNG "Every pixel as decoded.", JPEG and WebP "A smaller file, at
  quality 90.", lossless WebP "Every pixel as decoded, in a smaller file than PNG." (about half the
  size on a real 480p frame).
- WebP is offered only where the browser's canvas can write it (`encodeWebp`, section 9; a canvas
  that can't writes a PNG instead, so the probe checks the type that comes back). Problem otherwise:
  "This browser can’t make WebP images. Choose PNG or JPEG."
- **Size**: the video's full display size, rotation applied (`CanvasSink` with the track's rotation).
- The frame is the one shown at the playhead. The settings view shows the playhead's timecode and
  "Set to playhead" is implied; frame-step buttons sit beside it for convenience.
- A secondary "Copy" button puts the frame on the clipboard as a PNG whichever format is chosen
  (clipboards take images as PNG only; `ClipboardItem`, shown only where the browser has it). It says
  "Copied the frame." for a moment; a browser that refuses gets "The browser didn’t allow copying to the
  clipboard. Save the frame instead." A copy takes the job slot (section 7): while one is being made,
  Copy and "Save frame" are disabled.
- The caption gives the size: "The full 1920 × 1080 frame."
- Problem: the video can't be decoded ("This browser can’t decode HEVC, so it can’t show a frame.").
- HDR video is tone-mapped by the browser's decoder; say "HDR frames are converted to SDR" in a
  caption when the track is HDR.
- Badge: none for images (it isn't a copy of the stream); the action is "Save frame".
- Output name: `<stem> frame 0-01-23.456.png` (colons aren't allowed in Windows file names), `.jpg`
  for JPEG, `.webp` for WebP.

### 6.8 Make animation

Turns a short range into an animated GIF or animated WebP.

- **Format** (segmented): GIF (default) or WebP. WebP is offered only where the browser's canvas
  can write it, as in Grab frame; problem otherwise: "This browser can’t make WebP images. Choose
  GIF."
- **Range**: as Trim (shared range), default the first 5 seconds, or the trim range if set. A hint
  appears past 15 seconds ("Long animations get large; consider a video instead."); past 60 seconds
  the action is disabled.
- **Width** (segmented): 320, 480 (default), 640 px, never above the source (a width above it falls
  back to the widest that fits, or to the source's own width when it's narrower than 320); height
  follows. The past-a-minute problem: "An animation can be at most a minute long, and this range is
  1:10.000. Shorten it."
- **Frame rate** (segmented): 10, 15 (default), 20 fps.
- **Loop** switch, on by default.
- Frames come from `CanvasSink` at the chosen size and rate, in the worker. Progress counts frames.
- GIF: gifenc (`quantize` per frame to 256 colours, `applyPalette`, `writeFrame`). Delays are
  hundredths of a second, so at 15 fps they go 7, 6, 7 and the GIF runs at true speed. With Loop off
  the loop extension is left out, so the GIF plays once.
- WebP: the canvas encodes each frame as a lossy WebP at quality 0.8, and `webp.ts` puts their
  bitstreams into ANMF chunks as they are (each frame whole, no blending; a still's ICC profile and
  metadata are left out). Durations are milliseconds (67, 66, 67 at 15 fps). The ANIM loop count is 0
  (forever), or 1 with Loop off. On a real 480p video, 5 s at 480 px came to 1.4 MB against the GIF's
  4.5 MB, and took a fifth of the time to make.
- Badge: Re-encodes. Caption: GIF "GIFs are limited to 256 colours.", WebP "Full colour and smaller
  than a GIF, but some sites and apps take only GIFs."
- The action is "Make GIF" or "Make WebP".
- Output name: `<stem>.gif` or `<stem>.webp`.

## 7. Running a job

### Worker protocol (`src/lib/protocol.ts`)
Like Bytesize's: a promise-based client on the page, a dispatcher in the worker.

```ts
type Request =
  | { type: 'probe'; id: number; file: File }
  | { type: 'capabilities'; id: number }
  | { type: 'encodable'; id: number; size: { width: number; height: number } } // video codecs at a size
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

If the worker fails (its script doesn't load, it dies, or a message can't be read: the Worker's
`error` and `messageerror` events), the client rejects everything pending and every later request
with one sentence: "Moviola’s background worker stopped. Reload the page to carry on." It shows
where the open error does (`role="alert"`), on the card of a job that was running, and, with no file
open, in an alert of its own; never twice at once.

### The job slot (`src/hooks/useJob.ts`)
The page holds one slot, and its state is one value (`JobState`):

```
idle → picking → running → idle        (an export is added: made, or failed)
idle → copying → idle                  (Grab frame's Copy)
picking or running → cancelling → idle
```

- `picking`: the save dialog is open. `running`: the worker has the job. `copying`: a frame is on its
  way to the clipboard. `cancelling`: the job was told to stop and the dialog or the worker hasn't
  answered yet.
- Anything but `idle` holds the slot: the primary action and Copy are disabled (or replaced by the
  progress), so a job and a copy never run together and a second job can't start while a cancelled
  one is still winding down.

### Where results go
- If `window.showSaveFilePicker` exists, the primary action first opens the save dialog (suggested
  name and type from the plan) inside the click, then sends the file handle to the worker, which
  opens a writable stream on it and writes through Mediabunny's `StreamTarget` (`chunked: true`).
  The export shows "Saved" with the name. Cancelling the dialog cancels the job quietly. A job
  cancelled while the dialog is open (by opening another file) never starts, whatever the dialog
  answers; if the user picks a place after all, the empty file is removed. A cancelled
  or failed job aborts the stream (never closes it, which would commit a partial file) and removes
  the empty file the dialog made, where the browser has `remove()`; a file the user chose to
  replace keeps its old contents.
- If the dialog can't be used here (it rejects with `SecurityError` or `NotAllowedError`), the job
  falls back to memory and says so under the progress: "The save dialog can’t be used here, so the
  result is held in memory until you download it." Any other error from the dialog is a bug (a
  suggested name it won't take, say) and fails the job: an export card with "The save dialog couldn’t
  be opened:" and the browser's message.
- Otherwise the worker uses `BufferTarget` and returns the bytes as a `Blob` (transferred); the
  export has a Download button (an object URL, revoked when the export is removed). When the source
  is over 2 GB in this mode, a hint under the action warns that the result is held in memory until
  downloaded.
- Images (frame, animation) always go through memory; they're small.

### Progress and cancel
- Mediabunny's `onProgress` gives the fraction. Time remaining is estimated from elapsed time and
  the fraction once past 3%; until then show only the percentage.
- Cancel: `conversion.cancel()`, then `writable.abort()` when streaming. The export isn't added.
  The page shows "Cancelling…" in place of the progress until the worker answers, and only then gives
  the action back. The worker's answer decides: if the job had finished before the cancel reached it,
  the export is added after all (the file is on disk, and the strip must say so).
- Errors become an export card in danger style with the message in plain words. Unknown errors keep
  Mediabunny's message after "Something went wrong:".
- An encoder add-on that can't be loaded (offline before the precache was complete, or an old tab
  after a deploy) fails the job with "The MP3 encoder couldn’t be loaded. Check your connection, or
  reload the page if Moviola was updated." The failure isn't remembered: the next job tries again.
- Each finished job is announced to screen readers in one sentence: "holiday.m4a is ready to
  download.", "Saved holiday.m4a." or "holiday.m4a wasn't made." followed by the reason. Keyboard
  focus moves from the action to Cancel when a job starts and back when it ends.

### Leaving the page
`beforeunload` asks the browser to confirm while a job runs, and while any result held in memory
hasn't been downloaded. A result counts as downloaded once its Download link is clicked; removing it
from the strip also stops the asking. Results saved to disk never ask.

A new version downloaded in the background shows a banner, "A new version is ready.", with Reload
and Later (`src/components/UpdateBanner.tsx`). It says what reloading would lose
(`src/lib/leaving.ts`): "Reloading will cancel the running job.", "Reloading will discard 2 results
you haven’t downloaded.", or both in one sentence. Reload lets the new version take control, and
vite-plugin-pwa then calls every open tab that saw it waiting, which by default reloads them all:

- The tab whose Reload was pressed reloads, and the browser asks first if anything would be lost.
- Any other tab reloads only if it would lose nothing. Otherwise it stays as it is, its job still
  running, and says "Moviola was updated in another tab. Reload when you’re done here." with a
  Reload button.
- A tab that stays (the one above, or one whose user stayed at the leave prompt: "Moviola was
  updated. Reload when you’re done here.") is the old page under the new service worker. Jobs still
  run there, and a job that was running finishes. Its lazily loaded encoder add-ons keep their
  names across builds until the add-ons themselves change; then the old chunks are gone from the
  precache and the server, and the job fails with the add-on message above.

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
  encodeWebp: boolean // a canvas writes WebP (Grab frame, Make animation)
}
```

Planners take `Capabilities` as an argument, so tests cover "Firefox without AAC" and "no HEVC"
without a browser. Decoding is per track (`MediaInfo.tracks[].canDecode`).

On the page the worker's answer is unknown, known or failed, and only a known answer may say "This
browser can’t encode…":

- **Unknown** (a moment after start-up, or after Try again): the settings are shown as if everything
  could be encoded, so no choice is disabled or quietly changed (Precise stays Precise, MP3 stays
  MP3). If the chosen tool's plan would differ between a browser with every encoder and one with none
  (`dependsOnEncoders`), "Checking what this browser can encode…" stands in for the problems and the
  action is disabled. A plan that wouldn't differ (a copy, or a problem with the file) shows as usual.
- **Failed**: one alert, "Moviola couldn’t check what this browser can encode." with Try again, which
  asks the worker again; actions that hang on the answer stay disabled. If the worker has stopped, the
  alert is that sentence (section 7) with no Try again.

Compress's check at the chosen size has the same three states per size (`src/hooks/useEncodable.ts`):
the action waits with the same sentence while a size is unknown.

## 10. Copy and tone

Plain, short, British spelling. Say what happened and what to do next. No exclamation marks, no
"Oops". Name codecs in plain words (H.264, not avc1). Every problem a planner returns is a full
sentence naming the actual codec, container or number involved.

## 11. Fixtures (`fixtures/`, made by `scripts/fixtures.sh`)

Small (each under 300 kB, a few seconds long), generated with ffmpeg's `testsrc2`, `sine` and
`aevalsrc` sources, committed. Multichannel audio has a different pitch in each channel, so a dropped
or swapped channel shows. At least:

| File | Contents | Used for |
|---|---|---|
| `h264-aac.mp4` | H.264 + stereo AAC, keyframe every 2 s | most tools, fast trim snapping |
| `h264-aac-2audio.mkv` | H.264 + two AAC tracks (eng stereo, fra 5.1) | track lists, remove audio keeping one |
| `vp9-opus.webm` | VP9 + stereo Opus | extract to .opus, container change to MP4 |
| `opus-51.webm` | 5.1 Opus only (channel mapping family 1) | 5.1 Opus copied into Ogg |
| `h264-ac3.mkv` | H.264 + 5.1 AC-3 | extract to .mka, WebM refusal |
| `h264-mp3.mov` | H.264 + MP3 | extract to .mp3 (copied); Mediabunny 1.65 can't name MOV's `.mp3` entry yet, so for now Extract audio says it can't tell the codec |
| `h264-pcm.mov` | H.264 + mono PCM s16le | extract to .wav |
| `h264-flac.mkv` | H.264 + stereo FLAC | extract to .flac |
| `h264-only.mp4` | H.264, no audio | Extract audio dimmed |
| `rotated.mp4` | H.264 with 90° rotation metadata | display size, frame grab |
| `h264-aac.ts` | `h264-aac.mp4` in MPEG-TS, starting near 1.4 s | non-zero start, the fallback preview |
| `h264-aac-late.mp4`, `h264-aac-late.mkv`, `vp9-opus-late.webm` | `h264-aac.mp4` and `vp9-opus.webm` starting 10 s in | the native player's clock |
| `aac.m4a` | mono AAC audio only | audio-only behaviour |
| `pcm-51.wav`, `pcm-71.wav` | 5.1 and 7.1 PCM s16le, 1 s at 16 kHz | surround conversions end to end in Node, the stereo mixdown |
| `flac.flac` | FLAC audio only | a bare FLAC file's length (Mediabunny misreads it if probed carelessly) |
| `flac-24.flac` | 24-bit FLAC audio only | bit depth from STREAMINFO; 16-bit WAV of it isn't lossless |
| `notvideo.txt` | text | the "can't open" message |

Node tests open these with `FilePathSource` (or a `BlobSource` over the file's bytes) and check
outputs by probing them again: codecs unchanged, durations right, packet data byte-identical to the
source's for copy jobs.

## 12. Later

- ffmpeg.wasm fallback for inputs Mediabunny can't read (AVI, FLV, WMV), loaded on demand from the
  same origin. COOP/COEP are already in place for its threads.
- Subtitle extraction to `.vtt`.
- Batches (the same tool over several files).
