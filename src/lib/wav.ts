// A WAV's size is known before it's written, and a RIFF file can't pass 4 GiB: its sizes are 32-bit.
// Mediabunny's WAV writer throws there, late in the job, so Extract audio refuses such a WAV up front.

/** Mediabunny refuses any write that would take a RIFF file to this many bytes. */
export const WAV_MAX_BYTES = 2 ** 32

/** The RIFF, fmt and data chunk headers Mediabunny writes before the samples. */
const HEADER_BYTES = 44

/** The size of `duration` seconds of PCM at `sampleRate` Hz, `channels` channels and `bits` bits a
 * sample. */
export function wavBytes(duration: number, sampleRate: number, channels: number, bits: number): number {
  return HEADER_BYTES + Math.ceil(duration * sampleRate) * channels * Math.ceil(bits / 8)
}
