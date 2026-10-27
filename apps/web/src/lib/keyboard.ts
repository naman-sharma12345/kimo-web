export const isAttachShortcut = (
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>,
): boolean => (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'u';

export interface StudioShortcut {
  id: string;
  key: string;
  label: string;
  keys: string[];
  mod?: boolean;
  shift?: boolean;
  whileTyping?: boolean;
}
/** Single source for dispatch and the help dialog. Mod means Command or Control. */
export const studioShortcuts: readonly StudioShortcut[] = [
  { id: 'play', key: ' ', label: 'play/pause', keys: ['Space'] },
  ...(['j', 'k', 'l'] as const).map((key) => ({
    id: `shuttle-${key}`,
    key,
    label: `shuttle ${key}`,
    keys: [key.toUpperCase()],
  })),
  { id: 'frame-back', key: 'ArrowLeft', label: 'previous frame', keys: ['←'] },
  { id: 'frame-next', key: 'ArrowRight', label: 'next frame', keys: ['→'] },
  {
    id: 'second-back',
    key: 'ArrowLeft',
    shift: true,
    label: 'back 1s',
    keys: ['⇧', '←'],
  },
  {
    id: 'second-next',
    key: 'ArrowRight',
    shift: true,
    label: 'forward 1s',
    keys: ['⇧', '→'],
  },
  { id: 'start', key: 'Home', label: 'to start', keys: ['Home'] },
  { id: 'end', key: 'End', label: 'to end', keys: ['End'] },
  ...(['i', 'o', 'v', 'b', 'y', 't', 's'] as const).map((key, index) => ({
    id: key,
    key,
    label:
      [
        'set in range',
        'set out range',
        'select tool',
        'blade tool',
        'slip tool',
        'add text tool',
        'snapping',
      ][index] ?? key,
    keys: [key.toUpperCase()],
  })),
  { id: 'undo', key: 'z', mod: true, label: 'undo', keys: ['⌘', 'Z'] },
  {
    id: 'redo',
    key: 'z',
    mod: true,
    shift: true,
    label: 'redo',
    keys: ['⇧', '⌘', 'Z'],
  },
  ...(['c', 'v', 'd'] as const).map((key, index) => ({
    id: `edit-${key}`,
    key,
    mod: true,
    label: ['copy', 'paste', 'duplicate'][index] ?? key,
    keys: ['⌘', key.toUpperCase()],
  })),
  {
    id: 'delete',
    key: 'Delete',
    label: 'ripple-delete selection',
    keys: ['Delete'],
  },
  {
    id: 'composer',
    key: 'k',
    mod: true,
    whileTyping: true,
    label: 'focus agent composer',
    keys: ['⌘', 'K'],
  },
  {
    id: 'pause-agent',
    key: '.',
    mod: true,
    label: 'pause/resume kimo',
    keys: ['⌘', '.'],
  },
  { id: 'fullscreen', key: 'f', label: 'fullscreen preview', keys: ['F'] },
  { id: 'fit', key: 'z', shift: true, label: 'fit timeline', keys: ['⇧', 'Z'] },
  {
    id: 'help',
    key: '?',
    shift: true,
    label: 'keyboard shortcuts',
    keys: ['?'],
  },
  {
    id: 'submit',
    key: 'Enter',
    mod: true,
    whileTyping: true,
    label: 'send note',
    keys: ['⌘', 'Enter'],
  },
  {
    id: 'escape',
    key: 'Escape',
    whileTyping: true,
    label: 'cancel/close',
    keys: ['Esc'],
  },
];
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    !!target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
    )
  );
}
export function matchStudioShortcut(
  event: KeyboardEvent,
): StudioShortcut | undefined {
  if (event.isComposing || event.altKey || event.defaultPrevented) return;
  const typing = isTypingTarget(event.target);
  return studioShortcuts.find(
    (shortcut) =>
      shortcut.key.toLowerCase() === event.key.toLowerCase() &&
      !!shortcut.mod === (event.metaKey || event.ctrlKey) &&
      (shortcut.id === 'help' || !!shortcut.shift === event.shiftKey) &&
      (!typing || shortcut.whileTyping),
  );
}
export function registerStudioKeyboard(
  run: (id: string) => boolean | undefined,
): () => void {
  const listener = (event: KeyboardEvent) => {
    const shortcut = matchStudioShortcut(event);
    if (shortcut && run(shortcut.id) !== false) event.preventDefault();
  };
  window.addEventListener('keydown', listener);
  return () => window.removeEventListener('keydown', listener);
}
