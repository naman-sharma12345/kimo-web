import type { Asset } from '@kimo/client';
export type SendInput = { text: string; attachmentIds?: readonly string[] };
export type MentionClip = { id: string; name: string; thumbUrl?: string };
export type ComposerAttachment = {
  id: string;
  asset?: Asset;
  name: string;
  status: 'uploading' | 'ready' | 'failed';
  progress?: number;
};
export type ComposerSegment =
  | { type: 'text'; text: string }
  | { type: 'mention'; clipId: string; name: string };
export function serializeSegments(
  segments: readonly ComposerSegment[],
): string {
  return segments
    .map((segment) => (segment.type === 'text' ? segment.text : segment.name))
    .join('');
}
export function readSegments(root: HTMLElement): ComposerSegment[] {
  const result: ComposerSegment[] = [];
  const text = (value: string) => {
    if (value) result.push({ type: 'text', text: value });
  };
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      text(node.textContent ?? '');
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.clipId) {
      result.push({
        type: 'mention',
        clipId: node.dataset.clipId,
        name: node.dataset.clipName ?? node.textContent ?? '',
      });
      return;
    }
    if (node.tagName === 'BR') {
      text('\n');
      return;
    }
    if ((node.tagName === 'DIV' || node.tagName === 'P') && result.length)
      text('\n');
    node.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
  return result;
}
export function slashCommand(
  text: string,
): 'pause' | 'resume' | 'undo-last' | 'render' | undefined {
  const command = text.trim();
  if (
    command === '/pause' ||
    command === '/resume' ||
    command === '/undo-last' ||
    command === '/render'
  )
    return command.slice(1) as 'pause' | 'resume' | 'undo-last' | 'render';
}
export function mentionQuery(
  text: string,
): { start: number; query: string } | undefined {
  const match = /(?:^|\s)@([^@\s]*)$/.exec(text);
  if (!match) return;
  return { start: text.lastIndexOf('@'), query: match[1] ?? '' };
}
