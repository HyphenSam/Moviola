/** The eight tools, in rail order (SPEC.md section 6). */
export const TOOLS = [
  { id: 'extract-audio', label: 'Extract audio' },
  { id: 'info', label: 'Media info' },
  { id: 'trim', label: 'Trim' },
  { id: 'container', label: 'Change container' },
  { id: 'remove-audio', label: 'Remove audio' },
  { id: 'compress', label: 'Compress' },
  { id: 'frame', label: 'Grab frame' },
  { id: 'gif', label: 'Make GIF' },
] as const

export type ToolId = (typeof TOOLS)[number]['id']
