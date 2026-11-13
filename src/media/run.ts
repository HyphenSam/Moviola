import {
  AudioSample,
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  Input,
  Output,
  StreamTarget,
  type ConversionAudioOptions,
  type InputTrack,
  type StreamTargetChunk,
} from 'mediabunny'
import { discardedSentence } from '@/lib/discarded'
import type { Plan } from '@/lib/plan'
import { ensureEncoder } from './encoders'
import { outputFormat } from './formats'
import { FORMATS } from './probe'

export const CANCELLED = 'Cancelled.'

/** A failure worded for the user, shown as it is. Anything else is unexpected and keeps
 * Mediabunny's own message (SPEC.md section 7). */
export class JobProblem extends Error {}

export type RunResult = { size: number; buffer: ArrayBuffer | null }

type Options = { onProgress?: (fraction: number) => void; signal?: AbortSignal }

/** Float samples to 16 or 32-bit integers, scaled by 2^15 or 2^31 and rounded, so a value that came
 * from integers lands back on them exactly (a 24-bit value in 32 bits has its low eight bits zero, and
 * survives the FLAC encoder's cut back to 24). */
export function floatToInt(samples: Float32Array, bits: 16 | 32): Int16Array | Int32Array {
  const out = bits === 16 ? new Int16Array(samples.length) : new Int32Array(samples.length)
  const scale = 2 ** (bits - 1)
  for (let i = 0; i < samples.length; i++) {
    out[i] = Math.max(-scale, Math.min(scale - 1, Math.round(samples[i] * scale)))
  }
  return out
}

/** Interleaved 7.1 (L, R, C, LFE, back L, back R, side L, side R) to stereo, the way Mediabunny mixes
 * 5.1: each side keeps its front channel and takes the centre and its own surrounds at √½, and the LFE
 * is left out. Mediabunny has no rule for 7.1 and keeps only the front pair, losing the centre, where
 * a film's dialogue is. */
export function downmix71(samples: Float32Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(samples.length / 4)
  for (let i = 0, s = 0; i < out.length; i += 2, s += 8) {
    const centre = samples[s + 2]
    out[i] = samples[s] + Math.SQRT1_2 * (centre + samples[s + 4] + samples[s + 6])
    out[i + 1] = samples[s + 1] + Math.SQRT1_2 * (centre + samples[s + 5] + samples[s + 7])
  }
  return out
}

/** Mediabunny's options for re-encoding the plan's audio from a source with `channels` channels.
 * Integer samples (which set FLAC's depth) are made here rather than by `sampleFormat`, which converts
 * with the browser's `AudioData.copyTo`: Chrome's s32 to s16 and Firefox's float to s32 both land a
 * step off (235 becomes 234). Copying out as float is exact in both, and so is rounding from there. */
function audioOptions(
  { sampleFormat, numberOfChannels, ...encode }: NonNullable<Plan['audio']>,
  channels: number,
): ConversionAudioOptions {
  const mix71 = channels === 8 && numberOfChannels === 2
  if (!sampleFormat && !mix71) return { ...encode, numberOfChannels, forceTranscode: true }
  const bits = sampleFormat === 's16' ? 16 : 32
  return {
    ...encode,
    // Mediabunny mixes before `process` runs, so 7.1 reaches it whole and is mixed there.
    ...(mix71 ? { processedNumberOfChannels: 2 } : { numberOfChannels }),
    forceTranscode: true,
    sampleFormat: 'f32',
    process: (sample) => {
      let floats = new Float32Array(sample.allocationSize({ format: 'f32', planeIndex: 0 }) / 4)
      sample.copyTo(floats, { format: 'f32', planeIndex: 0 })
      if (mix71) floats = downmix71(floats)
      return new AudioSample({
        data: sampleFormat ? floatToInt(floats, bits) : floats,
        format: sampleFormat ?? 'f32',
        numberOfChannels: mix71 ? 2 : sample.numberOfChannels,
        sampleRate: sample.sampleRate,
        timestamp: sample.timestamp,
      })
    },
  }
}

