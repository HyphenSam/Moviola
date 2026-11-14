import { registerVideoSampleTransformer, VideoSample, type VideoSampleTransformationDescription } from 'mediabunny'
import { gpuScalable, needsMipmaps, textureCorners } from '@/lib/scale'

// Mediabunny resizes (and bakes in rotation) by drawing each frame on a 2D canvas, past a 2× downscale
// twice. Where frames are decoded on the GPU that round trip is slow in some browsers (about 22 ms a
// frame at 720p in Firefox, against 5 ms for one textured WebGL draw), so plain resizes go through
// WebGL instead. Anything else, or a browser without WebGL 2 in workers, stays with Mediabunny.

const VERTEX = `#version 300 es
in vec2 position;
in vec2 corner;
out vec2 uv;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
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

type Scaler = { gl: WebGL2RenderingContext; canvas: OffscreenCanvas; corners: WebGLBuffer; turn: string }

function compile(gl: WebGL2RenderingContext, type: GLenum, source: string) {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  return shader
}

function create(): Scaler | null {
  if (typeof OffscreenCanvas === 'undefined') return null
  const canvas = new OffscreenCanvas(2, 2)
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false })
  if (!gl) return null
  const program = gl.createProgram()
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
  gl.useProgram(program)

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

  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return { gl, canvas, corners, turn: '' }
}

let scaler: Scaler | null | undefined

function scale(sample: VideoSample, job: VideoSampleTransformationDescription): VideoSample | null {
  if (!gpuScalable(job, { width: sample.squarePixelWidth, height: sample.squarePixelHeight })) return null
  if (scaler === undefined) scaler = create()
  if (!scaler || scaler.gl.isContextLost()) return null
  const { gl, canvas } = scaler

  if (canvas.width !== job.width || canvas.height !== job.height) {
    canvas.width = job.width
    canvas.height = job.height
    gl.viewport(0, 0, job.width, job.height)
  }
  const turn = `${job.rotation} ${job.flip}`
  if (turn !== scaler.turn) {
    gl.bindBuffer(gl.ARRAY_BUFFER, scaler.corners)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(textureCorners(job.rotation, job.flip)))
    scaler.turn = turn
  }
  const mipmaps = needsMipmaps(job.crop.width, job.crop.height, job.width, job.height)

  // Used straight away, as Mediabunny may close a frame it makes for this in the next microtask.
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sample.toCanvasImageSource() as TexImageSource)
  if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

  // A VideoSample made from a canvas copies it into a VideoFrame at once, so the canvas can be reused.
  return new VideoSample(canvas, { timestamp: sample.timestamp, duration: sample.duration, rotation: 0, flip: false })
}

/** Has Mediabunny resize frames with WebGL where it can (see the note at the top). */
export const registerGpuScaler = () => registerVideoSampleTransformer(scale)
