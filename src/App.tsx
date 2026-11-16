import { Download, X } from 'lucide-react'
import { Tooltip } from 'radix-ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AboutDialog } from './components/AboutDialog'
import { AppLauncher } from './components/AppLauncher'
import { ChangeContainerView } from './components/ChangeContainerView'
import { CompressView } from './components/CompressView'
import { ExportsStrip } from './components/ExportsStrip'
import { ExtractAudioView } from './components/ExtractAudioView'
import { FileCard } from './components/FileCard'
import { AnimationView } from './components/AnimationView'
import { GrabFrameView } from './components/GrabFrameView'
import { JobAction } from './components/JobAction'
import { Logo } from './components/Logo'
import { MediaInfoView } from './components/MediaInfoView'
import { RemoveAudioView } from './components/RemoveAudioView'
import { Stage } from './components/Stage'
import { ThemeMenu } from './components/ThemeMenu'
import { ToolRail } from './components/ToolRail'
import { TrimView } from './components/TrimView'
import { Button } from './components/ui/Button'
import { useEncodable } from './hooks/useEncodable'
import { useInstallPrompt } from './hooks/useInstallPrompt'
import { canSaveToDisk, useJob } from './hooks/useJob'
import { useKeyframe } from './hooks/useKeyframe'
import { usePlayer } from './hooks/usePlayer'
import { useSource } from './hooks/useSource'
import { defaultTargetMB } from './lib/bitrate'
import { APP_NAME } from './lib/brand'
import type { Capabilities } from './lib/capabilities'
import { cn } from './lib/cn'
import { ACCEPT } from './lib/file-types'
import type { JobPlan, Planned } from './lib/plan'
import {
  containerTracks,
  defaultContainer,
  planChangeContainer,
  subtitleNote,
  type ContainerChoice,
} from './lib/plans/change-container'
import {
  codecOptions,
  DEFAULT_COMPRESS,
  effectiveCompress,
  frameRateOptions,
  outputSize,
  planCompress,
  resolutionOptions,
} from './lib/plans/compress'
import { DEFAULT_EXTRACT_AUDIO, defaultAudioTrack, formatProblems, planExtractAudio } from './lib/plans/extract-audio'
import { DEFAULT_FRAME, planGrabFrame } from './lib/plans/grab-frame'
import {
  animationRange,
  animationWidth,
  DEFAULT_ANIMATION,
  planAnimation,
  widthOptions,
} from './lib/plans/make-animation'
import { planRemoveAudio } from './lib/plans/remove-audio'
import { keyframeNote, planTrim, preciseProblem, wholeFile, type TimeRange, type TrimMode } from './lib/plans/trim'
import type { WorkerCapabilities, WorkerClient } from './lib/protocol'
import { hasAudio, hasVideo, videoTrack, type MediaInfo } from './lib/info'
import { defaultTool, toolStates, type ToolId } from './lib/tools'
import type { OpenFrames } from './media/frames'
import { CONTAINER_CODECS } from './media/formats'

/** Track ids chosen for one file; another file starts with none. */
type PerFile = { sourceId: number; ids: number[] } | null
const idsFor = (chosen: PerFile, sourceId: number | undefined) =>
  chosen && chosen.sourceId === sourceId ? chosen.ids : []

/** A range tool's range before the user picks one: Make animation's first five seconds, else the whole file. */
const unpicked = (info: MediaInfo, tool: ToolId | null) =>
  tool === 'animation' ? animationRange(info) : wholeFile(info)

/** The installed app's file handler hands files over here (manifest `file_handlers`). */
type LaunchQueue = { setConsumer(consumer: (params: { files: readonly { getFile(): Promise<File> }[] }) => void): void }

/**
 * `webCodecs`: whether this browser has VideoDecoder; without it, nothing can be opened.
 * `client`: the worker that probes (and later runs) files. `frames`: decoded frames on the page, for
 * the thumbnail and the fallback preview. Tests pass fakes for both.
 */
