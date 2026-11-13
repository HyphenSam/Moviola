import type { OutputContainer } from './containers'

/** A job, as plain data: what the worker should write. Planners make one from the source's
 * MediaInfo and the tool's settings; `src/media/run.ts` turns it into a Mediabunny Conversion.
 * Every track is copied as is (`copy: { mode: 'forced' }`); tools that re-encode add their options
 * here when they arrive. */
export type Plan = {
  /** What the result holds, for the exports strip's icon. */
  kind: 'audio' | 'video'
  container: OutputContainer
  /** The suggested file name, with its extension. */
  name: string
  /** For the save dialog and the downloaded file. */
  mimeType: string
  /** The badge beside the action: nothing is re-encoded. */
  lossless: boolean
  /** The source track ids to copy; every other track is left out. */
  keep: number[]
}

/** A planner's answer: a plan and the caption under the badge, or the reasons the job can't run,
 * each a sentence for the user. */
export type Planned =
  { plan: Plan; caption: string; problems?: never } | { plan?: never; caption?: never; problems: string[] }
