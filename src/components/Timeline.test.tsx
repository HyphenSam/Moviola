// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TimeRange } from '@/lib/plans/trim'
import { deferred } from '@/lib/testing'
import { Timeline } from './Timeline'

const file = new File(['x'], 'holiday.mp4')

/** An 80 s, 25 fps video on a 400 px strip, with the range when one's given. */
function setup({ range: initial = null, cut = null }: { range?: TimeRange | null; cut?: number | null } = {}) {
  const seeks: number[] = []
  const ranges: TimeRange[] = []
  const thumbnails = vi.fn(async (_file: File, times: number[]) => times.map(() => null))
  function Harness() {
    const [time, setTime] = useState(0)
    const [range, setRange] = useState(initial)
    return (
      <Timeline
        file={file}
        duration={80}
        time={time}
        frameRate={25}
        aspect={16 / 9}
        thumbnails={thumbnails}
        onSeek={(t) => {
          seeks.push(t)
          setTime(t)
        }}
        range={range}
        onRange={(r) => {
          ranges.push(r)
          setRange(r)
        }}
        cut={cut}
      />
    )
  }
  render(<Harness />)
  const strip = screen.getByRole('group', { name: 'Timeline' })
  strip.getBoundingClientRect = () => ({ left: 0, width: 400, top: 0, height: 48 }) as DOMRect
  return { seeks, ranges, strip, thumbnails, user: userEvent.setup() }
}

const playhead = () => screen.getByRole('slider', { name: 'Playhead' })
const inPoint = () => screen.getByRole('slider', { name: 'In point' })
const outPoint = () => screen.getByRole('slider', { name: 'Out point' })

