import { describe, expect, it } from 'vitest'
import { keyframeSize, sizeChanges } from './frame-size'

/** Bits written most significant first, as the codecs' headers are; the last byte is padded with zeros. */
function bits() {
  const out: number[] = []
  const writer = {
    put(value: number, n: number) {
      for (let i = n - 1; i >= 0; i--) out.push(Math.floor(value / 2 ** i) % 2)
      return writer
    },
    bytes: () =>
      Uint8Array.from({ length: Math.ceil(out.length / 8) }, (_, i) =>
        out.slice(i * 8, i * 8 + 8).reduce((byte, bit, j) => byte | (bit << (7 - j)), 0),
      ),
  }
  return writer
}

/** An AV1 OBU with its size field, and an extension header when `ids` are given. */
function obu(type: number, payload: Uint8Array, ids?: { temporal: number; spatial: number }) {
  const header = [(type << 3) | (ids ? 4 : 0) | 2, ...(ids ? [(ids.temporal << 5) | (ids.spatial << 3)] : [])]
  const size: number[] = []
  let n = payload.length
  do {
    size.push((n & 0x7f) | (n > 0x7f ? 0x80 : 0))
    n >>= 7
  } while (n)
  return Uint8Array.from([...header, ...size, ...payload])
}
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => [...p]))
const SEQUENCE = 1
const TEMPORAL_DELIMITER = 2
const FRAME = 6

describe('keyframeSize, VP8', () => {
  // A keyframe's frame tag (bit 0 clear), the start code, then 14 bits of width and height each,
  // little-endian, under 2 bits of scaling.
  const vp8 = (tag: number, width: number, height: number) =>
    Uint8Array.from([tag, 0x02, 0x00, 0x9d, 0x01, 0x2a, width & 0xff, width >> 8, height & 0xff, height >> 8, 0, 0])

  it('reads a keyframe’s size', () => {
    expect(keyframeSize('vp8', vp8(0x10, 320, 180))).toEqual({ width: 320, height: 180 })
  })

  it('leaves out the scaling bits', () => {
    expect(keyframeSize('vp8', vp8(0x10, 320 | 0x4000, 180 | 0xc000))).toEqual({ width: 320, height: 180 })
  })

  it('reads nothing from an inter frame, or a keyframe without the start code', () => {
    expect(keyframeSize('vp8', vp8(0x11, 320, 180))).toBeNull()
    const broken = vp8(0x10, 320, 180)
    broken[4] = 0
    expect(keyframeSize('vp8', broken)).toBeNull()
  })
})

describe('keyframeSize, VP9', () => {
  // The uncompressed header: frame marker, profile (low bit first), show_existing_frame, frame_type,
  // show_frame, error_resilient_mode, the sync code, the colour config, then the size less one.
  const head = (profile: number) =>
    bits()
      .put(2, 2)
      .put(profile & 1, 1)
      .put(profile >> 1, 1)
      .put(0, profile === 3 ? 1 : 0)

  it('reads a profile 0 keyframe’s size', () => {
    const packet = head(0).put(0, 1).put(0, 1).put(1, 1).put(0, 1).put(0x498342, 24)
    packet.put(2, 3).put(0, 1) // BT.709, limited range
    packet.put(959, 16).put(0, 16).put(0, 1)
    expect(keyframeSize('vp9', packet.bytes())).toEqual({ width: 960, height: 1 })
  })

  it('reads past a profile 1 keyframe’s subsampling bits', () => {
    const packet = head(1).put(0, 4).put(0x498342, 24)
    packet.put(1, 3).put(1, 1).put(0, 3) // BT.601, full range, 4:4:4, reserved
    packet.put(319, 16).put(179, 16)
    expect(keyframeSize('vp9', packet.bytes())).toEqual({ width: 320, height: 180 })
  })

  it('reads past a profile 2 keyframe’s bit depth', () => {
    const packet = head(2).put(0, 4).put(0x498342, 24)
    packet.put(0, 1).put(2, 3).put(0, 1) // 10-bit, BT.709, limited range
    packet.put(1919, 16).put(1079, 16)
    expect(keyframeSize('vp9', packet.bytes())).toEqual({ width: 1920, height: 1080 })
  })

  it('reads past a profile 3 RGB keyframe’s reserved bits', () => {
    const packet = head(3).put(0, 4).put(0x498342, 24)
    packet.put(1, 1).put(7, 3).put(0, 1) // 12-bit, RGB, reserved
    packet.put(63, 16).put(31, 16)
    expect(keyframeSize('vp9', packet.bytes())).toEqual({ width: 64, height: 32 })
  })

  it('reads nothing from an inter frame, a repeated frame or a header without the sync code', () => {
    expect(keyframeSize('vp9', head(0).put(0, 1).put(1, 1).put(0, 40).bytes())).toBeNull()
    expect(keyframeSize('vp9', head(0).put(1, 1).put(0, 3).put(0, 40).bytes())).toBeNull()
    expect(keyframeSize('vp9', head(0).put(0, 4).put(0x123456, 24).put(0, 40).bytes())).toBeNull()
    expect(keyframeSize('vp9', bits().put(1, 2).put(0, 60).bytes())).toBeNull()
  })
})

