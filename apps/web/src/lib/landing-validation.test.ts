import { describe, expect, it } from 'vitest';
import {
  landingLimits,
  validateAttachments,
  fileKind,
} from './landing-validation';
const file = (name = 'clip.mp4', size = 1, type = 'video/mp4') => ({
  name,
  size,
  type,
});
describe('landing attachment validation', () => {
  it('accepts all specified types including extension-only documents', () => {
    const files = [
      file(),
      file('photo', 1, 'image/png'),
      file('song', 1, 'audio/wav'),
      file('paper', 1, 'application/pdf'),
      ...['txt', 'md', 'srt', 'vtt'].map((ext) => file(`notes.${ext}`, 1, '')),
    ];
    expect(validateAttachments([], files).accepted).toEqual(files);
  });
  it('accepts the exact 2 GB boundary but rejects above it', () => {
    expect(
      validateAttachments([], [file('ok', landingLimits.fileBytes)]).accepted,
    ).toHaveLength(1);
    expect(
      validateAttachments([], [file('big', landingLimits.fileBytes + 1)])
        .errors[0],
    ).toBe('big can’t be used: it’s over 2 GB');
  });
  it('enforces count against existing and accepted files', () => {
    expect(
      validateAttachments(
        Array.from({ length: 29 }, () => file()),
        [file(), file()],
      ).accepted,
    ).toHaveLength(1);
  });
  it('enforces the aggregate 5 GB ceiling without rejecting a later small file', () => {
    const result = validateAttachments(
      [file('a', 2 * 1024 ** 3), file('b', 2 * 1024 ** 3)],
      [file('c', 2 * 1024 ** 3), file('d', 1)],
    );
    expect(result.accepted.map((item) => item.name)).toEqual(['d']);
    expect(result.errors).toHaveLength(1);
  });
  it('rejects executables and classifies documents', () => {
    expect(
      validateAttachments([], [file('bad.exe', 1, 'application/octet-stream')])
        .errors,
    ).toHaveLength(1);
    expect(fileKind(file('notes.md', 1, ''))).toBe('doc');
  });
});
