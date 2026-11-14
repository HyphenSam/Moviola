import { Download, X } from 'lucide-react'
import { Tooltip } from 'radix-ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AboutDialog } from './components/AboutDialog'
import { ChangeContainerView } from './components/ChangeContainerView'
import { ExportsStrip } from './components/ExportsStrip'
import { ExtractAudioView } from './components/ExtractAudioView'
import { FileCard } from './components/FileCard'
import { JobAction } from './components/JobAction'
import { Logo } from './components/Logo'
import { MediaInfoView } from './components/MediaInfoView'
import { RemoveAudioView } from './components/RemoveAudioView'
import { Stage } from './components/Stage'
import { ToolRail } from './components/ToolRail'
import { TrimView } from './components/TrimView'
import { Button } from './components/ui/Button'
import { useInstallPrompt } from './hooks/useInstallPrompt'
import { canSaveToDisk, useJob } from './hooks/useJob'
import { useKeyframe } from './hooks/useKeyframe'
import { usePlayer } from './hooks/usePlayer'
import { useSource } from './hooks/useSource'
import { APP_NAME } from './lib/brand'
import type { Capabilities } from './lib/capabilities'
import { cn } from './lib/cn'
import { ACCEPT } from './lib/file-types'
import type { Planned } from './lib/plan'
import {
  containerTracks,
  defaultContainer,
  planChangeContainer,
  subtitleNote,
  type ContainerChoice,
} from './lib/plans/change-container'
import { DEFAULT_EXTRACT_AUDIO, defaultAudioTrack, formatProblems, planExtractAudio } from './lib/plans/extract-audio'
import { planRemoveAudio } from './lib/plans/remove-audio'
import { keyframeNote, planTrim, preciseProblem, wholeFile, type TimeRange, type TrimMode } from './lib/plans/trim'
import type { WorkerCapabilities, WorkerClient } from './lib/protocol'
import { hasVideo, videoTrack } from './lib/info'
import { defaultTool, toolStates, type ToolId } from './lib/tools'
import type { OpenFrames } from './media/frames'
import { CONTAINER_CODECS } from './media/formats'

/** Track ids chosen for one file; another file starts with none. */
type PerFile = { sourceId: number; ids: number[] } | null
const idsFor = (chosen: PerFile, sourceId: number | undefined) =>
  chosen && chosen.sourceId === sourceId ? chosen.ids : []

/** The installed app's file handler hands files over here (manifest `file_handlers`). */
type LaunchQueue = { setConsumer(consumer: (params: { files: readonly { getFile(): Promise<File> }[] }) => void): void }

/**
 * `webCodecs`: whether this browser has VideoDecoder; without it, nothing can be opened.
 * `client`: the worker that probes (and later runs) files. `frames`: decoded frames on the page, for
 * the thumbnail and the fallback preview. Tests pass fakes for both.
 */
