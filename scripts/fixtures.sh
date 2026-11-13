#!/usr/bin/env bash
# Makes the tiny media files in fixtures/ (SPEC.md section 11) with ffmpeg's testsrc2 and sine
# sources. The output is committed; run `pnpm fixtures` only to change or add one.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p fixtures
cd fixtures

# 4 s of 320×180 at 25 fps, with a keyframe exactly every 2 s (fast trim snaps to these).
video=(-f lavfi -i testsrc2=size=320x180:rate=25:duration=4)
x264=(-c:v libx264 -preset veryfast -crf 32 -pix_fmt yuv420p -g 50 -keyint_min 50 -sc_threshold 0)
tone() { echo "-f lavfi -i sine=frequency=$1:sample_rate=48000:duration=4"; }
# An aevalsrc filter with one tone per channel, each its own pitch, so a dropped or swapped channel
# shows. Channels in WAV order: L, R, C, LFE, then the back and side pairs. Quoted where it's used.
voices() {
  local layout=$1 rate=${2:-48000} duration=${3:-4} exprs='' f
  local -A count=([stereo]=2 [5.1]=6 [7.1]=8)
  local pitches=(440 554 659 80 330 392 494 587)
  for f in "${pitches[@]:0:${count[$layout]}}"; do exprs+="${exprs:+|}0.25*sin(2*PI*$f*t)"; done
  echo "aevalsrc=exprs=$exprs:channel_layout=$layout:sample_rate=$rate:duration=$duration"
}
# ffmpeg with its last argument as the output, written without dates or encoder names so that
# regenerating changes as little as possible.
ff() {
  local out="${*: -1}"
  ffmpeg -hide_banner -loglevel error -y "${@:1:$#-1}" -map_metadata -1 -fflags +bitexact "$out"
}

ff "${video[@]}" -f lavfi -i "$(voices stereo)" -map 0 -map 1 "${x264[@]}" -c:a aac -b:a 64k -shortest h264-aac.mp4

# A stereo English track and a 5.1 French one, as films come.
ff "${video[@]}" -f lavfi -i "$(voices stereo)" -f lavfi -i "$(voices 5.1)" -map 0 -map 1 -map 2 "${x264[@]}" \
  -c:a aac -b:a:0 64k -b:a:1 128k -metadata:s:a:0 language=eng -metadata:s:a:1 language=fra \
  -shortest h264-aac-2audio.mkv

ff "${video[@]}" -f lavfi -i "$(voices stereo)" -map 0 -map 1 -c:v libvpx-vp9 -crf 45 -b:v 0 \
  -deadline realtime -cpu-used 8 -g 50 -c:a libopus -b:a 48k -shortest vp9-opus.webm

# 5.1 Opus needs channel mapping family 1, which Ogg has to carry over when it's copied to .opus.
ff -f lavfi -i "$(voices 5.1)" -c:a libopus -b:a 96k opus-51.webm

ff "${video[@]}" -f lavfi -i "$(voices 5.1)" -map 0 -map 1 "${x264[@]}" -c:a ac3 -b:a 192k -shortest h264-ac3.mkv

# shellcheck disable=SC2046
ff "${video[@]}" $(tone 440) -map 0 -map 1 "${x264[@]}" -c:a libmp3lame -b:a 64k -shortest h264-mp3.mov

# PCM is uncompressed, so mono at 16 kHz keeps the file small.
# shellcheck disable=SC2046
ff "${video[@]}" $(tone 440) -map 0 -map 1 "${x264[@]}" -c:a pcm_s16le -ar 16000 -ac 1 -shortest h264-pcm.mov

ff "${video[@]}" -f lavfi -i "$(voices stereo)" -map 0 -map 1 "${x264[@]}" -c:a flac -sample_fmt s16 -shortest h264-flac.mkv

ff "${video[@]}" "${x264[@]}" h264-only.mp4

# MPEG-TS starts its timestamps near 1.4 s, not 0: the player and planners must count from there.
ff -i h264-aac.mp4 -c copy h264-aac.ts

# Stored 320×180 with 90° display rotation, so it shows as 180×320.
ff -display_rotation 90 -i h264-only.mp4 -c copy rotated.mp4

# shellcheck disable=SC2046
ff $(tone 440) -c:a aac -b:a 64k aac.m4a

# A bare FLAC file: Mediabunny measures its length wrongly while also reading packet stats.
# shellcheck disable=SC2046
ff $(tone 440) -c:a flac flac.flac

# 24-bit FLAC: 16-bit WAV rounds its samples, so that conversion mustn't be called lossless.
# shellcheck disable=SC2046
ff $(tone 440) -c:a flac -sample_fmt s32 -bits_per_raw_sample 24 flac-24.flac

# Surround PCM, which Node can decode, so converting it runs end to end in the tests. A second at
# 16 kHz keeps them small.
ff -f lavfi -i "$(voices 5.1 16000 1)" -c:a pcm_s16le pcm-51.wav
ff -f lavfi -i "$(voices 7.1 16000 1)" -c:a pcm_s16le pcm-71.wav

printf 'This is not a video.\n' > notvideo.txt

# Every fixture stays small enough to commit.
limit=$((300 * 1024))
for f in *; do
  size=$(wc -c < "$f")
  if [ "$size" -ge "$limit" ]; then
    echo "$f is $size bytes, over the 300 kB limit" >&2
    exit 1
  fi
  printf '%8d  %s\n' "$size" "$f"
done
