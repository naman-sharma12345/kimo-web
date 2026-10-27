'use client';
import * as React from 'react';
import {
  SkipBack,
  StepBack,
  Play,
  Pause,
  StepForward,
  SkipForward,
  Repeat,
  Volume2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { useStudio } from '@/stores/studio';
import { IconButton } from './controls';
export function timecode(seconds: number, fps = 30): string {
  const frames = Math.max(0, Math.round(seconds * fps));
  return [
    Math.floor(frames / fps / 3600),
    Math.floor(frames / fps / 60) % 60,
    Math.floor(frames / fps) % 60,
    frames % fps,
  ]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}
/** Intent state only until Phase 6 consumes it; this component never simulates a compositor. */
export function StudioTransport() {
  const state = useStudio();
  return (
    <div className="studio-transport" aria-label="preview transport">
      <div className="studio-timecode">
        <span>{timecode(state.playhead)}</span>
        <small> / {timecode(state.duration)}</small>
      </div>
      <div className="studio-transport-center">
        <IconButton
          icon={SkipBack}
          label="to start (Home)"
          size="md"
          onClick={() => state.seek(0)}
        />
        <IconButton
          icon={StepBack}
          label="previous frame (←)"
          size="md"
          onClick={() => state.seek(state.playhead - 1 / 30)}
        />
        <Button
          className="studio-play"
          size="lg"
          iconOnly
          aria-label={state.playing ? 'pause preview' : 'play preview'}
          tooltip="play/pause (Space)"
          aria-pressed={state.playing}
          onClick={() => useStudio.setState({ playing: !state.playing })}
        >
          {state.playing ? <Pause /> : <Play />}
        </Button>
        <IconButton
          icon={StepForward}
          label="next frame (→)"
          size="md"
          onClick={() => state.seek(state.playhead + 1 / 30)}
        />
        <IconButton
          icon={SkipForward}
          label="to end (End)"
          size="md"
          onClick={() => state.seek(state.duration)}
        />
      </div>
      <div className="studio-transport-right">
        <IconButton
          icon={Repeat}
          label="loop"
          aria-pressed={state.loop}
          onClick={() => useStudio.setState({ loop: !state.loop })}
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button
              iconOnly
              variant="ghost"
              size="sm"
              aria-label="volume"
              tooltip="volume"
            >
              <Volume2 />
            </Button>
          </PopoverTrigger>
          <PopoverContent>
            <Slider
              aria-label="volume"
              min={0}
              max={1}
              step={0.01}
              value={[state.volume]}
              onValueChange={([volume]) =>
                useStudio.setState({ volume: volume ?? 1 })
              }
            />
          </PopoverContent>
        </Popover>
        <label className="studio-speed">
          <span className="studio-sr">playback speed</span>
          <select
            value={state.speed}
            onChange={(e) =>
              useStudio.setState({ speed: Number(e.target.value) })
            }
          >
            {[0.5, 1, 1.5, 2].map((speed) => (
              <option value={speed} key={speed}>
                {speed}×
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
