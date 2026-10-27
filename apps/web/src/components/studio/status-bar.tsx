'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { Row } from '@/components/ui/row';
import { useStudio } from '@/stores/studio';
export function StudioStatusBar() {
  const state = useStudio();
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
    const start = Date.now();
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [state.sessionId]);
  const elapsed = [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
  return (
    <footer className="studio-statusbar" data-testid="studio-statusbar">
      <div className="studio-metrics">
        <span
          data-warning={
            (state.previewFps !== null && state.previewFps < 30) || undefined
          }
        >
          {state.previewFps === null
            ? 'preview fps unavailable'
            : `preview ${state.previewFps} fps`}
        </span>
        <i>·</i>
        <span>proxies unknown</span>
        <i>·</i>
        <span title="time in this studio visit">session {elapsed}</span>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="xs" className="studio-connection">
            <i data-connected={state.connection === 'connected' || undefined} />
            {state.connection === 'connected'
              ? 'connected'
              : state.connection === 'disconnected'
                ? 'disconnected'
                : 'reconnecting…'}
            {(state.connection === 'connecting' ||
              state.connection === 'reconnecting') && <Spinner />}
          </Button>
        </PopoverTrigger>
        <PopoverContent>
          <Row
            label="latency"
            value={
              state.latencyMs === null ? 'unavailable' : `${state.latencyMs} ms`
            }
          />
          <Row label="WS version" value={state.wsVersion ?? 'unavailable'} />
        </PopoverContent>
      </Popover>
    </footer>
  );
}
