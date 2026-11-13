import {
  AdtsOutputFormat,
  FlacOutputFormat,
  MkvOutputFormat,
  MovOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  MpegTsOutputFormat,
  OggOutputFormat,
  WavOutputFormat,
  WebMOutputFormat,
  type OutputFormat,
} from 'mediabunny'
import type { ContainerCodecs, OutputContainer } from '@/lib/containers'

/** Mediabunny's writer for each container. MP4 and MOV written to a stream reserve room for the index
 * at the start; written to memory, they're rearranged at the end (CLAUDE.md). */
export function outputFormat(container: OutputContainer, streaming: boolean): OutputFormat {
  const fastStart = streaming ? 'reserve' : 'in-memory'
  switch (container) {
    case 'mp4':
      return new Mp4OutputFormat({ fastStart })
    case 'mov':
      return new MovOutputFormat({ fastStart })
    case 'mkv':
      return new MkvOutputFormat()
    case 'webm':
      return new WebMOutputFormat()
    case 'mpegts':
      return new MpegTsOutputFormat()
    case 'ogg':
      return new OggOutputFormat()
    case 'mp3':
      return new Mp3OutputFormat()
    case 'flac':
      return new FlacOutputFormat()
    case 'wav':
      return new WavOutputFormat()
    case 'adts':
      return new AdtsOutputFormat()
  }
}

const CONTAINERS: OutputContainer[] = ['mp4', 'mov', 'mkv', 'webm', 'mpegts', 'ogg', 'mp3', 'flac', 'wav', 'adts']

/** What each container can hold, from Mediabunny itself, so there's no second copy of its tables.
 * Plain data, for the planners. */
export const CONTAINER_CODECS: ContainerCodecs = Object.fromEntries(
  CONTAINERS.map((c) => [c, outputFormat(c, false).getSupportedCodecs()]),
) as unknown as ContainerCodecs