describe('keyframeSize, AV1', () => {
  /** A sequence header as libaom writes one: no timing info, one operating point at level 4.0, 9 bits
   * of width and 8 of height, order hints of 7 bits, and screen content tools left to each frame. */
  const sequence = (width: number, height: number) =>
    bits()
      .put(0, 3) // seq_profile
      .put(0, 1) // still_picture
      .put(0, 1) // reduced_still_picture_header
      .put(0, 1) // timing_info_present_flag
      .put(0, 1) // initial_display_delay_present_flag
      .put(0, 5) // one operating point
      .put(0, 12) // operating_point_idc
      .put(8, 5) // seq_level_idx, over 7 so a tier follows
      .put(0, 1) // seq_tier
      .put(8, 4) // 9 bits of width
      .put(7, 4) // 8 bits of height
      .put(width - 1, 9)
      .put(height - 1, 8)
      .put(0, 1) // frame_id_numbers_present_flag
      .put(0, 3) // 128×128 superblocks, filter intra, intra edge filter
      .put(0, 4) // interintra, masked compound, warped motion, dual filter
      .put(1, 1) // enable_order_hint
      .put(0, 2) // jnt_comp, ref_frame_mvs
      .put(1, 1) // seq_choose_screen_content_tools
      .put(1, 1) // seq_choose_integer_mv
      .put(6, 3) // 7 bits of order hint
      .put(0, 8)
      .bytes()

  /** A shown keyframe for that sequence, at its largest size or at `size`. */
  const keyframe = (size?: { width: number; height: number }) => {
    const header = bits()
      .put(0, 1) // show_existing_frame
      .put(0, 2) // KEY_FRAME
      .put(1, 1) // show_frame
      .put(0, 1) // disable_cdf_update
      .put(1, 1) // allow_screen_content_tools
      .put(0, 1) // force_integer_mv
      .put(size ? 1 : 0, 1) // frame_size_override_flag
      .put(0, 7) // order_hint
    if (size) header.put(size.width - 1, 9).put(size.height - 1, 8)
    return header.put(0, 16).bytes()
  }

  it('reads a keyframe at the sequence’s largest size', () => {
    const packet = concat(obu(SEQUENCE, sequence(320, 180)), obu(FRAME, keyframe()))
    expect(keyframeSize('av1', packet)).toEqual({ width: 320, height: 180 })
  })

  it('reads a keyframe whose size overrides the sequence’s', () => {
    const packet = concat(obu(SEQUENCE, sequence(320, 180)), obu(FRAME, keyframe({ width: 160, height: 90 })))
    expect(keyframeSize('av1', packet)).toEqual({ width: 160, height: 90 })
  })

  it('reads past temporal delimiters and extension headers', () => {
    const ids = { temporal: 0, spatial: 0 }
    const packet = concat(
      obu(TEMPORAL_DELIMITER, new Uint8Array()),
      obu(SEQUENCE, sequence(320, 180)),
      obu(FRAME, keyframe({ width: 32, height: 18 }), ids),
    )
    expect(keyframeSize('av1', packet)).toEqual({ width: 32, height: 18 })
  })

  it('reads the last OBU when it has no size field', () => {
    const frame = obu(FRAME, keyframe({ width: 160, height: 90 }))
    const sizeless = Uint8Array.from([frame[0] & ~2, ...frame.subarray(2)])
    expect(keyframeSize('av1', concat(obu(SEQUENCE, sequence(320, 180)), sizeless))).toEqual({ width: 160, height: 90 })
  })

  it('reads past timing, decoder model and frame id fields', () => {
    const seq = bits()
      .put(0, 3)
      .put(0, 1)
      .put(0, 1)
      .put(1, 1) // timing_info_present_flag
      .put(1001, 32) // num_units_in_display_tick
      .put(30000, 32) // time_scale
      .put(0, 1) // equal_picture_interval: no, so frames carry a presentation time
      .put(1, 1) // decoder_model_info_present_flag
      .put(9, 5) // 10 bits of buffer delay
      .put(1, 32) // num_units_in_decoding_tick
      .put(4, 5) // 5 bits of buffer removal time
      .put(5, 5) // 6 bits of presentation time
      .put(1, 1) // initial_display_delay_present_flag
      .put(1, 5) // two operating points
      .put(0x103, 12) // temporal layers 0 and 1, spatial layer 0
      .put(4, 5) // level 3.0, no tier
      .put(1, 1) // decoder model present for it
      .put(100, 10)
      .put(200, 10)
      .put(0, 1) // decoder and encoder buffer delays, low_delay_mode_flag
      .put(1, 1)
      .put(3, 4) // an initial display delay
      .put(0x102, 12) // temporal layer 1 only, spatial layer 0
      .put(4, 5)
      .put(1, 1)
      .put(100, 10)
      .put(200, 10)
      .put(0, 1)
      .put(0, 1) // no initial display delay
      .put(11, 4) // 12 bits of width
      .put(10, 4) // 11 bits of height
      .put(1919, 12)
      .put(1079, 11)
      .put(1, 1) // frame_id_numbers_present_flag
      .put(5, 4) // delta_frame_id_length_minus_2
      .put(2, 3) // additional_frame_id_length_minus_1: 10 bits of frame id
      .put(0, 3)
      .put(0, 4)
      .put(0, 1) // no order hints
      .put(0, 1) // seq_choose_screen_content_tools
      .put(0, 1) // seq_force_screen_content_tools: off, so no integer mv field
      .put(0, 8)
      .bytes()
    const frame = bits()
      .put(0, 1)
      .put(0, 2)
      .put(1, 1)
      .put(17, 6) // frame_presentation_time
      .put(0, 1) // disable_cdf_update; no screen content tools field
      .put(0x2aa, 10) // current_frame_id
      .put(1, 1) // frame_size_override_flag; no order hint
      .put(1, 1) // buffer_removal_time_present_flag
      .put(5, 5) // for the first operating point, which holds temporal layer 0; not the second
      .put(1279, 12)
      .put(719, 11)
      .put(0, 8)
      .bytes()
    expect(keyframeSize('av1', concat(obu(SEQUENCE, seq), obu(FRAME, frame)))).toEqual({ width: 1280, height: 720 })
  })

  it('reads a hidden keyframe that refreshes some references in an error-resilient stream', () => {
    const frame = bits()
      .put(0, 1)
      .put(0, 2)
      .put(0, 1) // show_frame
      .put(1, 1) // showable_frame
      .put(1, 1) // error_resilient_mode
      .put(0, 1)
      .put(0, 1) // no screen content tools
      .put(1, 1) // frame_size_override_flag
      .put(3, 7) // order_hint
      .put(0x0f, 8) // refresh_frame_flags, not all of them
      .put(0, 7 * 8) // ref_order_hint for each of the 8 references
      .put(99, 9)
      .put(49, 8)
      .put(0, 8)
      .bytes()
    const packet = concat(obu(SEQUENCE, sequence(320, 180)), obu(FRAME, frame))
    expect(keyframeSize('av1', packet)).toEqual({ width: 100, height: 50 })
  })

  it('reads a still picture’s reduced headers', () => {
    const seq = bits()
      .put(0, 3)
      .put(1, 1) // still_picture
      .put(1, 1) // reduced_still_picture_header
      .put(8, 5) // seq_level_idx
      .put(9, 4)
      .put(9, 4)
      .put(639, 10)
      .put(479, 10)
      .put(0, 3)
      .put(0, 8)
      .bytes()
    // disable_cdf_update, allow_screen_content_tools, force_integer_mv; nothing else before the size.
    const frame = bits().put(0, 1).put(1, 1).put(1, 1).put(0, 8).bytes()
    expect(keyframeSize('av1', concat(obu(SEQUENCE, seq), obu(FRAME, frame)))).toEqual({ width: 640, height: 480 })
  })

  it('reads nothing from an inter frame, a repeated frame, or a frame without a sequence header', () => {
    const inter = bits().put(0, 1).put(1, 2).put(1, 1).put(0, 40).bytes()
    const repeated = bits().put(1, 1).put(0, 3).put(0, 40).bytes()
    expect(keyframeSize('av1', concat(obu(SEQUENCE, sequence(320, 180)), obu(FRAME, inter)))).toBeNull()
    expect(keyframeSize('av1', concat(obu(SEQUENCE, sequence(320, 180)), obu(FRAME, repeated)))).toBeNull()
    expect(keyframeSize('av1', obu(FRAME, keyframe()))).toBeNull()
  })
})

