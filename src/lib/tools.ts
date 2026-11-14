import { hasAudio, hasVideo, type MediaInfo } from './info'

/** The eight tools, in rail order (SPEC.md section 6). */
export const TOOLS = [
  { id: 'info', label: 'Media info' },
  { id: 'extract-audio', label: 'Extract audio' },
  { id: 'trim', label: 'Trim' },
  { id: 'container', label: 'Change container' },
  { id: 'remove-audio', label: 'Remove audio' },
  { id: 'compress', label: 'Compress' },
  { id: 'frame', label: 'Grab frame' },
  { id: 'animation', label: 'Make animation' },
] as const

export type ToolId = (typeof TOOLS)[number]['id']

/** A tool as the rail shows it for the open file; `reason` says why it's dimmed. */
export type ToolState = { id: ToolId; label: string; reason: string | null }

const VIDEO_ONLY: ToolId[] = ['container', 'remove-audio', 'compress', 'frame', 'animation']
const NEEDS_AUDIO: ToolId[] = ['extract-audio', 'remove-audio']

export function toolStates(info: MediaInfo | null): ToolState[] {
  const audioOnly = !!info && !hasVideo(info)
  const silent = !!info && !hasAudio(info)
  return TOOLS.map(({ id, label }) => ({
    id,
    label: audioOnly && id === 'extract-audio' ? 'Convert audio' : label,
    reason:
      audioOnly && VIDEO_ONLY.includes(id)
        ? 'This file has no video.'
        : silent && NEEDS_AUDIO.includes(id)
          ? 'This file has no audio track.'
          : null,
  }))
}

/** Media info for a video; for an audio file, the tool that does something with it. */
export const defaultTool = (info: MediaInfo): ToolId => (hasVideo(info) ? 'info' : 'extract-audio')
