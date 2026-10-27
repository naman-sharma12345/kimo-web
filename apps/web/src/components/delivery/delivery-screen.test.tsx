import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Video } from '@kimo/client';
import { DeliveryScreen } from './delivery-screen';
const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => mocks }));
vi.mock('./video-player', () => ({
  VideoPlayer: () => <div>actual player tested separately</div>,
}));
const video: Video = {
  title: 'Server / title',
  url: '/fixture.mp4?signed=a%2Fb&x=1',
  posterUrl: '/poster.jpg',
  width: 1920,
  height: 1080,
  durationSec: 8,
  sizeBytes: 1024,
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('delivery actions and capability boundaries', () => {
  it('uses server title, signed anchor download and does not invent metadata or edit expiry', () => {
    render(<DeliveryScreen videoId="v" video={video} />);
    expect(screen.getByRole('heading', { name: video.title })).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'download mp4' }).getAttribute('href'),
    ).toBe(video.url);
    expect(
      screen
        .getByRole('link', { name: 'download mp4' })
        .getAttribute('download'),
    ).toBe('server-title-kimo-1080p.mp4');
    expect(screen.getByRole('button', { name: 'edit again' })).toBeDisabled();
    expect(screen.queryByText('this edit has expired')).toBeNull();
    expect(screen.getByText(/action history is not available/)).toBeTruthy();
    expect(screen.queryByText(/models used:/)).toBeNull();
  });
  it('only reports clipboard success after actual success and exposes encoded gesture-only fallback sharing', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi
          .fn()
          .mockRejectedValueOnce(Error('denied'))
          .mockResolvedValueOnce(undefined),
      },
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    render(<DeliveryScreen videoId="v" video={video} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'copy link' }));
    });
    expect(screen.getByRole('status').textContent).toBe('unable to copy link');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'copy link' }));
    });
    expect(screen.getByRole('status').textContent).toBe('link copied');
    fireEvent.click(screen.getByRole('button', { name: 'share' }));
    expect(
      screen.getByRole('link', { name: 'WhatsApp' }).getAttribute('href'),
    ).toContain(encodeURIComponent(window.location.href));
  });
  it('does not claim native share cancellation is success or open a fallback', async () => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi
        .fn()
        .mockRejectedValue(new DOMException('cancelled', 'AbortError')),
    });
    render(<DeliveryScreen videoId="v" video={video} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'share' }));
    });
    expect(screen.queryByRole('link', { name: 'WhatsApp' })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
  });
});
