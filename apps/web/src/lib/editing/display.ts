import type { Asset, Clip, KimoProject, Track } from '@kimo/client';
export function mainVideoTrack(project: KimoProject): Track | undefined {
  return (
    project.tracks.find(
      (t) => t.kind === 'video' && t.name.trim().toUpperCase() === 'V1',
    ) ?? project.tracks.find((t) => t.kind === 'video')
  );
}
export function displayTracks(project: KimoProject): Track[] {
  const main = mainVideoTrack(project)?.id;
  const rank = (t: Track) =>
    t.kind === 'text'
      ? 0
      : t.kind === 'overlay'
        ? 1
        : t.kind === 'video'
          ? t.id === main
            ? 3
            : 2
          : trackAudioRank(project, t);
  return [...project.tracks].sort((a, b) => rank(a) - rank(b));
}
export function clipLabel(clip: Clip, assets: readonly Asset[] = []): string {
  return (
    clip.text?.content ||
    assets.find((a) => a.id === clip.assetId)?.name ||
    clip.id
  );
}

/** Derived solely from explicit clip roles, never guessed from asset/track names. */
export function trackAudioRole(
  project: KimoProject,
  track: Track,
): 'voice' | 'music' | 'other' | 'mixed' {
  const roles = new Set(
    Object.values(project.clips)
      .filter(
        (clip) =>
          clip.trackId === track.id &&
          (clip.kind === 'audio' || clip.kind === 'video'),
      )
      .map((clip) => clip.audioRole ?? 'other'),
  );
  return roles.size > 1 ? 'mixed' : (roles.values().next().value ?? 'other');
}
function trackAudioRank(project: KimoProject, track: Track): number {
  const role = trackAudioRole(project, track);
  return role === 'voice' ? 4 : role === 'music' ? 5 : 6;
}
export function selectedClips(
  project: KimoProject,
  ids: readonly string[],
): Clip[] {
  return [...new Set(ids)].flatMap((id) => {
    const clip = project.clips[id];
    return clip ? [clip] : [];
  });
}
export function isClipLocked(project: KimoProject, clipId: string): boolean {
  const clip = project.clips[clipId];
  const track = project.tracks.find((item) => item.id === clip?.trackId);
  return !clip || !track || !!clip.locked || track.locked;
}