describe('Timeline', () => {
  afterEach(() => vi.restoreAllMocks())

  it('seeks where the strip is clicked, and follows a drag until the pointer is let go', () => {
    const { seeks, strip } = setup()
    fireEvent.pointerDown(strip, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(strip, { clientX: 200, pointerId: 1 })
    fireEvent.pointerUp(strip, { clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(strip, { clientX: 300, pointerId: 1 })
    expect(seeks).toEqual([20, 40])
    expect(playhead()).toHaveAttribute('aria-valuetext', '0:40.000')
  })

  it('has a playhead slider that moves a second with the arrows and five with Shift', async () => {
    const { seeks, user } = setup()
    playhead().focus()
    await user.keyboard('{ArrowRight}{Shift>}{ArrowRight}{/Shift}{ArrowLeft}{End}{Home}')
    expect(seeks).toEqual([1, 6, 5, 80, 0])
    expect(playhead()).toHaveAttribute('aria-valuemax', '80')
  })

  it('shows no range handles unless the tool uses a range', () => {
    setup()
    expect(screen.queryByRole('slider', { name: 'In point' })).not.toBeInTheDocument()
  })

  it('shows the range as two sliders, valued in timecode', () => {
    setup({ range: { start: 10, end: 20 } })
    expect(inPoint()).toHaveAttribute('aria-valuenow', '10')
    expect(inPoint()).toHaveAttribute('aria-valuetext', '0:10.000')
    expect(outPoint()).toHaveAttribute('aria-valuetext', '0:20.000')
  })

  it('moves a handle a frame with the arrows and a second with Shift, and shows its frame', async () => {
    const { ranges, seeks, user } = setup({ range: { start: 10, end: 20 } })
    inPoint().focus()
    await user.keyboard('{ArrowRight}')
    expect(ranges.at(-1)!.start).toBeCloseTo(10.04)
    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}')
    expect(ranges.at(-1)!.start).toBeCloseTo(9.04)
    expect(seeks.at(-1)).toBeCloseTo(9.04)
    outPoint().focus()
    await user.keyboard('{End}')
    expect(ranges.at(-1)).toMatchObject({ end: 80 })
  })

  it('keeps the in point a frame before the out point', async () => {
    const { ranges, user } = setup({ range: { start: 10, end: 10.04 } })
    inPoint().focus()
    await user.keyboard('{ArrowRight}')
    expect(ranges.at(-1)!.start).toBeCloseTo(10)
  })

  it('drags a handle without seeking the strip from under it', () => {
    const { ranges, seeks, strip } = setup({ range: { start: 10, end: 20 } })
    fireEvent.pointerDown(outPoint(), { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(strip, { clientX: 150, pointerId: 1 })
    fireEvent.pointerUp(strip, { pointerId: 1 })
    expect(ranges.at(-1)).toEqual({ start: 10, end: 30 })
    // The playhead follows the handle, so the frame at the cut shows.
    expect(seeks).toEqual([30])
  })

  it('still drags the in point when the range is too short for both grips side by side', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
    // Half a second of 80 s is 2.5 px: the grips sit outside their ends instead of over each other.
    const { ranges, strip } = setup({ range: { start: 10, end: 10.5 } })
    expect(inPoint().style.left).toBe('38px')
    expect(outPoint().style.left).toBe('52.5px')
    fireEvent.pointerDown(inPoint(), { clientX: 45, pointerId: 1 })
    fireEvent.pointerMove(strip, { clientX: 40, pointerId: 1 })
    fireEvent.pointerUp(strip, { pointerId: 1 })
    expect(ranges.at(-1)).toEqual({ start: 8, end: 10.5 })
  })

  it('marks where a fast trim really starts', () => {
    setup({ range: { start: 12.48, end: 20 }, cut: 12 })
    expect(screen.getByRole('img', { name: 'Fast trim starts at 0:12.000' })).toBeInTheDocument()
  })

  it('asks for as many thumbnails as fit the strip, from the middle of each stretch', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
    const { thumbnails } = setup()
    // 16:9 at 48 px high is 85⅓ px wide: five fill 400 px.
    await waitFor(() => expect(thumbnails).toHaveBeenCalledWith(file, [8, 24, 40, 56, 72], 48))
  })
})

describe('Timeline thumbnails', () => {
  afterEach(() => vi.restoreAllMocks())

  const bitmap = () => ({ width: 160, height: 90, close: vi.fn() }) as unknown as ImageBitmap & { close: () => void }

  /** A 16:9 strip 400 px wide, whose thumbnails come from `thumbnails`. */
  function show(thumbnails: (file: File, times: number[]) => Promise<(ImageBitmap | null)[]>, of = file) {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
    const props = {
      duration: 80,
      time: 0,
      frameRate: 25,
      aspect: 16 / 9,
      thumbnails: vi.fn(thumbnails),
      onSeek: () => {},
      range: null,
      onRange: () => {},
      cut: null,
    }
    const view = render(<Timeline file={of} {...props} />)
    return { ...view, props }
  }

  it('frees the thumbnails when it goes', async () => {
    const made = [bitmap(), bitmap()]
    const { props, unmount } = show(async () => made)
    await waitFor(() => expect(props.thumbnails).toHaveBeenCalled())
    await act(async () => {})
    for (const b of made) expect(b.close).not.toHaveBeenCalled()
    unmount()
    for (const b of made) expect(b.close).toHaveBeenCalled()
  })

  it('frees thumbnails that arrive after it has gone', async () => {
    const reply = deferred<(ImageBitmap | null)[]>()
    const { props, unmount } = show(() => reply.promise)
    await waitFor(() => expect(props.thumbnails).toHaveBeenCalled())
    unmount()
    const made = [bitmap(), null]
    await act(async () => reply.resolve(made))
    expect(made[0]!.close).toHaveBeenCalled()
  })

  it('frees the old file’s thumbnails when the file changes', async () => {
    const made = [bitmap()]
    const { props, rerender } = show(async () => made)
    await waitFor(() => expect(props.thumbnails).toHaveBeenCalled())
    await act(async () => {})
    rerender(<Timeline file={new File(['y'], 'beach.mp4')} {...props} />)
    expect(made[0].close).toHaveBeenCalled()
  })
})
