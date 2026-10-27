'use client';
import * as React from 'react';
import { StudioShell } from '@/components/studio/studio-shell';
import { useStudio } from '@/stores/studio';
import {
  fixtureProject,
  goldenCases,
  maximumSimultaneousVideos,
  type GoldenCase,
} from './fixture';
import { useProject } from '@/stores/project';
export default function CompositorBenchmark() {
  const [config, setConfig] = React.useState<{
    testCase: GoldenCase;
    frame: number;
    overload: boolean;
    debug: boolean;
  }>({ testCase: 'cut', frame: 60, overload: false, debug: true });
  React.useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const selected =
      goldenCases.find((item) => item.id === query.get('case')) ??
      goldenCases[0];
    const frame = Number(query.get('frame') ?? selected.frame);
    setConfig({
      testCase: selected.id,
      frame: Number.isFinite(frame)
        ? Math.max(0, Math.min(359, frame))
        : selected.frame,
      overload: query.get('overload') === '1',
      debug: query.get('debug') !== '0',
    });
  }, []);
  const fixture = React.useMemo(
    () =>
      fixtureProject(
        config.testCase,
        config.overload,
        process.env.NEXT_PUBLIC_KIMO_API ?? 'http://localhost:8787',
      ),
    [config.testCase, config.overload],
  );
  const snapshot = React.useMemo(
    () => ({ status: 'editing' as const, ...fixture }),
    [fixture],
  );
  React.useEffect(() => {
    useStudio.getState().seek(config.frame / 30);
    useStudio.setState({
      guides: config.testCase === 'portrait-overlay',
      selection: config.testCase === 'caption-words' ? ['clip-3-0'] : [],
    });
  }, [config, fixture]);
  return (
    <>
      <StudioShell
        key={fixture.project.id}
        sessionId={fixture.project.id}
        snapshot={snapshot}
        subscribe={false}
      />
      <output
        hidden
        data-testid="compositor-fixture"
        data-clips={Object.keys(fixture.project.clips).length}
        data-tracks={fixture.project.tracks.length}
        data-max-videos={maximumSimultaneousVideos(fixture.project)}
        data-case={config.testCase}
        data-frame={config.frame}
        data-debug={config.debug}
      >
        Synthetic preview only. No server fidelity, GPU presentation, A/V sync
        or hardware benchmark is certified by this fixture.
      </output>
      <button
        className="studio-sr"
        onClick={() => {
          const project = useProject.getState().project;
          if (project?.clips['clip-3-0'])
            useProject.getState().replace({
              ...project,
              version: project.version + 1,
              clips: {
                ...project.clips,
                'clip-3-0': {
                  ...project.clips['clip-3-0'],
                  text: {
                    content: 'updated while fullscreen',
                    style: 'caption-clean',
                  },
                },
              },
            });
        }}
      >
        fixture edit
      </button>
    </>
  );
}
