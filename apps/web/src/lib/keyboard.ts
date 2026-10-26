export const isAttachShortcut = (
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>,
): boolean => (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'u';
