import * as React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouteFocus } from './route-focus';
const route = vi.hoisted(() => ({ value: '/privacy' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.value }));
afterEach(() => {
  route.value = '/privacy';
  vi.useRealTimers();
});
describe('route focus', () => {
  it('focuses the new main heading once and leaves streamed updates alone', () => {
    const view = render(
      <>
        <RouteFocus />
        <main>
          <h1>privacy</h1>
          <button>keep focus</button>
        </main>
      </>,
    );
    expect(screen.getByRole('heading')).toHaveFocus();
    screen.getByRole('button').focus();
    view.rerender(
      <>
        <RouteFocus />
        <main>
          <h1>privacy updated</h1>
          <button>keep focus</button>
        </main>
      </>,
    );
    expect(screen.getByRole('button')).toHaveFocus();
    route.value = '/next';
    view.rerender(
      <>
        <RouteFocus />
        <main>
          <h1>next route</h1>
          <button>keep focus</button>
        </main>
      </>,
    );
    expect(screen.getByRole('heading')).toHaveFocus();
  });
  it('waits for a delayed route and does not steal dialog focus', async () => {
    const view = render(<RouteFocus />);
    await act(async () => {
      view.rerender(
        <>
          <RouteFocus />
          <main>
            <h1>loaded</h1>
          </main>
        </>,
      );
    });
    expect(screen.getByRole('heading')).toHaveFocus();
    view.unmount();
    const dialog = render(
      <>
        <RouteFocus />
        <main>
          <h1>underneath</h1>
        </main>
        <div role="dialog">
          <button>dialog action</button>
        </div>
      </>,
    );
    screen.getByRole('button').focus();
    await act(async () => undefined);
    expect(screen.getByRole('button')).toHaveFocus();
    dialog.unmount();
  });
  it('cleans a waiting route on unmount', async () => {
    vi.useFakeTimers();
    const view = render(<RouteFocus />);
    view.unmount();
    const heading = document.createElement('h1');
    heading.tabIndex = -1;
    heading.dataset.routeFocus = '';
    document.body.append(heading);
    await act(async () => {
      vi.runAllTimers();
    });
    expect(heading).not.toHaveFocus();
    heading.remove();
  });
});
