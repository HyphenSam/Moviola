import { ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'
import type { PlayerControls } from '@/hooks/usePlayer'
import { cn } from '@/lib/cn'
import { formatTimecode } from '@/lib/timecode'

/** Play/pause, the position, frame steps, and sound when there is any. Sits on the dark stage. */
export function Transport({
  player,
  frameSteps,
  sound,
}: {
  player: PlayerControls
  frameSteps: boolean
  sound: boolean
}) {
  const hours = player.duration >= 3600
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 px-1 text-stage-ink">
      {frameSteps && (
        <StageButton aria-label="Previous frame" onClick={() => player.step(-1)}>
          <ChevronLeft />
        </StageButton>
      )}
      <StageButton aria-label={player.playing ? 'Pause' : 'Play'} onClick={player.toggle}>
        {player.playing ? <Pause /> : <Play />}
      </StageButton>
      {frameSteps && (
        <StageButton aria-label="Next frame" onClick={() => player.step(1)}>
          <ChevronRight />
        </StageButton>
      )}
      <span role="timer" aria-label="Position" className="ml-2 font-mono text-[13px] font-medium whitespace-nowrap">
        {formatTimecode(player.time, { hours })}
        <span className="text-stage-ink-soft"> / {formatTimecode(player.duration, { hours })}</span>
      </span>
      {sound && (
        <div className="ml-auto flex items-center gap-1">
          <StageButton aria-label={player.muted ? 'Unmute' : 'Mute'} onClick={() => player.setMuted(!player.muted)}>
            {player.muted ? <VolumeX /> : <Volume2 />}
          </StageButton>
          <input
            type="range"
            aria-label="Volume"
            min={0}
            max={1}
            step={0.05}
            value={player.muted ? 0 : player.volume}
            onChange={(e) => {
              player.setVolume(Number(e.target.value))
              player.setMuted(false)
            }}
            className="hidden w-24 accent-accent sm:block"
          />
        </div>
      )}
    </div>
  )
}

function StageButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-control text-stage-ink transition-colors duration-150 hover:bg-white/10 [&_svg]:size-[18px] [&_svg]:stroke-[1.75]',
        className,
      )}
      {...props}
    />
  )
}