/** Runs a plan: every kept track copied as is (`copy: { mode: 'forced' }`, so nothing is ever quietly
 * re-encoded) into the plan's container, apart from audio the plan says to re-encode. With a
 * `writable` (a file the user chose) the output is streamed to it; without one it's built in memory
 * and returned. A cancelled or failed job aborts the writable, so a half-written file is discarded
 * rather than saved. */
export async function run(
  file: File,
  plan: Plan,
  writable: WritableStream<StreamTargetChunk> | null,
  { onProgress, signal }: Options = {},
): Promise<RunResult> {
  const sink = writable?.getWriter() ?? null
  let size = 0
  let output: Output | undefined
  const target = sink
    ? new StreamTarget(
        new WritableStream<StreamTargetChunk>({
          write: (chunk) => {
            size = Math.max(size, chunk.position + chunk.data.byteLength)
            return sink.write(chunk)
          },
          // Mediabunny closes the stream when it finishes and when it's cancelled. Closing a file
          // stream commits it, so only a finished output is closed; anything else is thrown away.
          close: () => (output?.state === 'finalizing' ? sink.close() : sink.abort()),
          abort: (reason) => sink.abort(reason),
        }),
        { chunked: true },
      )
    : new BufferTarget()
  output = new Output({ format: outputFormat(plan.container, !!sink), target })
  const input = new Input({ source: new BlobSource(file), formats: [...FORMATS.keys()] })
  const keep = (track: InputTrack) => (plan.keep.includes(track.id) ? {} : { discard: true })
  const encode = plan.audio

  try {
    if (encode) await ensureEncoder(encode.codec)
    if (signal?.aborted) throw new ConversionCanceledError()
    const conversion = await Conversion.init({
      input,
      output,
      video: keep,
      audio: encode
        ? async (track) =>
            plan.keep.includes(track.id) ? audioOptions(encode, await track.getNumberOfChannels()) : { discard: true }
        : keep,
      // Some containers can't start before 0 (Ogg, with Opus's pre-roll at −7 ms), so copied media may
      // be shifted; Mediabunny keeps every track in sync when it does. Only a plan that re-encodes
      // lets Mediabunny transcode; anything else is copied or refused.
      copy: { mode: encode ? 'preferred' : 'forced', shiftTolerance: Infinity },
      showWarnings: false,
    })

    // Tracks the plan left out don't matter, whatever Mediabunny's reason.
    const problems = conversion.discardedTracks
      .filter((d) => plan.keep.includes(d.track.id))
      .map((d) =>
        discardedSentence({
          kind: d.track.type as 'video' | 'audio' | 'subtitle',
          codec: d.track.codec,
          reason: d.reason,
          container: plan.container,
        }),
      )
      .filter((s): s is string => !!s)
    if (problems.length || !conversion.isValid) {
      throw new JobProblem(problems.join(' ') || 'There’s nothing to write: every track was left out.')
    }

    if (signal?.aborted) throw new ConversionCanceledError()
    signal?.addEventListener('abort', () => void conversion.cancel(), { once: true })
    if (onProgress) conversion.onProgress = (fraction) => onProgress(fraction)
    await conversion.execute()

    if (target instanceof BufferTarget) return { size: target.buffer!.byteLength, buffer: target.buffer }
    return { size, buffer: null }
  } catch (error) {
    // A failure before the output started, or one Mediabunny didn't clean up after, leaves the
    // stream open; discard it.
    await sink?.abort().catch(() => {})
    // Cancelling midway can surface as Mediabunny's "Output has been canceled." as well.
    if (signal?.aborted || error instanceof ConversionCanceledError) throw new JobProblem(CANCELLED)
    throw error
  } finally {
    input.dispose()
  }
}
