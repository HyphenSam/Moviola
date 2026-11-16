/** The save dialog makes an empty file at once. If the job never wrote it, remove it, so a cancelled
 * job leaves nothing behind. A file the user chose to replace still holds its old contents (the
 * stream was aborted, or never opened) and is left alone. `remove()` is Chrome's; elsewhere the empty
 * file stays. */
export async function discard(handle: FileSystemFileHandle) {
  try {
    const removable = handle as FileSystemFileHandle & { remove?: () => Promise<void> }
    if ((await handle.getFile()).size === 0) await removable.remove?.()
  } catch {
    // Nothing more can be done; what became of the job is what the user needs to hear about.
  }
}
