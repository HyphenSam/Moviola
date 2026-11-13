/** What Moviola opens (SPEC.md section 3), by MIME type, for the manifest's file handlers. */
export const FILE_TYPES: Record<string, string[]> = {
  'video/mp4': ['.mp4', '.m4v'],
  'video/quicktime': ['.mov'],
  'video/x-matroska': ['.mkv'],
  'video/webm': ['.webm'],
  'video/mp2t': ['.ts', '.m2ts', '.mts'],
  'audio/mpeg': ['.mp3'],
  'audio/mp4': ['.m4a'],
  'audio/wav': ['.wav'],
  'audio/flac': ['.flac'],
  'audio/ogg': ['.ogg', '.opus'],
  'audio/aac': ['.aac'],
}

/** The file input's `accept`: extensions only. Dropped files are tried whatever they're called. */
export const ACCEPT = Object.values(FILE_TYPES).flat().join(',')
