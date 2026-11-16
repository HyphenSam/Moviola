import { destination } from './containers'
import { codecName, type MediaInfo } from './info'
import { extensionOf } from './names'
import type { Plan } from './plan'

/** What a plan needs to be checked against: the source's name, container and tracks. A whole
 * MediaInfo will do; `src/media/run.ts` passes one read straight from the file. */
export type PlanSource = Pick<MediaInfo, 'name' | 'container'> & {
  tracks: readonly Pick<MediaInfo['tracks'][number], 'id' | 'kind' | 'codec'>[]
}

/** What's wrong with a plan, as sentences, or nothing. The planners build plans by hand and the worker
 * trusts them, so this catches a plan that contradicts itself or the file before Mediabunny sees it. */
export function planProblems(plan: Plan, source: PlanSource): string[] {
  const problems: string[] = []
  const { video, audio } = plan

  if (video && plan.lossless) problems.push('It says no quality is lost, but it re-encodes the video.')
  if (!video && !audio && !plan.lossless) problems.push('It copies every track, but doesn’t say no quality is lost.')

  if (!plan.keep.length) problems.push('It keeps no tracks.')
  const kept = plan.keep.flatMap((id) => {
    const track = source.tracks.find((t) => t.id === id)
    if (!track) problems.push(`It keeps track ${id}, which isn’t in the file.`)
    return track ? [track] : []
  })
  const keepsVideo = kept.some((t) => t.kind === 'video')
  const keptAudio = kept.find((t) => t.kind === 'audio')
  if (video && !keepsVideo) problems.push('It re-encodes video, but keeps no video track.')
  if (audio && !keptAudio) problems.push('It re-encodes audio, but keeps no audio track.')
  if (plan.kind === 'video' && !keepsVideo) problems.push('It keeps no video track, but says it’s video.')
  if (plan.kind === 'audio' && keepsVideo) problems.push('It keeps a video track, but says it’s audio.')

  // The container's usual extension and type for what it holds, or the source's own extension when
  // it stays in its own container.
  const expected = destination(plan.container, plan.kind, audio?.codec ?? keptAudio?.codec)
  const extension = extensionOf(plan.name)
  const own = plan.container === source.container && extension !== null && extension === extensionOf(source.name)
  if (extension !== expected.extension && !own) {
    problems.push(`Its name, ${plan.name}, should end in .${expected.extension}.`)
  }
  if (plan.mimeType !== expected.mimeType) {
    problems.push(`Its type, ${plan.mimeType}, should be ${expected.mimeType}.`)
  }

  if (video) {
    const { codec, width, height } = video
    if ((width === undefined) !== (height === undefined)) {
      problems.push('It gives the video’s width or height without the other.')
    } else if ((codec === 'avc' || codec === 'hevc') && width !== undefined && (width % 2 || height! % 2)) {
      problems.push(`${codecName(codec, null)} needs an even width and height, not ${width} × ${height}.`)
    }
    if (video.constantBitrate && !video.bitrate) problems.push('It holds the bitrate constant without giving one.')
  }

  if (plan.trim && !(plan.trim.start < plan.trim.end)) problems.push('Its cut doesn’t end after it starts.')
  return problems
}
