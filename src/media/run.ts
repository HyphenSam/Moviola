import {
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  Input,
  Output,
  StreamTarget,
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

/** Runs a plan: every kept track copied as is (`copy: { mode: 'forced' }`, so nothing is ever quietly
 * re-encoded) into the plan's container, apart from audio the plan says to re-encode. With a `writable` (a file the user chose) the output is
 * streamed to it; without one it's built in memory and returned. A cancelled or failed job aborts the
 * writable, so a half-written file is discarded rather than saved. */
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
        ? (track) => (plan.keep.includes(track.id) ? { ...encode, forceTranscode: true } : { discard: true })
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
