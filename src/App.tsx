import { Download, X } from 'lucide-react'
import { Tooltip } from 'radix-ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AboutDialog } from './components/AboutDialog'
import { ExportsStrip } from './components/ExportsStrip'
import { ExtractAudioView } from './components/ExtractAudioView'
import { FileCard } from './components/FileCard'
import { JobAction } from './components/JobAction'
import { Logo } from './components/Logo'
import { MediaInfoView } from './components/MediaInfoView'
import { Stage } from './components/Stage'
import { ToolRail } from './components/ToolRail'
import { Button } from './components/ui/Button'
import { useInstallPrompt } from './hooks/useInstallPrompt'
import { canSaveToDisk, useJob } from './hooks/useJob'
import { useSource } from './hooks/useSource'
import { APP_NAME } from './lib/brand'
import { cn } from './lib/cn'
import { ACCEPT } from './lib/file-types'
import type { Planned } from './lib/plan'
import { defaultAudioTrack, planExtractAudio } from './lib/plans/extract-audio'
import type { WorkerClient } from './lib/protocol'
import { defaultTool, toolStates, type ToolId } from './lib/tools'
import type { OpenFrames } from './media/frames'
import { CONTAINER_CODECS } from './media/formats'

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
  // So does Extract audio's track.
  const [track, setTrack] = useState<{ sourceId: number; id: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const install = useInstallPrompt()

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
  const planned: Planned | null =
    source && tool === 'extract-audio' ? planExtractAudio(source.info, { trackId }, CONTAINER_CODECS) : null
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
                    trackId={trackId}
                    onTrackChange={(id) => setTrack({ sourceId: source.id, id })}
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
                verb="Extract"
                running={job.running}
                hint={memoryHint}
                onStart={() => source && planned?.plan && void job.start(source.file, planned.plan, 'Extracting')}
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
          <Stage source={source} webCodecs={webCodecs} frames={frames} onBrowse={() => input.current?.click()} />
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
