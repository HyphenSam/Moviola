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
# ffmpeg with its last argument as the output, written without dates or encoder names so that
# regenerating changes as little as possible.
ff() {
  local out="${*: -1}"
  ffmpeg -hide_banner -loglevel error -y "${@:1:$#-1}" -map_metadata -1 -fflags +bitexact "$out"
}

# shellcheck disable=SC2046
ff "${video[@]}" $(tone 440) -map 0 -map 1 "${x264[@]}" -c:a aac -b:a 64k -shortest h264-aac.mp4

# shellcheck disable=SC2046
ff "${video[@]}" $(tone 440) $(tone 660) -map 0 -map 1 -map 2 "${x264[@]}" -c:a aac -b:a 64k \
  -metadata:s:a:0 language=eng -metadata:s:a:1 language=fra -shortest h264-aac-2audio.mkv

# shellcheck disable=SC2046
ff "${video[@]}" $(tone 440) -map 0 -map 1 -c:v libvpx-vp9 -crf 45 -b:v 0 -deadline realtime -cpu-used 8 \
  -g 50 -c:a libopus -b:a 48k -shortest vp9-opus.webm

# shellcheck disable=SC2046
ff "${video[@]}" $(tone 440) -map 0 -map 1 "${x264[@]}" -c:a ac3 -b:a 96k -shortest h264-ac3.mkv

# shellcheck disable=SC2046
ff "${video[@]}" $(tone 440) -map 0 -map 1 "${x264[@]}" -c:a libmp3lame -b:a 64k -shortest h264-mp3.mov

# PCM is uncompressed, so mono at 16 kHz keeps the file small.
# shellcheck disable=SC2046
ff "${video[@]}" $(tone 440) -map 0 -map 1 "${x264[@]}" -c:a pcm_s16le -ar 16000 -ac 1 -shortest h264-pcm.mov

# shellcheck disable=SC2046
ff "${video[@]}" $(tone 440) -map 0 -map 1 "${x264[@]}" -c:a flac -shortest h264-flac.mkv

ff "${video[@]}" "${x264[@]}" h264-only.mp4

# MPEG-TS starts its timestamps near 1.4 s, not 0: the player and planners must count from there.
ff -i h264-aac.mp4 -c copy h264-aac.ts

# Stored 320×180 with 90° display rotation, so it shows as 180×320.
ff -display_rotation 90 -i h264-only.mp4 -c copy rotated.mp4

# shellcheck disable=SC2046
ff $(tone 440) -c:a aac -b:a 64k aac.m4a

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
