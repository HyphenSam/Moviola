import type { InputVideoTrack } from 'mediabunny'
import { playerColourSpace } from '@/lib/colour'

/** Makes the track's decoders take the colour space the browser's `<video>` assumes for it
 * (`playerColourSpace`), so frames drawn from it match the picture that plays. Mediabunny has no option
 * for this, but its sinks configure their decoder from `getDecoderConfig()`, so this wraps that on the
 * track. Firefox's decoder ignores a configured colour space, and its `<video>` and decode already agree. */
export async function decodeAsPlayed(track: InputVideoTrack): Promise<void> {
  const [config, codec, height] = await Promise.all([
    track.getDecoderConfig(),
    track.getCodec(),
    track.getCodedHeight(),
  ])
  const colorSpace = config && playerColourSpace(codec, config.colorSpace ?? {}, height)
  if (!colorSpace) return
  const own = track.getDecoderConfig.bind(track)
  track.getDecoderConfig = async () => {
    const c = await own()
    return c && { ...c, colorSpace }
  }
}
