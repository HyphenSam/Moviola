import { registerVideoSampleTransformer, VideoSample, type VideoSampleTransformationDescription } from 'mediabunny'
import { gpuScalable, needsMipmaps, textureCorners } from '@/lib/scale'
import { i420Converter, type I420Converter } from './i420'

// Mediabunny resizes (and bakes in rotation) by drawing each frame on a 2D canvas, past a 2× downscale
// twice. Where frames are decoded on the GPU that round trip is slow in some browsers (about 22 ms a
// frame at 720p in Firefox, against 5 ms for one textured WebGL draw), so plain resizes go through
// WebGL instead. Anything else, or a browser without WebGL 2 in workers, stays with Mediabunny.
// The resized frame goes on to the encoder as BT.709 I420 made in the same context (`i420.ts` says
// why), which reads back 1.5 bytes a pixel where Mediabunny's copy of a canvas read back 4: drawn
// into a canvas and converted after, Firefox's resized jobs took 2.2 times as long.

const VERTEX = `#version 300 es
in vec2 position;
in vec2 corner;
out vec2 uv;
void main() {
  // Upside down, so the texture's first row is the picture's top, as an uploaded frame's is.
  gl_Position = vec4(position.x, -position.y, 0.0, 1.0);
  uv = corner;
}`

const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 uv;
uniform sampler2D frame;
out vec4 colour;
void main() {
  colour = texture(frame, uv);
}`

type Scaler = {
  gl: WebGL2RenderingContext
  program: WebGLProgram
  frame: WebGLTexture
  scaled: WebGLTexture
  framebuffer: WebGLFramebuffer
  corners: WebGLBuffer
  toI420: I420Converter
  size: string
  turn: string
}

function compile(gl: WebGL2RenderingContext, type: GLenum, source: string) {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  return shader
}

function create(): Scaler | null {
  if (typeof OffscreenCanvas === 'undefined') return null
  const gl = new OffscreenCanvas(1, 1).getContext('webgl2', { antialias: false, depth: false, stencil: false })
  if (!gl) return null
  const program = gl.createProgram()
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT))
  gl.linkProgram(program)
  const toI420 = i420Converter(gl)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) || !toI420) return null

  const attribute = (name: string, data: Float32Array, usage: GLenum) => {
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, data, usage)
    const location = gl.getAttribLocation(program, name)
    gl.enableVertexAttribArray(location)
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)
    return buffer
  }
  // The whole output, as a triangle strip: bottom left, bottom right, top left, top right.
  attribute('position', new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const corners = attribute('corner', new Float32Array(8), gl.DYNAMIC_DRAW)

  const frame = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, frame)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const scaled = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, scaled)
  // Without mipmaps a texture is incomplete, and reads as black, unless it's told not to use them.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  const framebuffer = gl.createFramebuffer()
  return { gl, program, frame, scaled, framebuffer, corners, toI420, size: '', turn: '' }
}

let scaler: Scaler | null | undefined

function scale(sample: VideoSample, job: VideoSampleTransformationDescription): VideoSample | null {
  if (!gpuScalable(job, { width: sample.squarePixelWidth, height: sample.squarePixelHeight })) return null
  if (scaler === undefined) scaler = create()
  if (!scaler || scaler.gl.isContextLost()) return null
  const { gl } = scaler

  // The converter shares the context, so the state this draw needs is set each time.
  gl.useProgram(scaler.program)
  gl.bindFramebuffer(gl.FRAMEBUFFER, scaler.framebuffer)
  gl.activeTexture(gl.TEXTURE0)
  const size = `${job.width} ${job.height}`
  if (size !== scaler.size) {
    gl.bindTexture(gl.TEXTURE_2D, scaler.scaled)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, job.width, job.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, scaler.scaled, 0)
    scaler.size = size
  }
  gl.viewport(0, 0, job.width, job.height)
  const turn = `${job.rotation} ${job.flip}`
  if (turn !== scaler.turn) {
    gl.bindBuffer(gl.ARRAY_BUFFER, scaler.corners)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(textureCorners(job.rotation, job.flip)))
    scaler.turn = turn
  }
  const mipmaps = needsMipmaps(job.crop.width, job.crop.height, job.width, job.height)

  // Used straight away, as Mediabunny may close a frame it makes for this in the next microtask.
  gl.bindTexture(gl.TEXTURE_2D, scaler.frame)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sample.toCanvasImageSource() as TexImageSource)
  if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

  // The sRGB transfer is what Chrome's encoder reported for the RGB frames this drew before.
  const i420 = scaler.toI420(scaler.scaled, job.width, job.height, {
    timestamp: sample.microsecondTimestamp,
    duration: sample.microsecondDuration,
    colorSpace: { primaries: 'bt709', transfer: 'iec61966-2-1' },
  })
  return new VideoSample(i420, { timestamp: sample.timestamp, duration: sample.duration })
}

/** Has Mediabunny resize frames with WebGL where it can (see the note at the top). */
export const registerGpuScaler = () => registerVideoSampleTransformer(scale)
