import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Video } from '@kimo/client';
import { VideoPlayer } from './video-player';
const video: Video = {
  title: 'server cut',
  url: '/fixture.mp4?signature=actual',
  posterUrl: '/poster.jpg',
  width: 1080,
  height: 1920,
  durationSec: 8,
  sizeBytes: 1024,
};
afterEach(() => vi.restoreAllMocks());
function setup() {
  const view = render(<VideoPlayer video={video} />);
  const media = view.container.querySelector('video');
  if (!media) throw Error('missing media');
  Object.defineProperties(media, {
    duration: { configurable: true, value: 8 },
    paused: { configurable: true, value: true },
    buffered: {
      configurable: true,
      value: { length: 1, start: () => 0, end: () => 4 },
    },
  });
  fireEvent.loadedMetadata(media);
  return { ...view, media };
}
describe('custom media player', () => {
  it('uses actual media events/duration, buffered range, seek, volume and speed', () => {
    const { media, container } = setup();
    expect(media.controls).toBe(false);
    expect(media.src).toContain('?signature=actual');
    expect(screen.getByText('0:00 / 0:08')).toBeTruthy();
    fireEvent.change(screen.getByRole('slider', { name: 'seek' }), {
      target: { value: '6' },
    });
    expect(media.currentTime).toBe(6);
    fireEvent.timeUpdate(media);
    expect(screen.getByText('0:06 / 0:08')).toBeTruthy();
    fireEvent.change(screen.getByRole('slider', { name: 'volume' }), {
      target: { value: '.25' },
    });
    expect(media.volume).toBe(0.25);
    fireEvent.change(screen.getByRole('combobox', { name: 'playback speed' }), {
      target: { value: '1.5' },
    });
    expect(media.playbackRate).toBe(1.5);
    expect(container.querySelector('[data-portrait]')).toBeTruthy();
    fireEvent.ended(media);
    expect(screen.getByRole('button', { name: 'play video' })).toBeTruthy();
  });
  it('clamps J/L, prevents handled key defaults, does not hijack a slider, handles mute and fullscreen capability', async () => {
    const { media } = setup();
    const surface = screen.getByRole('button', { name: /video player\./ });
    fireEvent.keyDown(surface, { key: 'l' });
    expect(media.currentTime).toBe(8);
    fireEvent.keyDown(surface, { key: 'j' });
    expect(media.currentTime).toBe(0);
    fireEvent.keyDown(surface, { key: 'm' });
    expect(media.muted).toBe(true);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'seek' }), {
      key: 'l',
    });
    expect(media.currentTime).toBe(0);
    await act(async () => {
      fireEvent.keyDown(surface, { key: 'f' });
    });
    expect(screen.getByRole('status').textContent).toContain(
      'fullscreen is not available',
    );
  });
  it('reports real play rejection rather than optimistic playing state', async () => {
    const { media } = setup();
    const play = vi.spyOn(media, 'play').mockRejectedValue(Error('blocked'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'play video' }));
    });
    expect(play).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toContain(
      'playback could not start',
    );
    expect(screen.getByRole('button', { name: 'play' })).toBeTruthy();
    fireEvent.error(media);
    expect(screen.getByRole('status').textContent).toContain(
      'could not be loaded',
    );
  });
});
