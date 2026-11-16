import { VideoSample, VideoSampleSink, type InputVideoTrack } from 'mediabunny'
import { BT709, i420Layout } from '@/lib/i420'

// Video encoders are handed RGB frames by Firefox's decoder (always) and by resizing (in both browsers),
// and turn them into YUV themselves. Chrome's do it with BT.709 and say so. Firefox's (159) do it with
// BT.601 whatever the frame's colour space, but report BT.709, which Mediabunny tags the output with;
// and Firefox's `<video>` ignores MP4's `colr` box and plays untagged H.264 as BT.709 anyway. So every
// re-encode in Firefox played 31–52% of pixels off by more than 24 against its source, and no tag could
// mend it. Both browsers' encoders take a YUV frame's samples as they are, so RGB frames are turned into
// BT.709 I420 here first, on the GPU: one draw that packs four bytes to a pixel, and one read back.
// `gpu-scaler.ts` hands its resized frames on through a converter of its own the same way.

const RGB = new Set(['RGBA', 'RGBX', 'BGRA', 'BGRX'])
const isRgb = (sample: VideoSample) => !!sample.format && RGB.has(sample.format)

const VERTEX = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`

// Each pixel holds the next four bytes of the frame, laid out by `i420Layout`: the luma plane, then Cb,
// then Cr, packed tight (Firefox ignores plane strides). Each chroma sample is the mean of the 2 × 2
// pixels it covers.
const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D frame;
uniform ivec2 size;
uniform ivec2 chromaSize;
uniform mat3 matrix;
uniform vec3 offsets;
out vec4 colour;

vec3 rgb(int x, int y) {
  return texelFetch(frame, clamp(ivec2(x, y), ivec2(0), size - 1), 0).rgb;
}
float byteAt(int n) {
  if (n < size.x * size.y) {
    int y = n / size.x;
    return (offsets + matrix * rgb(n - y * size.x, y)).x;
  }
  n -= size.x * size.y;
  int plane = 1;
  if (n >= chromaSize.x * chromaSize.y) {
    n -= chromaSize.x * chromaSize.y;
    plane = 2;
  }
  int y = n / chromaSize.x;
  int x = n - y * chromaSize.x;
  vec3 mean = (rgb(2 * x, 2 * y) + rgb(2 * x + 1, 2 * y) + rgb(2 * x, 2 * y + 1) + rgb(2 * x + 1, 2 * y + 1)) / 4.0;
  return (offsets + matrix * mean)[plane];
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int n = (p.y * ((size.x + 3) / 4) + p.x) * 4;
  colour = vec4(byteAt(n), byteAt(n + 1), byteAt(n + 2), byteAt(n + 3));
}`

function compile(gl: WebGL2RenderingContext, type: GLenum, source: string) {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  return shader
}

/** Turns an RGB texture of `width` × `height` (its first row the picture's top, and no mipmaps
 * needed) into a BT.709 I420 frame with `init`'s timing and its primaries and transfer. */
export type I420Converter = (
  texture: WebGLTexture,
  width: number,
  height: number,
  init: { timestamp: number; duration: number; colorSpace: Pick<VideoColorSpaceInit, 'primaries' | 'transfer'> },
) => VideoFrame

/** A converter drawing with `gl`, or null if its shaders won't build. It keeps its own vertex array,
 * framebuffer and program, and leaves texture unit 0 bound to the texture it was given, so a caller
 * sharing the context sets up its own state before each draw. */
export function i420Converter(gl: WebGL2RenderingContext): I420Converter | null {
  const program = gl.createProgram()
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
  const previous = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null
  gl.useProgram(program)
  gl.uniformMatrix3fv(gl.getUniformLocation(program, 'matrix'), false, BT709.matrix)
  gl.uniform3fv(gl.getUniformLocation(program, 'offsets'), BT709.offsets)
  gl.useProgram(previous)
  const size = gl.getUniformLocation(program, 'size')
  const chromaSize = gl.getUniformLocation(program, 'chromaSize')

  const vertices = gl.createVertexArray()
  gl.bindVertexArray(vertices)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'position')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)

  // Drawn into a texture rather than a canvas, whose alpha would not come back as drawn.
  const framebuffer = gl.createFramebuffer()
  const target = gl.createTexture()
  let drawn = { width: 0, height: 0 }
  let bytes = new Uint8Array(0)

  return (texture, width, height, { timestamp, duration, colorSpace }) => {
    const layout = i420Layout(width, height)
    gl.useProgram(program)
    gl.bindVertexArray(vertices)
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.activeTexture(gl.TEXTURE0)
    if (layout.width !== drawn.width || layout.height !== drawn.height) {
      gl.bindTexture(gl.TEXTURE_2D, target)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, layout.width, layout.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0)
      drawn = layout
      bytes = new Uint8Array(layout.width * layout.height * 4)
    }
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.viewport(0, 0, layout.width, layout.height)
    gl.uniform2i(size, width, height)
    gl.uniform2i(chromaSize, layout.chroma.width, layout.chroma.height)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.readPixels(0, 0, layout.width, layout.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes)
    gl.bindVertexArray(null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    // VideoFrame copies the bytes, so they can be drawn over for the next frame.
    return new VideoFrame(bytes, {
      format: 'I420',
      codedWidth: width,
      codedHeight: height,
      timestamp,
      duration,
      colorSpace: { ...colorSpace, matrix: 'bt709', fullRange: false },
    })
  }
}

type Own = { gl: WebGL2RenderingContext; texture: WebGLTexture; convert: I420Converter }

function create(): Own | null {
  if (typeof OffscreenCanvas === 'undefined') return null
  const gl = new OffscreenCanvas(1, 1).getContext('webgl2', { antialias: false, depth: false, stencil: false })
  const convert = gl && i420Converter(gl)
  if (!gl || !convert) return null
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  // Without mipmaps a texture is incomplete, and reads as black, unless it's told not to use them.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  return { gl, texture, convert }
}

let own: Own | null | undefined

/** The frame as BT.709 I420, or null where it can't be made here (no WebGL 2 in workers). */
function convert(sample: VideoSample): VideoSample | null {
  if (own === undefined) own = create()
  if (!own || own.gl.isContextLost()) return null
  const { gl, texture } = own
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sample.toCanvasImageSource() as TexImageSource)
  const { primaries, transfer } = sample.colorSpace
  const frame = own.convert(texture, sample.displayWidth, sample.displayHeight, {
    timestamp: sample.microsecondTimestamp,
    duration: sample.microsecondDuration,
    colorSpace: { primaries: primaries ?? 'bt709', transfer: transfer ?? 'bt709' },
  })
  return new VideoSample(frame, {
    timestamp: sample.timestamp,
    duration: sample.duration,
    encodeOptions: sample.encodeOptions,
  })
}

/** Mediabunny's `process` for re-encoded video: RGB frames become BT.709 I420 (see the note at the
 * top), and the rest reach the encoder as they are. */
export function asBt709(sample: VideoSample): VideoSample {
  if (!isRgb(sample) || sample.rotation || sample.flip) return sample
  return convert(sample) ?? sample
}

/** Whether the track's decoder hands out RGB frames (Firefox's does; Chrome's give YUV), from its first
 * frame, as the conversion's decoder is set up. */
export async function decodesToRgb(track: InputVideoTrack): Promise<boolean> {
  if (!(await track.canDecode())) return false
  const sample = await new VideoSampleSink(track, { hardwareAcceleration: 'no-preference' }).getSample(
    await track.getFirstTimestamp(),
  )
  if (!sample) return false
  try {
    return isRgb(sample)
  } finally {
    sample.close()
  }
}
