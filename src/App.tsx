import { Download, X } from 'lucide-react'
import { Tooltip } from 'radix-ui'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
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
import { UpdateBanner } from './components/UpdateBanner'
import { Button } from './components/ui/Button'
import { useEncodable } from './hooks/useEncodable'
import { useInstallPrompt } from './hooks/useInstallPrompt'
import { canSaveToDisk, useJob } from './hooks/useJob'
import { useKeyframe } from './hooks/useKeyframe'
import { usePlayer } from './hooks/usePlayer'
import { usePerSource } from './hooks/usePerSource'
import { useSource, type Source } from './hooks/useSource'
import { defaultTargetMB } from './lib/bitrate'
import { APP_NAME } from './lib/brand'
import { dependsOnEncoders, EVERY_ENCODER, type Capabilities } from './lib/capabilities'
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
import { WORKER_STOPPED, type WorkerCapabilities, type WorkerClient } from './lib/protocol'
import { hasAudio, hasVideo, videoTrack, type MediaInfo } from './lib/info'
import { withinFile } from './lib/timeline'
import { defaultTool, toolStates, type ToolId } from './lib/tools'
import type { OpenFrames } from './media/frames'
import { CONTAINER_CODECS } from './media/formats'

/** Track ids with `id` added or taken out. */
const toggled = (ids: number[], id: number, on: boolean) => (on ? [...ids, id] : ids.filter((i) => i !== id))

/** What one tool puts on the page: its settings, the range the timeline shows (Trim and Make animation's),
 * and its action, if it has one. */
type ToolSetup = {
  view: ReactNode
  range: TimeRange | null
  action: {
    /** The plan in a browser with `caps`; `atSize` is what it can encode at Compress's size. */
    plan: (caps: Capabilities, atSize: Capabilities['encodeVideo']) => Planned<JobPlan>
    verb: string
    doing: string
    /** The result can be as large as the file, so memory matters when it can't be streamed to disk. */
    large: boolean
  } | null
}

/** A range tool's range before the user picks one: Make animation's first five seconds, else the whole file. */
const unpicked = (info: MediaInfo, tool: ToolId) => (tool === 'animation' ? animationRange(info) : wholeFile(info))