describe('keyframeSize, other input', () => {
  const noise = Uint8Array.from({ length: 4096 }, (_, i) => (i * 167 + 13) & 0xff)

  it.each(['vp8', 'vp9', 'av1'] as const)('reads nothing from an empty, cut short or garbled %s packet', (codec) => {
    expect(keyframeSize(codec, new Uint8Array())).toBeNull()
    expect(keyframeSize(codec, Uint8Array.of(0x82))).toBeNull()
    expect(keyframeSize(codec, noise)).toBeNull()
  })

  it('reads nothing from an AV1 OBU whose size runs past the packet', () => {
    expect(keyframeSize('av1', Uint8Array.of((SEQUENCE << 3) | 2, 0xff, 0xff, 0xff, 0xff, 0x0f, 0))).toBeNull()
  })

  it('reads nothing for codecs whose headers it doesn’t read', () => {
    expect(keyframeSize('avc', noise)).toBeNull()
    expect(keyframeSize('hevc', noise)).toBeNull()
  })
})

describe('sizeChanges', () => {
  const size = (width: number, height: number) => ({ width, height })

  it('finds no change in a single size, or none at all', () => {
    expect(sizeChanges([])).toBeNull()
    expect(sizeChanges([size(960, 720)])).toBeNull()
    expect(sizeChanges([size(960, 720), size(960, 720), size(960, 720)])).toBeNull()
  })

  it('counts each change from one keyframe to the next, and finds the smallest and largest', () => {
    const shrinking = [720, 712, 704, 704, 1].map((h) => size(960, h))
    expect(sizeChanges(shrinking)).toEqual({ smallest: size(960, 1), largest: size(960, 720), changes: 3 })
  })

  it('counts a size that comes back as another change', () => {
    const sizes = [size(320, 180), size(160, 90), size(320, 180), size(160, 90)]
    expect(sizeChanges(sizes)).toEqual({ smallest: size(160, 90), largest: size(320, 180), changes: 3 })
  })

  it('compares sizes by area, so a portrait frame can be the largest', () => {
    expect(sizeChanges([size(640, 360), size(360, 1280)])).toMatchObject({ largest: size(360, 1280) })
  })
})
