import * as React from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { LiveAnnouncer } from './live-announcer';
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe('one polite source live region', () => {
  it('announces exact action label and latest wins at the 3 second boundary', () => {
    const view = render(
      <LiveAnnouncer action={{ id: 'a1', label: 'trimming beach_02' }} />,
    );
    const region = view.container.querySelector('[aria-live="polite"]');
    expect(region).toHaveTextContent('kimo is trimming beach_02');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    view.rerender(
      <LiveAnnouncer action={{ id: 'a2', label: 'moving beach_02' }} />,
    );
    act(() => vi.advanceTimersByTime(1000));
    view.rerender(
      <LiveAnnouncer
        action={{ id: 'a3', label: 'grading colour on beach_02' }}
      />,
    );
    act(() => vi.advanceTimersByTime(1999));
    expect(region).toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(1));
    expect(region).toHaveTextContent('kimo is grading colour on beach_02');
    expect(view.container.querySelectorAll('[aria-live]')).toHaveLength(1);
  });
  it('cancels stale pending actions after end and on unmount', () => {
    const view = render(
      <LiveAnnouncer action={{ id: '1', label: 'trimming' }} />,
    );
    view.rerender(<LiveAnnouncer action={{ id: '2', label: 'moving' }} />);
    view.rerender(<LiveAnnouncer action={null} />);
    act(() => vi.advanceTimersByTime(3000));
    expect(view.container).not.toHaveTextContent('moving');
    view.rerender(<LiveAnnouncer action={{ id: '3', label: 'grading' }} />);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('announces completed message once per id, not repeated rerenders', () => {
    const view = render(
      <LiveAnnouncer message={{ id: 'm1', text: 'ready for review' }} />,
    );
    expect(view.container).toHaveTextContent('ready for review');
    view.rerender(
      <LiveAnnouncer
        message={{ id: 'm1', text: 'ready for review' }}
        action={{ id: 'a1', label: 'trimming' }}
      />,
    );
    act(() => vi.advanceTimersByTime(3000));
    expect(view.container).toHaveTextContent('kimo is trimming');
    view.rerender(
      <LiveAnnouncer
        message={{ id: 'm1', text: 'ready for review' }}
        action={null}
      />,
    );
    act(() => vi.advanceTimersByTime(3000));
    expect(view.container).toHaveTextContent('');
  });
});