/** What the worker said this browser can encode, if it has yet (SPEC.md section 9). */
type EncoderState =
  | { state: 'unknown' }
  | { state: 'known'; value: WorkerCapabilities }
  | { state: 'failed'; message: string }

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
  const [chosenTool, chooseTool] = usePerSource<ToolId>(source)
  // So does Extract audio's track; its format and options carry over to the next file.
  const [chosenTrack, chooseTrack] = usePerSource<number>(source)
  const [audioSettings, setAudioSettings] = useState(DEFAULT_EXTRACT_AUDIO)
  // The range belongs to one file and is shared by the tools that use one (Trim and Make animation);
  // until the user picks one, Trim's is the whole file and Make animation's the first five seconds.
  // Trim's mode carries over to the next file.
  const [pickedRange, pickRange] = usePerSource<TimeRange>(source)
  const [trimMode, setTrimMode] = useState<TrimMode>('fast')
  // Change container's choice carries over to the next file; the tracks unticked there, and the audio
  // tracks Remove audio keeps, belong to one file.
  const [rewrapTo, setRewrapTo] = useState<ContainerChoice | null>(null)
  const [dropped = [], setDropped] = usePerSource<number[]>(source)
  const [keptAudio = [], setKeptAudio] = usePerSource<number[]>(source)
  // Compress's settings carry over to the next file, apart from the target size, which starts at half
  // of each file.
  const [compressSettings, setCompressSettings] = useState(DEFAULT_COMPRESS)
  const [targetMB, setTargetMB] = usePerSource<number>(source)
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
  // What the worker can encode: unknown until it answers (a moment after start-up), then known, or
  // failed until the user tries again. Only a known answer may say "this browser can't encode…".
  const [encoders, setEncoders] = useState<EncoderState>({ state: 'unknown' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    client.capabilities().then(
      (value) => live && setEncoders({ state: 'known', value }),
      (e: unknown) => live && setEncoders({ state: 'failed', message: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      live = false
    }
  }, [client, attempt])
  const retryEncoders = () => {
    setEncoders({ state: 'unknown' })
    setAttempt((a) => a + 1)
  }
  // Before there's an answer the settings are shown as if everything could be encoded, so no choice is
  // disabled or quietly changed on a guess (Precise to Fast, MP3 to Original); the action waits instead
  // (`undecided`, below).
  const saveToDisk = canSaveToDisk()
  const capabilities: Capabilities = {
    saveToDisk,
    ...(encoders.state === 'known' ? encoders.value : EVERY_ENCODER),
  }
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const install = useInstallPrompt()

  const video = source && videoTrack(source.info)
  // The playhead, shared by the player, the timeline and the tools that set times from it.
  const player = usePlayer(source?.id ?? null, source?.info.duration ?? 0, video?.frameRate ?? null)
  const tools = toolStates(source?.info ?? null)

  /** The open file with what its tools are set to: the user's choices for it, else each one's default. */
  const settingsFor = (source: Source) => {
    const { info } = source
    const tool = chosenTool ?? defaultTool(info)
    const trackId = chosenTrack ?? defaultAudioTrack(info)?.id ?? 0
    const problems = formatProblems(info, trackId, capabilities)
    // Precise needs encoders this browser may not have; until it can, Fast is in effect.
    const precise = preciseProblem(info, capabilities)
    const mode: TrimMode = precise ? 'fast' : trimMode
    return {
      source,
      info,
      tool,
      range: pickedRange ?? unpicked(info, tool),
      problems,
      // A format this track can't be converted to (or one that's waiting on the worker) falls back to
      // Original rather than showing a disabled choice as chosen.
      extract: {
        ...audioSettings,
        trackId,
        format: problems[audioSettings.format] ? 'original' : audioSettings.format,
      } as const,
      precise,
      mode,
      // The source's own container can't be chosen; a choice carried over from a file in it falls back.
      rewrap: rewrapTo && rewrapTo !== info.container ? rewrapTo : defaultContainer(info),
      compress: { ...compressSettings, targetMB: targetMB ?? defaultTargetMB(info.size) },
      animation: { ...animationSettings, width: animationWidth(info, animationSettings.width) },
    }
  }
  const file = source && settingsFor(source)
  const toolName = tools.find((t) => t.id === file?.tool)?.label

  // Every write to the range (the timeline's handles, the typed points, "Set to playhead", I and O)
  // comes through here, which keeps it within the file.
  const setRange = useCallback(
    (range: TimeRange) => source && pickRange(withinFile(range, source.info.duration)),
    [source, pickRange],
  )
  const onMark = (end: 'in' | 'out', time: number) =>
    file && setRange({ ...file.range, [end === 'in' ? 'start' : 'end']: time })

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

  const fastVideo = !!file && !!video && file.tool === 'trim' && file.mode === 'fast'
  const keyframe = useKeyframe(client, fastVideo ? file.source.file : null, video?.id ?? null, file?.range.start ?? 0)
  const note = fastVideo ? keyframeNote(file.range.start, keyframe, video.frameRate) : null

  // Compress asks the encoders again at the size it will write (SPEC.md section 9), and can't start
  // until the worker has answered for that size. If the question fails, the 1080p answer stands in
  // and the next change of settings asks again.
  const compressing = file?.tool === 'compress'
  const compressSize =
    file && compressing && video
      ? outputSize(file.info, effectiveCompress(file.info, file.compress, capabilities).resolution)
      : null
  const encodableHere = useEncodable(client, compressSize, compressSettings)
  const compressCaps: Capabilities = {
    ...capabilities,
    encodeVideo: encodableHere.encoders ?? capabilities.encodeVideo,
  }

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

  /** Everything that differs by tool, in one switch: a tool without a case doesn't compile. */
  const setupFor = (file: ReturnType<typeof settingsFor>): ToolSetup => {
    const { info } = file
    switch (file.tool) {
      case 'info':
        return { view: <MediaInfoView info={info} />, range: null, action: null }
      case 'extract-audio': {
        // An audio file is converted, not extracted from (SPEC.md section 6).
        const converting = !hasVideo(info)
        return {
          view: (
            <ExtractAudioView
              info={info}
              settings={file.extract}
              problems={file.problems}
              onChange={({ trackId: id, ...change }) => {
                if (id != null) chooseTrack(id)
                setAudioSettings((s) => ({ ...s, ...change }))
              }}
            />
          ),
          range: null,
          action: {
            plan: (caps) => planExtractAudio(info, file.extract, CONTAINER_CODECS, caps),
            verb: converting ? 'Convert' : 'Extract',
            doing: converting ? 'Converting' : 'Extracting',
            large: true,
          },
        }
      }
      case 'trim':
        return {
          view: (
            <TrimView
              duration={info.duration}
              range={file.range}
              playhead={player.time}
              video={!!video}
              mode={file.mode}
              preciseProblem={file.precise}
              keyframeNote={note}
              onRange={setRange}
              onSeek={player.seek}
              onMode={setTrimMode}
            />
          ),
          range: file.range,
          action: {
            plan: (caps) => planTrim(info, file.range, file.mode, CONTAINER_CODECS, caps),
            verb: 'Trim',
            doing: 'Trimming',
            large: true,
          },
        }
      case 'container':
        return {
          view: (
            <ChangeContainerView
              info={info}
              container={file.rewrap}
              tracks={containerTracks(info, file.rewrap, CONTAINER_CODECS)}
              dropped={dropped}
              note={subtitleNote(info)}
              onContainer={setRewrapTo}
              onTrack={(id, keep) => setDropped(toggled(dropped, id, !keep))}
            />
          ),
          range: null,
          action: {
            plan: () => planChangeContainer(info, file.rewrap, dropped, CONTAINER_CODECS),
            verb: 'Rewrap',
            doing: 'Rewrapping',
            large: true,
          },
        }
      case 'remove-audio':
        return {
          view: (
            <RemoveAudioView
              info={info}
              keep={keptAudio}
              onKeep={(id, keep) => setKeptAudio(toggled(keptAudio, id, keep))}
            />
          ),
          range: null,
          action: {
            plan: () => planRemoveAudio(info, keptAudio, CONTAINER_CODECS),
            verb: 'Remove audio',
            doing: 'Removing audio',
            large: true,
          },
        }
      case 'compress':
        return {
          view: (
            <CompressView
              settings={effectiveCompress(info, file.compress, compressCaps)}
              resolutions={resolutionOptions(info)}
              frameRates={frameRateOptions(info)}
              codecs={codecOptions(compressCaps)}
              hasAudio={hasAudio(info)}
              onChange={({ targetMB: mb, ...change }) => {
                if (mb != null) setTargetMB(mb)
                setCompressSettings((s) => ({ ...s, ...change }))
              }}
            />
          ),
          range: null,
          action: {
            plan: (caps, atSize) =>
              planCompress(info, file.compress, CONTAINER_CODECS, { ...caps, encodeVideo: atSize }),
            verb: 'Compress',
            doing: 'Compressing',
            large: true,
          },
        }
      case 'frame':
        return {
          view: (
            <GrabFrameView
              duration={info.duration}
              playhead={player.time}
              settings={frameSettings}
              webp={capabilities.encodeWebp}
              copyNote={copyNote}
              onStep={player.step}
              onChange={(change) => setFrameSettings((s) => ({ ...s, ...change }))}
            />
          ),
          range: null,
          action: {
            plan: (caps) => planGrabFrame(info, player.time, frameSettings, caps),
            verb: 'Save frame',
            doing: 'Saving frame',
            large: false,
          },
        }
      case 'animation': {
        const gif = file.animation.format === 'gif'
        return {
          view: (
            <AnimationView
              duration={info.duration}
              range={file.range}
              playhead={player.time}
              settings={file.animation}
              widths={widthOptions(info)}
              webp={capabilities.encodeWebp}
              onRange={setRange}
              onSeek={player.seek}
              onChange={(change) => setAnimationSettings((s) => ({ ...s, ...change }))}
            />
          ),
          range: file.range,
          action: {
            plan: (caps) => planAnimation(info, file.range, file.animation, caps),
            verb: gif ? 'Make GIF' : 'Make WebP',
            doing: gif ? 'Making GIF' : 'Making WebP',
            large: false,
          },
        }
      }
    }
  }
  const setup = file && setupFor(file)
  const action = setup?.action ?? null

  /** The chosen tool's plan in a browser with `caps`; `atSize` is what it can encode at Compress's size. */
  const planWith = (caps: Capabilities, atSize = caps.encodeVideo): Planned<JobPlan> | null =>
    action?.plan(caps, atSize) ?? null
  // Without the worker's answer, a plan that would differ between a browser with every encoder and one
  // with none can't be shown either way; one that wouldn't (a copy, or a problem with the file) can.
  const undecided = encoders.state !== 'known' && dependsOnEncoders((e) => planWith({ saveToDisk, ...e }))
  const waiting = undecided || (compressing && encodableHere.pending)
  const planned: Planned<JobPlan> | null = waiting
    ? { problems: [] }
    : planWith(capabilities, compressCaps.encodeVideo)
  // A failed check is said once, in the alert that offers to try again.
  const checking = waiting && encoders.state !== 'failed'
  const encoderError =
    encoders.state !== 'failed'
      ? null
      : encoders.message === WORKER_STOPPED
        ? WORKER_STOPPED
        : 'Moviola couldn’t check what this browser can encode.'
  // A file still opening would replace the source under the job when its probe came back, so the job
  // takes precedence: the last thing asked for wins, as between two opens (SPEC.md section 3).
  const startJob = () => {
    if (!source || !action || !planned?.plan || !idle) return
    cancelOpening()
    void job.start(source.file, planned.plan, action.doing)
  }
  // The progress, or "Cancelling…", stands in for the action.
  const busy = phase === 'running' || phase === 'cancelling'
  const memoryHint =
    source && action?.large && source.info.size > 2_000_000_000 && !canSaveToDisk()
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
          <ToolRail tools={tools} value={file?.tool ?? null} disabled={!source} onChange={chooseTool} />
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
            {setup ? (
              <section aria-labelledby="tool-heading" className="flex flex-col gap-4">
                <h2 id="tool-heading" className="text-sm font-semibold">
                  {toolName}
                </h2>
                {setup.view}
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
                verb={action?.verb ?? ''}
                state={job.state}
                checking={checking}
                hint={memoryHint}
                secondary={
                  file?.tool === 'frame' &&
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
          {/* A worker that stopped fails the open as well, with the same sentence: say it once. */}
          {encoderError && encoderError !== error && (
            <div
              role="alert"
              className="flex items-center gap-3 border-b border-line bg-danger-soft px-4 py-2 text-[13px] text-ink lg:px-5"
            >
              <span className="min-w-0 flex-1">{encoderError}</span>
              {/* Nothing answers once the worker has stopped, so only a reload helps. */}
              {encoderError !== WORKER_STOPPED && (
                <Button size="sm" onClick={retryEncoders}>
                  Try again
                </Button>
              )}
            </div>
          )}
          <Stage
            source={source}
            webCodecs={webCodecs}
            frames={frames}
            player={player}
            thumbnails={client.thumbnails}
            range={setup?.range ?? null}
            cut={note ? keyframe : null}
            onRange={setRange}
            onMark={onMark}
            onBrowse={() => input.current?.click()}
          />
        </main>

        {/* After the settings on narrow screens (DESIGN.md), at the foot of the stage on wide ones. */}
        <ExportsStrip exports={job.exports} note={job.note} onRemove={job.remove} onDownload={job.downloaded} />

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
      <UpdateBanner atStake={{ running: job.state.phase === 'running', undownloaded: job.undownloaded }} />
    </Tooltip.Provider>
  )
}
