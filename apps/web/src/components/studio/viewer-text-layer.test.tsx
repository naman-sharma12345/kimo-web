import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { buildScene, type MeasuredTextOverlayBounds } from '@kimo/compositor';
import { setupText } from './text-editing/test-helpers';
import { ViewerTextLayer } from './viewer-text-layer';
const mocks = vi.hoisted(() => ({ measure: vi.fn() }));
vi.mock('@kimo/compositor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kimo/compositor')>()),
  measureTextOverlay: mocks.measure,
}));
const measured: MeasuredTextOverlayBounds = {
  x: -500,
  y: -100,
  width: 1000,
  height: 150,
  words: [],
  status: 'ready',
  primary: {
    bounds: { x: -100, y: -50, width: 200, height: 80 },
    style: {
      fontFamily: 'Geist',
      fontSize: 40,
      fontWeight: 500,
      fontStyle: 'normal',
      lineHeight: 43,
      letterSpacing: 0,
      color: 'white',
      textAlign: 'center',
    },
  },
};
beforeEach(() => {
  vi.clearAllMocks();
});
function mount() {
  const h = setupText(),
    hide = vi.fn(),
    finish = vi.fn();
  const scene = buildScene(h.project, 0);
  const view = render(
    <ViewerTextLayer
      clipId="t"
      project={h.project}
      scene={scene}
      editing={h.editing}
      displayScale={0.5}
      onTransientHide={hide}
      onFinish={finish}
    />,
  );
  return { ...h, hide, finish, view };
}
it('uses the independent measured primary geometry, not the combined box, and hides only after loaded-font readiness', async () => {
  mocks.measure.mockResolvedValue(measured);
  const h = mount();
  try {
    const field = await screen.findByRole('textbox', {
      name: 'viewer text content',
    });
    expect(field).toHaveStyle({
      width: '200px',
      fontSize: '40px',
      lineHeight: '43px',
    });
    expect(h.hide).toHaveBeenCalledWith('t', true);
    h.view.unmount();
    expect(h.hide).toHaveBeenLastCalledWith('t', false);
    expect(h.ops).not.toHaveBeenCalled();
  } finally {
    h.view.unmount();
    h.editing.dispose();
  }
});
it('keeps canvas text visible for font-pending geometry', async () => {
  mocks.measure.mockResolvedValue({ ...measured, status: 'font-pending' });
  const h = mount();
  try {
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('waiting for font'),
    );
    expect(h.hide).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('textbox', { name: 'viewer text content' }),
    ).not.toBeInTheDocument();
  } finally {
    h.view.unmount();
    h.editing.dispose();
  }
});
it('shows an explicit layout boundary when measurement fails and never substitutes estimated bounds', async () => {
  mocks.measure.mockRejectedValue(new Error('font metrics unavailable'));
  const h = mount();
  try {
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'text layout unavailable',
      ),
    );
    expect(h.hide).not.toHaveBeenCalled();
    expect(h.ops).not.toHaveBeenCalled();
  } finally {
    h.view.unmount();
    h.editing.dispose();
  }
});
