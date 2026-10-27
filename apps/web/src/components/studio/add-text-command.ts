import type { KimoProject, Op } from '@kimo/client';
import { validateCommands } from '@/lib/editing/commands';
/** Same caption-clean creation contract as the timeline text tool, usable when its panel is collapsed. */
export function addTextAtPlayhead(
  project: KimoProject,
  at: number,
  makeId = () => crypto.randomUUID(),
): { clipId: string; ops: Op[] } {
  if (!Number.isFinite(at)) throw new Error('invalid text position');
  const target = project.tracks.find(
    (track) => track.kind === 'text' && !track.locked,
  );
  const trackId = target?.id ?? makeId(),
    clipId = makeId();
  const ops: Op[] = [
    ...(target
      ? []
      : [
          {
            op: 'track.add' as const,
            track: {
              id: trackId,
              kind: 'text' as const,
              name: 'text',
              height: 48 as const,
              hidden: false,
              muted: false,
              locked: false,
            },
          },
        ]),
    {
      op: 'clip.add',
      clip: {
        id: clipId,
        trackId,
        kind: 'text',
        start: Math.max(0, Math.round(at * project.fps) / project.fps),
        duration: 3,
        in: 0,
        speed: 1,
        transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
        effects: [],
        keyframes: [],
        text: { style: 'caption-clean', content: 'your text' },
      },
    },
  ];
  return { clipId, ops: validateCommands(project, ops) };
}
