import type { DiscardedTrack, MediaCodec } from 'mediabunny'
import type { OutputContainer } from './containers'
import { codecName, CONTAINER_NAMES } from './info'

/** A track Mediabunny left out of a conversion, as plain data. */
export type Discarded = {
  kind: 'video' | 'audio' | 'subtitle'
  codec: MediaCodec | null
  reason: DiscardedTrack['reason']
  container: OutputContainer
}

/** Why a track was left out, as a sentence for the user; null for tracks the plan left out itself. */
export function discardedSentence({ kind, codec, reason, container }: Discarded): string | null {
  const into = CONTAINER_NAMES[container]
  const what = `${codecName(codec, null)} ${kind}`
  switch (reason) {
    case 'discarded_by_user':
      return null
    case 'cannot_copy':
      return `${into} can’t hold this ${what} without re-encoding it.`
    case 'unknown_source_codec':
      return `Moviola can’t tell which codec this ${kind} track uses, so it can’t copy it.`
    case 'undecodable_source_codec':
      return `This browser can’t decode ${what}.`
    case 'no_encodable_target_codec':
      return `This browser can’t encode any ${kind} codec that ${into} holds.`
    case 'max_track_count_reached':
    case 'max_track_count_of_type_reached':
      return `${into} can’t hold another ${kind} track.`
    case 'unknown_maximum_packet_count':
      return `Moviola couldn’t work out how much room this ${kind} track needs in ${into}.`
  }
}
