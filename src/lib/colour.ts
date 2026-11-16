import type { VideoCodec } from 'mediabunny'

/** The colour space to decode a track's frames in so that they look as the browser's `<video>` shows them,
 * or null to leave the decoder as it is.
 *
 * Players read a fully tagged track's own colour space. Without one, or with only part of one (a matrix
 * alone, say), Chrome's `<video>` ignores the tags and guesses: BT.601 for H.264, HEVC and VP8 under 720
 * lines (coded height), BT.709 at 720 or more and for VP9 and AV1 at any size, as players have long done.
 * Its WebCodecs decoder, given nothing, takes BT.709 at every size (as Mediabunny fills in), so SD
 * thumbnails and stills came out in other colours than the picture played. Only the matrix changes the
 * pixels; the primaries and transfer go with it to make the colour space complete, which Chrome's decoder
 * needs before it takes any of it. A tag in the bitstream that is complete still wins over this. */
export function playerColourSpace(
  codec: VideoCodec | null,
  colour: VideoColorSpaceInit,
  codedHeight: number,
): VideoColorSpaceInit | null {
  if (!codec || (colour.primaries && colour.transfer && colour.matrix)) return null
  const name = codedHeight < 720 && codec !== 'vp9' && codec !== 'av1' ? 'smpte170m' : 'bt709'
  return { primaries: name, transfer: name, matrix: name, fullRange: colour.fullRange ?? false }
}
