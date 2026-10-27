/** Preserve scrollback when an E/double-click intent focuses text. No scrollIntoView. */
export function focusWithoutScroll(element: HTMLElement, selectAll = false) {
  const ancestors: { node: HTMLElement; top: number; left: number }[] = [];
  for (let node = element.parentElement; node; node = node.parentElement)
    ancestors.push({ node, top: node.scrollTop, left: node.scrollLeft });
  element.focus({ preventScroll: true });
  if (selectAll) {
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
    )
      element.select();
    else {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }
  ancestors.forEach(({ node, top, left }) => {
    node.scrollTop = top;
    node.scrollLeft = left;
  });
}
/** Insert plain text at native range without innerHTML or disturbing adjacent text. */
export function insertPlainText(element: HTMLElement, text: string) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer)) return;
  const normalized = text.replace(/\r\n?/gu, '\n');
  // insertText participates in native undo where supported; Range fallback for older/test DOMs.
  if (
    typeof document.execCommand === 'function' &&
    document.execCommand('insertText', false, normalized)
  )
    return;
  range.deleteContents();
  const node = document.createTextNode(normalized);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}
export function editableText(element: HTMLElement) {
  // innerText captures browser-created block/newline structure. textContent is the jsdom fallback.
  return (element.innerText ?? element.textContent ?? '').replace(
    /\r\n?/gu,
    '\n',
  );
}
