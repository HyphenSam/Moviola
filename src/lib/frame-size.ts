import type { MediaCodec } from 'mediabunny'
import type { Size } from './protocol'

/** How a video track's frames change size as it plays: the smallest and largest of its keyframes'
 * sizes by area, and how many times the size changes from one keyframe to the next. */
export type SizeChanges = { smallest: Size; largest: Size; changes: number }

/** The codecs whose keyframe headers `keyframeSize` reads. */
export const SIZED_CODECS: readonly MediaCodec[] = ['vp8', 'vp9', 'av1']

/** The changes in keyframe sizes listed in the order they play; null when there are none. */
export function sizeChanges(sizes: Size[]): SizeChanges | null {
  const changes = sizes.filter((s, i) => i > 0 && (s.width !== sizes[i - 1].width || s.height !== sizes[i - 1].height))
  if (!changes.length) return null
  const area = (s: Size) => s.width * s.height
  return {
    smallest: sizes.reduce((a, b) => (area(b) < area(a) ? b : a)),
    largest: sizes.reduce((a, b) => (area(b) > area(a) ? b : a)),
    changes: changes.length,
  }
}

/** The size of the frame a keyframe packet holds, from its header; null for any other packet, one cut
 * short or garbled, or a codec whose headers aren't read. The size is the decoded one, before any
 * render size or pixel aspect ratio the stream or container asks for. */
export function keyframeSize(codec: MediaCodec, packet: Uint8Array): Size | null {
  try {
    if (codec === 'vp8') return vp8(packet)
    if (codec === 'vp9') return vp9(packet)
    if (codec === 'av1') return av1(packet)
    return null
  } catch (error) {
    if (error instanceof RangeError) return null
    throw error
  }
}

/** Reads `n` bits at a time, most significant first; throws a RangeError past the end. */
function bitReader(bytes: Uint8Array) {
  let pos = 0
  return (n: number) => {
    if (pos + n > bytes.length * 8) throw new RangeError('The header is cut short.')
    let value = 0
    for (const end = pos + n; pos < end; pos++) value = value * 2 + ((bytes[pos >> 3] >> (7 - (pos & 7))) & 1)
    return value
  }
}

// RFC 6386 section 9.1: a frame tag whose lowest bit is clear on a keyframe, a start code, then the
// width and height in 14 bits each, little-endian, under 2 bits of scaling.
function vp8(p: Uint8Array): Size | null {
  if (p.length < 10 || p[0] & 1 || p[3] !== 0x9d || p[4] !== 0x01 || p[5] !== 0x2a) return null
  return { width: (p[6] | (p[7] << 8)) & 0x3fff, height: (p[8] | (p[9] << 8)) & 0x3fff }
}

// The VP9 bitstream specification, section 6.2: the uncompressed header as far as a keyframe's size.
// A superframe holds its frames back to back, and a keyframe comes first.
function vp9(p: Uint8Array): Size | null {
  const read = bitReader(p)
  if (read(2) !== 2) return null // frame_marker
  const profile = read(1) | (read(1) << 1)
  if (profile === 3) read(1)
  if (read(1)) return null // show_existing_frame
  if (read(1)) return null // frame_type: not a keyframe
  read(2) // show_frame, error_resilient_mode
  if (read(24) !== 0x498342) return null // frame_sync_code
  if (profile >= 2) read(1) // ten_or_twelve_bit
  const rgb = read(3) === 7
  const fourFour = profile === 1 || profile === 3
  read((rgb ? 0 : 1) + (fourFour ? (rgb ? 1 : 3) : 0)) // colour range, subsampling and reserved bits
  return { width: read(16) + 1, height: read(16) + 1 }
}

type Av1Sequence = {
  reduced: boolean
  equalPictureInterval: boolean
  decoderModel: { delayBits: number; removalBits: number; presentationBits: number } | null
  operatingPoints: { idc: number; decoderModel: boolean }[]
  widthBits: number
  heightBits: number
  maxWidth: number
  maxHeight: number
  frameIdBits: number
  screenContentTools: number // 2 when each frame says
  integerMv: number // 2 when each frame says
  orderHintBits: number
}

const SELECT = 2

// The AV1 specification, sections 5.3 to 5.5 and 5.9: a packet is a run of OBUs, and in Matroska
// and MP4 a keyframe's packet holds its sequence header, so no state is needed between packets.
function av1(p: Uint8Array): Size | null {
  let sequence: Av1Sequence | null = null
  let i = 0
  while (i < p.length) {
    const header = p[i++]
    const type = (header >> 3) & 15
    const extension = header & 4 ? p[i++] : 0
    let size = p.length - i
    if (header & 2) {
      size = 0
      for (let shift = 0; ; shift += 7) {
        if (i >= p.length || shift > 49) throw new RangeError('The OBU size is cut short.')
        const byte = p[i++]
        size += (byte & 0x7f) * 2 ** shift
        if (!(byte & 0x80)) break
      }
    }
    if (i + size > p.length) throw new RangeError('The OBU runs past the packet.')
    const obu = p.subarray(i, i + size)
    if (type === 1) sequence = av1Sequence(obu)
    // The first frame header decides: a temporal unit starting with any other frame isn't a keyframe.
    else if (type === 3 || type === 6)
      return sequence && av1Keyframe(obu, sequence, extension >> 5, (extension >> 3) & 3)
    i += size
  }
  return null
}