export function App({ webCodecs, client, frames }: { webCodecs: boolean; client: WorkerClient; frames: OpenFrames }) {
  const { source, opening, error, open: openSource, cancelOpening, dismissError } = useSource(client)
  const job = useJob(client)
  // The chosen tool belongs to one file; a newly opened file starts on its default tool.
  const [choice, setChoice] = useState<{ sourceId: number; tool: ToolId } | null>(null)
  // So does Extract audio's track; its format and options carry over to the next file.
  const [track, setTrack] = useState<{ sourceId: number; id: number } | null>(null)
  const [audioSettings, setAudioSettings] = useState(DEFAULT_EXTRACT_AUDIO)
  // The range belongs to one file and is shared by the tools that use one (Trim and Make animation);
  // until the user picks one, Trim's is the whole file and Make animation's the first five seconds.
  // Trim's mode carries over to the next file.
  const [ranged, setRanged] = useState<{ sourceId: number; range: TimeRange } | null>(null)
  const [trimMode, setTrimMode] = useState<TrimMode>('fast')
  // Change container's choice carries over to the next file; the tracks unticked there, and the audio
  // tracks Remove audio keeps, belong to one file.
  const [rewrapTo, setRewrapTo] = useState<ContainerChoice | null>(null)
  const [dropped, setDropped] = useState<PerFile>(null)
  const [keptAudio, setKeptAudio] = useState<PerFile>(null)
  // Compress's settings carry over to the next file, apart from the target size, which starts at half
  // of each file.
  const [compressSettings, setCompressSettings] = useState(DEFAULT_COMPRESS)
  const [target, setTarget] = useState<{ sourceId: number; mb: number } | null>(null)
  // Grab frame's and Make animation's settings carry over to the next file.
  const [frameSettings, setFrameSettings] = useState(DEFAULT_FRAME)
  const [animationSettings, setAnimationSettings] = useState(DEFAULT_ANIMATION)
  const [copyNote, setCopyNote] = useState<string | null>(null)
  // What came of a copy is news for a moment, not a state the frame stays in.
  useEffect(() => {
    if (!copyNote) return
    const timer = setTimeout(() => setCopyNote(null), 4000)
    return () => clearTimeout(timer)
  }, [copyNote])
  // What the worker can encode. Until it answers (a moment after start-up), nothing is assumed.
  const [encoders, setEncoders] = useState<WorkerCapabilities>({ encodeVideo: {}, encodeAudio: {}, encodeWebp: false })
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
  const tools = toolStates(source?.info ?? null)
  const tool = source ? (choice?.sourceId === source.id ? choice.tool : defaultTool(source.info)) : null
  const toolName = tools.find((t) => t.id === tool)?.label

  const range = source ? (ranged?.sourceId === source.id ? ranged.range : unpicked(source.info, tool)) : null
  const updateRange = useCallback(
    (change: (range: TimeRange) => TimeRange) =>
      source &&
      setRanged((r) => ({
        sourceId: source.id,
        range: change(r?.sourceId === source.id ? r.range : unpicked(source.info, tool)),
      })),
    [source, tool],
  )
  const onMark = useCallback(
    (end: 'in' | 'out', time: number) => updateRange((r) => ({ ...r, [end === 'in' ? 'start' : 'end']: time })),
    [updateRange],
  )

  // Opening another file while a job runs would leave the job writing for a file that's gone. A job
  // whose save dialog is still open counts; one already told to stop needs no second asking. The
  // other way round, starting a job drops a file that is still opening (`startJob`).
  const { cancel } = job
  const { phase } = job.state
  const idle = phase === 'idle'
  const open = useCallback(
    (file: File) => {
      if (phase === 'picking' || phase === 'running') {
        if (!window.confirm('Cancel the running job and open the new file?')) return
        cancel()
      }
      openSource(file)
    },
    [phase, cancel, openSource],
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

  // Compress asks the encoders again at the size it will write (SPEC.md section 9); until the worker
  // answers, the 1080p answer stands in.
  const compressing = !!source && tool === 'compress'
  const targetMB = source ? (target?.sourceId === source.id ? target.mb : defaultTargetMB(source.info.size)) : 0
  const chosenCompress = { ...compressSettings, targetMB }
  const compressSize =
    compressing && video
      ? outputSize(source.info, effectiveCompress(source.info, chosenCompress, capabilities).resolution)
      : null
  const encodableHere = useEncodable(client, compressSize)
  const compressCaps: Capabilities = { ...capabilities, encodeVideo: encodableHere ?? capabilities.encodeVideo }
  const compressNow = source ? effectiveCompress(source.info, chosenCompress, compressCaps) : null

  const animation = source
    ? { ...animationSettings, width: animationWidth(source.info, animationSettings.width) }
    : null
  // Copying needs images on the clipboard, which takes PNG only.
  const canCopy = typeof window.ClipboardItem !== 'undefined' && !!navigator.clipboard?.write
  const copyFrame = () => {
    const frame = source && planGrabFrame(source.info, player.time, DEFAULT_FRAME, capabilities).plan
    if (!frame) return
    // The item takes the image's promise, so the write starts inside the click while the worker draws it.
    const written = job.copy(source.file, frame, (png) =>
      navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]),
    )
    if (!written) return
    setCopyNote(null)
    written.then(
      () => setCopyNote('Copied the frame.'),
      (error: unknown) =>
        setCopyNote(
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'The browser didn’t allow copying to the clipboard. Save the frame instead.'
            : `The frame couldn’t be copied: ${error instanceof Error ? error.message : String(error)}`,
        ),
    )
  }

  const planned: Planned<JobPlan> | null = !source
    ? null
    : tool === 'extract-audio'
      ? planExtractAudio(source.info, extractSettings, CONTAINER_CODECS, capabilities)
      : tool === 'trim'
        ? planTrim(source.info, range!, mode, CONTAINER_CODECS, capabilities)
        : tool === 'container'
          ? planChangeContainer(source.info, rewrap!, droppedIds, CONTAINER_CODECS)
          : tool === 'remove-audio'
            ? planRemoveAudio(source.info, keptAudioIds, CONTAINER_CODECS)
            : tool === 'compress'
              ? planCompress(source.info, chosenCompress, CONTAINER_CODECS, compressCaps)
              : tool === 'frame'
                ? planGrabFrame(source.info, player.time, frameSettings, capabilities)
                : tool === 'animation'
                  ? planAnimation(source.info, range!, animation!, capabilities)
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
          : tool === 'compress'
            ? ['Compress', 'Compressing']
            : tool === 'frame'
              ? ['Save frame', 'Saving frame']
              : tool === 'animation'
                ? animation!.format === 'gif'
                  ? ['Make GIF', 'Making GIF']
                  : ['Make WebP', 'Making WebP']
                : converting
                  ? ['Convert', 'Converting']
                  : ['Extract', 'Extracting']
  // A file still opening would replace the source under the job when its probe came back, so the job
  // takes precedence: the last thing asked for wins, as between two opens (SPEC.md section 3).
  const startJob = () => {
    if (!source || !planned?.plan || !idle) return
    cancelOpening()
    void job.start(source.file, planned.plan, doing)
  }
  // The progress, or "Cancelling…", stands in for the action.
  const busy = phase === 'running' || phase === 'cancelling'
  const memoryHint =
    source && tool !== 'frame' && tool !== 'animation' && source.info.size > 2_000_000_000 && !canSaveToDisk()
      ? 'The result is held in memory until you download it, so a long file needs plenty of free memory.'
      : null

  // Files dropped or pasted anywhere on the window. Always cancel a drop, or the browser opens what's
  // dropped in place of the app. A paste with no files (text into a field) is left alone.
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
    const paste = (e: ClipboardEvent) => {
      const pasted = e.clipboardData?.files?.[0]
      if (webCodecs && pasted) open(pasted)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    window.addEventListener('paste', paste)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
      window.removeEventListener('paste', paste)
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
      <div
        className={cn(
          'flex min-h-dvh flex-col lg:grid lg:h-dvh lg:grid-cols-[72px_320px_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)_auto] lg:pb-0',
          // Room at the foot for the action, which narrow screens fix to the bottom of the screen.
          (planned || busy) && 'pb-[calc(4rem+env(safe-area-inset-bottom))]',
        )}
      >
        {/* Over the rail and settings only, as on the sister sites, so the stage runs the full height. */}
        <header className="flex h-14 items-center justify-between gap-2 border-b border-line bg-panel px-4 lg:col-span-2 lg:row-start-1 lg:border-r lg:px-5">
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
            <ThemeMenu />
            <AboutDialog />
            <AppLauncher />
          </div>
        </header>

        {/* The page's order is desktop's (tools, settings, stage); narrow screens move the stage up. */}
        <nav
          aria-label="Tool rail"
          className="order-3 border-b border-line bg-panel lg:order-none lg:col-start-1 lg:row-span-2 lg:row-start-2 lg:border-r lg:border-b-0"
        >
          <ToolRail
            tools={tools}
            value={tool}
            disabled={!source}
            onChange={(t) => source && setChoice({ sourceId: source.id, tool: t })}
          />
        </nav>

        <aside className="order-4 flex min-h-0 flex-col bg-panel lg:order-none lg:col-start-2 lg:row-span-2 lg:row-start-2 lg:border-r lg:border-line">
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
                ) : tool === 'compress' ? (
                  <CompressView
                    settings={compressNow!}
                    resolutions={resolutionOptions(source.info)}
                    frameRates={frameRateOptions(source.info)}
                    codecs={codecOptions(compressCaps)}
                    hasAudio={hasAudio(source.info)}
                    onChange={({ targetMB: mb, ...change }) => {
                      if (mb != null) setTarget({ sourceId: source.id, mb })
                      setCompressSettings((s) => ({ ...s, ...change }))
                    }}
                  />
                ) : tool === 'frame' ? (
                  <GrabFrameView
                    duration={source.info.duration}
                    playhead={player.time}
                    settings={frameSettings}
                    webp={capabilities.encodeWebp}
                    copyNote={copyNote}
                    onStep={player.step}
                    onChange={(change) => setFrameSettings((s) => ({ ...s, ...change }))}
                  />
                ) : tool === 'animation' ? (
                  <AnimationView
                    duration={source.info.duration}
                    range={range!}
                    playhead={player.time}
                    settings={animation!}
                    widths={widthOptions(source.info)}
                    webp={capabilities.encodeWebp}
                    onRange={(r) => updateRange(() => r)}
                    onSeek={player.seek}
                    onChange={(change) => setAnimationSettings((s) => ({ ...s, ...change }))}
                  />
                ) : null}
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
          {(planned || busy) && (
            // Pinned at the foot of the column; on narrow screens the action itself is fixed to the bottom
            // of the screen, and what explains it stays here.
            <div className="px-5 pb-4 lg:sticky lg:bottom-0 lg:border-t lg:border-line lg:bg-panel lg:pt-4">
              <JobAction
                planned={planned}
                verb={verb}
                state={job.state}
                hint={memoryHint}
                secondary={
                  tool === 'frame' &&
                  canCopy &&
                  planned?.plan && (
                    <Button onClick={copyFrame} disabled={!idle}>
                      Copy
                    </Button>
                  )
                }
                onStart={startJob}
                onCancel={job.cancel}
              />
            </div>
          )}
        </aside>

        <main className="order-2 flex min-h-[55dvh] min-w-0 flex-col lg:order-none lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:min-h-0">
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
            range={tool === 'trim' || tool === 'animation' ? range : null}
            cut={note ? keyframe : null}
            onRange={(r) => updateRange(() => r)}
            onMark={onMark}
            onBrowse={() => input.current?.click()}
          />
        </main>

        {/* After the settings on narrow screens (DESIGN.md), at the foot of the stage on wide ones. */}
        <ExportsStrip exports={job.exports} note={job.note} onRemove={job.remove} />

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
