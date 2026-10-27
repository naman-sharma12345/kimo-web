import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Resizer } from './controls';

describe('hydration-safe timeline resizer bounds', () => {
  it('matches server markup at first client render then updates to actual viewport height without hydration errors', async () => {
    const original = window.innerHeight;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const recoverable = vi.fn();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      Object.defineProperty(window, 'innerHeight', {
        value: 1080,
        configurable: true,
        writable: true,
      });
      const element = <Resizer panel="timeline" value={280} userKey="test" />;
      const html = renderToString(element);
      expect(html).toContain('aria-valuemax="648"');
      window.innerHeight = 720;
      // The client's initial markup must also remain 648, not read window during render.
      expect(renderToString(element)).toBe(html);
      container.innerHTML = html;
      await act(async () => {
        root = hydrateRoot(container, element, {
          onRecoverableError: recoverable,
        });
      });
      expect(container.querySelector('[role="slider"]')).toHaveAttribute(
        'aria-valuemax',
        '432',
      );
      expect(recoverable).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
      act(() => {
        window.innerHeight = 900;
        window.dispatchEvent(new Event('resize'));
      });
      expect(container.querySelector('[role="slider"]')).toHaveAttribute(
        'aria-valuemax',
        '540',
      );
    } finally {
      act(() => root?.unmount());
      container.remove();
      window.innerHeight = original;
      consoleError.mockRestore();
    }
  });
  it('keeps side bounds fixed and clamps the timeline minimum on resize', () => {
    const original = window.innerHeight;
    try {
      render(
        <>
          <Resizer panel="agent" value={320} userKey="test" />
          <Resizer panel="timeline" value={200} userKey="test" />
        </>,
      );
      act(() => {
        window.innerHeight = 300;
        fireEvent.resize(window);
      });
      expect(
        screen.getByRole('slider', { name: 'resize agent' }),
      ).toHaveAttribute('aria-valuemax', '480');
      expect(
        screen.getByRole('slider', { name: 'resize timeline' }),
      ).toHaveAttribute('aria-valuemax', '200');
    } finally {
      window.innerHeight = original;
    }
  });
});
