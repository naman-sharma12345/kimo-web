import * as React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CompositorOverlay,
  bracketPath,
  sourcePolygonTransform,
} from './compositor-overlay';
import { maskEdgePath } from './compositor-mask-edge';
import {
  fixtureProject,
  maximumSimultaneousVideos,
} from '../../app/dev/compositor/fixture';
import { useStudio } from '@/stores/studio';
import {
  createFilmstripCache,
  invertAssetLocalMap,
} from './compositor-filmstrip';
vi.mock('@/lib/media/cache', () => ({
  readMedia: vi.fn(async () => ({
    frames: [new Blob()],
    timelinePeaks: new Float32Array([0.5]),
  })),
  writeMedia: vi.fn(),
}));
afterEach(() => vi.useRealTimers());
describe('Studio overlay and timestamp-honest cache adapters', () => {
  it('keeps fixture at 20 clips / 5 tracks / <=6 decoders and explicit seven-video overload', () => {
    const fixture = fixtureProject();
    expect(Object.keys(fixture.project.clips)).toHaveLength(20);
    expect(fixture.project.tracks).toHaveLength(5);
    expect(maximumSimultaneousVideos(fixture.project)).toBe(3);
    expect(maximumSimultaneousVideos(fixtureProject('cut', true).project)).toBe(
      7,
    );
  });
  it('uses the same fit/rotation/center translation for source_uv mask geometry', () => {
    const { project, assets } = fixtureProject('transform-crop');
    const asset = assets[0];
    expect(sourcePolygonTransform(project, asset, 'clip-0-0', null)).toContain(
      'translate(1080 470) rotate(12) scale(0.8)',
    );
    expect(bracketPath(0, 0, 100, 50, 12)).toContain('M0 12V4Q0 0 4 0H12');
  });
  it('uses only the supplied label/action ID, fades a matching ended overlay and renders real mask edge', () => {
    vi.useFakeTimers();
    useStudio.setState({
      overlays: true,
      guides: true,
      selection: [],
      maskSectionOpen: false,
    });
    const { project } = fixtureProject();
    const action = {
      actionId: 'actual-action',
      ended: false,
      target: {
        clipId: 'clip-0-0',
        previewPolygon: [
          [0, 0],
          [1, 0],
          [1, 1],
        ] as [number, number][],
        coordinateSpace: 'source_uv' as const,
      },
    };
    const { rerender } = render(
      <CompositorOverlay
        project={project}
        scene={null}
        overlay={action}
        maskEdge="M0 0H1"
      />,
    );
    expect(screen.getByText('sam 3.1')).toBeInTheDocument();
    expect(screen.queryByText(/person/)).not.toBeInTheDocument();
    expect(screen.getByTestId('actual-mask-edge')).toBeInTheDocument();
    rerender(
      <CompositorOverlay
        project={project}
        scene={null}
        overlay={{ ...action, ended: true }}
      />,
    );
    act(() => vi.advanceTimersByTime(600));
    expect(screen.queryByText('sam 3.1')).not.toBeInTheDocument();
  });
  it('derives edge segments from actual RGBA mask pixels and supports inversion', () => {
    const resource = {
      key: 'pixels',
      width: 2,
      height: 1,
      source: {
        width: 2,
        height: 1,
        data: new Uint8Array([255, 255, 255, 255, 0, 0, 0, 0]),
      },
    };
    expect(maskEdgePath(resource, 'alpha')).toContain('M0 0V1');
    expect(maskEdgePath(resource, 'alpha', true)).toContain('M0.5 0V1');
  });
  it('inverts localId -> assetId and never turns untimestamped cached frames into fake exact samples', async () => {
    expect(invertAssetLocalMap({ local: 'remote' }).get('remote')).toBe(
      'local',
    );
    const cache = createFilmstripCache({ local: 'remote' });
    const asset = { id: 'remote', url: '/media' };
    const entry = await cache.read('versioned', asset);
    expect(entry?.frames).toBeUndefined();
    expect(entry?.timelinePeaks?.[0]).toBe(0.5);
  });
});