function av1Sequence(obu: Uint8Array): Av1Sequence {
  const read = bitReader(obu)
  read(4) // seq_profile, still_picture
  const reduced = read(1) === 1
  let equalPictureInterval = false
  let decoderModel: Av1Sequence['decoderModel'] = null
  const operatingPoints: Av1Sequence['operatingPoints'] = []
  if (reduced) {
    read(5) // seq_level_idx
    operatingPoints.push({ idc: 0, decoderModel: false })
  } else {
    if (read(1)) {
      read(64) // num_units_in_display_tick, time_scale
      equalPictureInterval = read(1) === 1
      if (equalPictureInterval) {
        let zeros = 0
        while (!read(1)) zeros++
        if (zeros < 32) read(zeros) // num_ticks_per_picture_minus_1
      }
      if (read(1)) {
        const delayBits = read(5) + 1
        read(32) // num_units_in_decoding_tick
        decoderModel = { delayBits, removalBits: read(5) + 1, presentationBits: read(5) + 1 }
      }
    }
    const initialDisplayDelay = read(1) === 1
    const count = read(5) + 1
    for (let n = 0; n < count; n++) {
      const idc = read(12)
      if (read(5) > 7) read(1) // seq_level_idx, seq_tier
      const present = decoderModel !== null && read(1) === 1
      if (present) read(decoderModel!.delayBits * 2 + 1) // buffer delays, low_delay_mode_flag
      if (initialDisplayDelay && read(1)) read(4)
      operatingPoints.push({ idc, decoderModel: present })
    }
  }
  const widthBits = read(4) + 1
  const heightBits = read(4) + 1
  const maxWidth = read(widthBits) + 1
  const maxHeight = read(heightBits) + 1
  const frameIdBits = !reduced && read(1) ? read(4) + 2 + read(3) + 1 : 0
  read(3) // use_128x128_superblock, enable_filter_intra, enable_intra_edge_filter
  let screenContentTools = SELECT
  let integerMv = SELECT
  let orderHintBits = 0
  if (!reduced) {
    read(4) // interintra and masked compound, warped motion, dual filter
    const orderHint = read(1) === 1
    if (orderHint) read(2) // enable_jnt_comp, enable_ref_frame_mvs
    screenContentTools = read(1) ? SELECT : read(1)
    if (screenContentTools) integerMv = read(1) ? SELECT : read(1)
    if (orderHint) orderHintBits = read(3) + 1
  }
  return {
    reduced,
    equalPictureInterval,
    decoderModel,
    operatingPoints,
    widthBits,
    heightBits,
    maxWidth,
    maxHeight,
    frameIdBits,
    screenContentTools,
    integerMv,
    orderHintBits,
  }
}

// The uncompressed header (5.9.2) as far as a keyframe's frame_size(). The width read is the one
// after superres upscaling, which is what decodes.
function av1Keyframe(obu: Uint8Array, seq: Av1Sequence, temporalId: number, spatialId: number): Size | null {
  const read = bitReader(obu)
  let shown = true
  let errorResilient = true
  if (!seq.reduced) {
    if (read(1)) return null // show_existing_frame
    if (read(2) !== 0) return null // frame_type: not KEY_FRAME
    shown = read(1) === 1
    if (shown && seq.decoderModel && !seq.equalPictureInterval) read(seq.decoderModel.presentationBits)
    if (!shown) {
      read(1) // showable_frame
      errorResilient = read(1) === 1
    }
  }
  read(1) // disable_cdf_update
  const screenContentTools = seq.screenContentTools === SELECT ? read(1) : seq.screenContentTools
  if (screenContentTools && seq.integerMv === SELECT) read(1) // force_integer_mv
  read(seq.frameIdBits) // current_frame_id
  const override = !seq.reduced && read(1) === 1
  read(seq.orderHintBits)
  if (seq.decoderModel && read(1)) {
    for (const { idc, decoderModel } of seq.operatingPoints) {
      const inLayers = (idc >> temporalId) & 1 && (idc >> (spatialId + 8)) & 1
      if (decoderModel && (idc === 0 || inLayers)) read(seq.decoderModel.removalBits) // buffer_removal_time
    }
  }
  if (!shown && read(8) !== 0xff && errorResilient) read(8 * seq.orderHintBits) // ref_order_hint
  if (!override) return { width: seq.maxWidth, height: seq.maxHeight }
  return { width: read(seq.widthBits) + 1, height: read(seq.heightBits) + 1 }
}
