export const landingLimits = {
  fileBytes: 2 * 1024 ** 3,
  totalBytes: 5 * 1024 ** 3,
  files: 30,
  characters: 4000,
} as const;
export const fileAccept =
  'video/*,image/*,audio/*,application/pdf,.txt,.md,.srt,.vtt';
export function fileKind(
  file: Pick<File, 'type' | 'name'>,
): 'video' | 'image' | 'audio' | 'doc' {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'doc';
}
export function validateAttachments<
  T extends Pick<File, 'name' | 'type' | 'size'>,
>(
  existing: readonly T[],
  incoming: readonly T[],
): { accepted: T[]; errors: string[] } {
  const accepted: T[] = [];
  const errors: string[] = [];
  let total = existing.reduce((sum, file) => sum + file.size, 0);
  for (const file of incoming) {
    let reason = '';
    if (existing.length + accepted.length >= landingLimits.files)
      reason = 'you can add up to 30 files';
    else if (file.size > landingLimits.fileBytes) reason = 'it’s over 2 GB';
    else if (
      !/^(video|image|audio)\//.test(file.type) &&
      file.type !== 'application/pdf' &&
      !/\.(txt|md|srt|vtt)$/i.test(file.name)
    )
      reason = 'that file type isn’t supported yet';
    else if (total + file.size > landingLimits.totalBytes)
      reason = 'your files are over 5 GB in total';
    if (reason) errors.push(`${file.name} can’t be used: ${reason}`);
    else {
      accepted.push(file);
      total += file.size;
    }
  }
  return { accepted, errors };
}
export const samplePrompts = [
  'a 30 second reel of my trip to manali, upbeat, with captions',
  'turn this podcast clip into three vertical shorts',
  'product launch video for my sneakers, cinematic, 45 seconds',
  'cut my vlog, remove the ums, add a calm lofi track',
] as const;