export function App({ webCodecs, client, frames }: { webCodecs: boolean; client: WorkerClient; frames: OpenFrames }) {
  const { source, opening, error, open: openSource, dismissError } = useSource(client)
  const job = useJob(client)
  // The chosen tool belongs to one file; a newly opened file starts on its default tool.
  const [choice, setChoice] = useState<{ sourceId: number; tool: ToolId } | null>(null)
  // So does Extract audio's track; its format and options carry over to the next file.
  const [track, setTrack] = useState<{ sourceId: number; id: number } | null>(null)
  const [audioSettings, setAudioSettings] = useState(DEFAULT_EXTRACT_AUDIO)
  // The range belongs to one file and is shared by the tools that use one (Trim, later Make GIF); the
  // whole file until the user picks one. Trim's mode carries over to the next file.
  const [ranged, setRanged] = useState<{ sourceId: number; range: TimeRange } | null>(null)
  const [trimMode, setTrimMode] = useState<TrimMode>('fast')
  // Change container's choice carries over to the next file; the tracks unticked there, and the audio
  // tracks Remove audio keeps, belong to one file.
  const [rewrapTo, setRewrapTo] = useState<ContainerChoice | null>(null)
  const [dropped, setDropped] = useState<PerFile>(null)
  const [keptAudio, setKeptAudio] = useState<PerFile>(null)
  // What the worker can encode. Until it answers (a moment after start-up), nothing is assumed.
  const [encoders, setEncoders] = useState<WorkerCapabilities>({ encodeVideo: {}, encodeAudio: {} })
  useEffect(() => {
    client.capabilities().then(setEncoders, () => {})
  }, [client])
  const capabilities: Capabilities = { saveToDisk: canSaveToDisk(), ...encoders }
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const install = useInstallPrompt()

  const video = source && videoTrack(source.info)
  // The playhead, shared by the player, the timeline and the tools that set times from it.
  const player = usePlayer(source?.id ?? null, source?.info.duration ?? 0, video?.frameRate ?? null)
  const range = source ? (ranged?.sourceId === source.id ? ranged.range : wholeFile(source.info)) : null
  const updateRange = useCallback(
    (change: (range: TimeRange) => TimeRange) =>
      source &&
      setRanged((r) => ({
        sourceId: source.id,
        range: change(r?.sourceId === source.id ? r.range : wholeFile(source.info)),
      })),
    [source],
  )
  const onMark = useCallback(
    (end: 'in' | 'out', time: number) => updateRange((r) => ({ ...r, [end === 'in' ? 'start' : 'end']: time })),
    [updateRange],
  )

  const tools = toolStates(source?.info ?? null)
  const tool = source ? (choice?.sourceId === source.id ? choice.tool : defaultTool(source.info)) : null
  const toolName = tools.find((t) => t.id === tool)?.label

  // Opening another file while a job runs would leave the job writing for a file that's gone.
  const { running, cancel } = job
  const open = useCallback(
    (file: File) => {
      if (running) {
        if (!window.confirm('Cancel the running job and open the new file?')) return
        cancel()
      }
      openSource(file)
    },
    [running, cancel, openSource],
  )

  const trackId =
    source && track?.sourceId === source.id ? track.id : ((source && defaultAudioTrack(source.info)?.id) ?? 0)
  const problems = source ? formatProblems(source.info, trackId, capabilities) : null
  // A format this track can't be converted to (or one that's waiting on the worker) falls back to
  // Original rather than showing a disabled choice as chosen.
  const extractSettings = {
    ...audioSettings,
    trackId,
    format: problems?.[audioSettings.format] ? 'original' : audioSettings.format,
  } as const
  // Precise needs encoders this browser may not have; until it can, Fast is in effect.
  const precise = source ? preciseProblem(source.info, capabilities) : null
  const mode: TrimMode = precise ? 'fast' : trimMode
  const fastVideo = !!source && !!video && tool === 'trim' && mode === 'fast'
  const keyframe = useKeyframe(client, fastVideo ? source.file : null, video?.id ?? null, range?.start ?? 0)
  const note = fastVideo && range ? keyframeNote(range.start, keyframe, video.frameRate) : null

  // The source's own container can't be chosen; a choice carried over from a file in it falls back.
  const rewrap =
    source && rewrapTo && rewrapTo !== source.info.container ? rewrapTo : source && defaultContainer(source.info)
  const droppedIds = idsFor(dropped, source?.id)
  const keptAudioIds = idsFor(keptAudio, source?.id)
  const toggle = (set: typeof setDropped, ids: number[], id: number, on: boolean) =>
    source && set({ sourceId: source.id, ids: on ? [...ids, id] : ids.filter((i) => i !== id) })

  const planned: Planned | null = !source
    ? null
    : tool === 'extract-audio'
      ? planExtractAudio(source.info, extractSettings, CONTAINER_CODECS, capabilities)
      : tool === 'trim'
        ? planTrim(source.info, range!, mode, CONTAINER_CODECS, capabilities)
        : tool === 'container'
          ? planChangeContainer(source.info, rewrap!, droppedIds, CONTAINER_CODECS)
          : tool === 'remove-audio'
            ? planRemoveAudio(source.info, keptAudioIds, CONTAINER_CODECS)
            : null
  // An audio file is converted, not extracted from (SPEC.md section 6).
  const converting = !!source && !hasVideo(source.info)
  const [verb, doing] =
    tool === 'trim'
      ? ['Trim', 'Trimming']
      : tool === 'container'
        ? ['Rewrap', 'Rewrapping']
        : tool === 'remove-audio'
          ? ['Remove audio', 'Removing audio']
          : converting
            ? ['Convert', 'Converting']
            : ['Extract', 'Extracting']
  const memoryHint =
    source && source.info.size > 2_000_000_000 && !canSaveToDisk()
      ? 'The result is held in memory until you download it, so a long file needs plenty of free memory.'
      : null

  // Files dropped anywhere on the window. Always cancel, or the browser opens what's dropped in
  // place of the app.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types ?? []).includes('Files')
    const over = (e: DragEvent) => {
      e.preventDefault()
      if (webCodecs && hasFiles(e)) setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false)
    }
    const drop = (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const dropped = e.dataTransfer?.files?.[0]
      if (webCodecs && dropped) open(dropped)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [webCodecs, open])

  useEffect(() => {
    const queue = (window as Window & { launchQueue?: LaunchQueue }).launchQueue
    if (!webCodecs || !queue) return
    queue.setConsumer(async ({ files }) => {
      if (files[0]) open(await files[0].getFile())
    })
  }, [webCodecs, open])

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex min-h-dvh flex-col lg:grid lg:h-dvh lg:grid-cols-[72px_320px_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)]">
        <header className="flex h-14 items-center justify-between gap-2 border-b border-line bg-panel px-4 lg:col-span-3 lg:px-5">
          <div className="flex items-center gap-2.5">
            <Logo className="size-7" />
            <span className="text-[15px] font-semibold">{APP_NAME}</span>
          </div>
          <div className="flex items-center gap-1">
            {install && (
              <Button size="sm" variant="ghost" onClick={install}>
                <Download />
                Install
              </Button>
            )}
            <AboutDialog />
          </div>
        </header>

        {/* The page's order is desktop's (tools, settings, stage); narrow screens move the stage up. */}
        <nav
          aria-label="Tool rail"
          className="order-3 border-b border-line bg-panel lg:order-none lg:border-r lg:border-b-0"
        >
          <ToolRail
            tools={tools}
            value={tool}
            disabled={!source}
            onChange={(t) => source && setChoice({ sourceId: source.id, tool: t })}
          />
        </nav>

        <aside className="order-4 flex min-h-0 flex-col bg-panel lg:order-none lg:border-r lg:border-line">
          {source && (
            <div className="border-b border-line px-5 py-4">
              <FileCard
                key={source.id}
                file={source.file}
                info={source.info}
                frames={frames}
                onReplace={() => input.current?.click()}
              />
            </div>
          )}
          <div className="flex flex-1 flex-col gap-7 overflow-y-auto px-5 py-6">
            {source ? (
              <section aria-labelledby="tool-heading" className="flex flex-col gap-4">
                <h2 id="tool-heading" className="text-sm font-semibold">
                  {toolName}
                </h2>
                {tool === 'info' ? (
                  <MediaInfoView info={source.info} />
                ) : tool === 'extract-audio' ? (
                  <ExtractAudioView
                    info={source.info}
                    settings={extractSettings}
                    problems={problems!}
                    onChange={({ trackId: id, ...change }) => {
                      if (id != null) setTrack({ sourceId: source.id, id })
                      setAudioSettings((s) => ({ ...s, ...change }))
                    }}
                  />
                ) : tool === 'trim' ? (
                  <TrimView
                    duration={source.info.duration}
                    range={range!}
                    playhead={player.time}
                    video={!!video}
                    mode={mode}
                    preciseProblem={precise}
                    keyframeNote={note}
                    onRange={(r) => updateRange(() => r)}
                    onSeek={player.seek}
                    onMode={setTrimMode}
                  />
                ) : tool === 'container' ? (
                  <ChangeContainerView
                    info={source.info}
                    container={rewrap!}
                    tracks={containerTracks(source.info, rewrap!, CONTAINER_CODECS)}
                    dropped={droppedIds}
                    note={subtitleNote(source.info)}
                    onContainer={setRewrapTo}
                    onTrack={(id, keep) => toggle(setDropped, droppedIds, id, !keep)}
                  />
                ) : tool === 'remove-audio' ? (
                  <RemoveAudioView
                    info={source.info}
                    keep={keptAudioIds}
                    onKeep={(id, keep) => toggle(setKeptAudio, keptAudioIds, id, keep)}
                  />
                ) : (
                  <p className="text-xs text-ink-soft">This tool arrives in a later version.</p>
                )}
              </section>
            ) : (
              <section>
                <h2 className="text-sm font-semibold">No file open</h2>
                <p className="mt-1 text-xs text-ink-soft">
                  {webCodecs
                    ? 'Open a video or audio file to use the tools. Files stay on your device.'
                    : 'This browser can’t run Moviola’s tools.'}
                </p>
              </section>
            )}
          </div>
          {(planned || job.running) && (
            // Pinned at the foot of the column; on narrow screens it sticks to the bottom of the screen.
            <div className="sticky bottom-0 border-t border-line bg-panel px-5 py-4">
              <JobAction
                planned={planned}
                verb={verb}
                running={job.running}
                hint={memoryHint}
                onStart={() => source && planned?.plan && void job.start(source.file, planned.plan, doing)}
                onCancel={job.cancel}
              />
            </div>
          )}
        </aside>

        <main className="order-2 flex min-h-[55dvh] min-w-0 flex-col lg:order-none lg:min-h-0">
          {webCodecs && (
            <>
              <label className="sr-only" htmlFor="choose-file">
                Choose file
              </label>
              <input
                ref={input}
                id="choose-file"
                type="file"
                accept={ACCEPT}
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => {
                  const chosen = e.target.files?.[0]
                  if (chosen) open(chosen)
                  e.target.value = ''
                }}
              />
            </>
          )}
          {opening && (
            <div role="status" className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2 lg:px-5">
              <span aria-hidden="true" className="h-1 w-16 shrink-0 animate-pulse rounded-full bg-accent" />
              <span className="truncate text-xs text-ink-soft">Opening {opening.name}…</span>
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="flex items-center gap-3 border-b border-line bg-danger-soft px-4 py-2 text-[13px] text-ink lg:px-5"
            >
              <span className="min-w-0 flex-1">{error}</span>
              <Button size="sm" variant="ghost" aria-label="Dismiss" onClick={dismissError}>
                <X />
              </Button>
            </div>
          )}
          <Stage
            source={source}
            webCodecs={webCodecs}
            frames={frames}
            player={player}
            thumbnails={client.thumbnails}
            range={tool === 'trim' ? range : null}
            cut={note ? keyframe : null}
            onRange={(r) => updateRange(() => r)}
            onMark={onMark}
            onBrowse={() => input.current?.click()}
          />
          <ExportsStrip exports={job.exports} onRemove={job.remove} />
        </main>

        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none fixed inset-3 z-30 flex items-center justify-center rounded-panel border-2 border-dashed border-accent bg-accent-soft/80 text-base font-semibold text-accent-text backdrop-blur-sm transition-opacity duration-150',
            dragging ? 'opacity-100' : 'opacity-0',
          )}
        >
          Drop to open
        </div>
      </div>
    </Tooltip.Provider>
  )
}
