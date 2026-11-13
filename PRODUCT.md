# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite, React 19, TypeScript, Tailwind v4, Radix primitives, Vitest; pnpm. Static site on Cloudflare
Workers (static assets only) at moviola.hyphensam.com. Media work is done by Mediabunny (reading,
writing and converting containers) and the browser's WebCodecs (decoding and encoding), with small
WebAssembly add-ons for MP3, FLAC and AAC encoding where the browser lacks them. Installable PWA that
works offline.

## Users

People with a video and a small job to do who don't want a command line or an upload site: pull
the soundtrack out of a recording, cut a clip, make a file small enough for a chat or a form, turn an
MKV into something a phone plays, grab a still or a GIF. Comfortable with files and folders; not
necessarily with codecs.

## Product Purpose

Everyday video jobs done on the user's own device, losslessly wherever that's possible, and plainly
labelled when it isn't. Success: open a video, pick a tool, get the file out, and know whether any
quality was lost.

## Positioning

What people reach for ffmpeg to do, with a GUI and no install: no uploads, no account, no server, no
size limit beyond the device's own, and it keeps working offline once installed. Unlike most
browser video converters, it copies streams instead of re-encoding them whenever it can, and says
which it did. Free and open source (MIT OR Apache-2.0).

## Operating Context

- One video open at a time, added by drag and drop, file picker, or opening it with the installed app.
- Eight tools: extract audio, media info, trim, change container, remove audio, compress, grab a
  frame, make a GIF.
- Copying jobs (most of them) run at disk speed. Re-encoding runs at whatever speed the browser's
  encoder manages, often hardware-accelerated, still minutes for a long video.
- Large files are normal (gigabytes). In Chromium browsers results stream straight to a file the user
  chooses; elsewhere they're held in memory until downloaded.

## Capabilities and Constraints

- Opens MP4, MOV, MKV, WebM, MPEG-TS, and audio files (MP3, WAV, FLAC, Ogg, AAC). Not AVI, FLV or
  WMV (a later ffmpeg.wasm fallback may add them).
- Copies any codec Mediabunny can read, AC-3, DTS and TrueHD included. Decoding and encoding
  depend on the browser: AC-3, DTS and TrueHD can't be decoded anywhere, HEVC only on some
  machines.
- Writes MP4, MOV, MKV, WebM, M4A, MP3, WAV, FLAC, Ogg/Opus, PNG and GIF.

## Brand Commitments

- Name: Moviola, after the upright film-editing machine.
- Voice: plain and quiet. Short, factual labels; explains only when asked; a tool that gets out of
  the way. British spelling.
- Credit Mediabunny, LAME, libFLAC, FFmpeg's AAC encoder and gifenc in About.

## Evidence on Hand

No testimonials or benchmarks are provided; don't invent them.

## Product Principles

1. Lossless by default. Copy streams wherever possible; re-encode only when the job needs it.
2. Never re-encode quietly. Every action is labelled "Lossless" or "Re-encodes" before it runs.
3. Nothing leaves the device, and the app says so plainly once.
4. Say what this browser can't do, specifically, instead of failing halfway through.
5. The picture is the hero; the interface recedes around it.
6. Sensible defaults; options stay out of sight until wanted.

## Accessibility & Inclusion

Keyboard operable throughout (player and timeline included), visible focus, WCAG AA contrast in light
and dark themes, reduced motion respected.
