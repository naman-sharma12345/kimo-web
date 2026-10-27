import type { ComponentType } from 'react';
import type { Asset, Clip, KimoProject, Op } from '@kimo/client';
import type { EditingAPI, EditState } from '@/lib/editing/types';

export interface TimelineMediaHandle {
  getFilmstrip?(
    clipId: string,
    widthPx: number,
    signal?: AbortSignal,
  ): Promise<readonly { time: number; blob: Blob; exact?: boolean }[]>;
  getWaveform?(
    clipId: string,
    points: number,
    signal?: AbortSignal,
  ): Promise<Float32Array>;
}
export interface TimelineInlineTextProps {
  clip: Clip;
  editing: EditingAPI;
  onClose: () => void;
}
/** Project-clock detections supplied by the trusted producer adapter, never synthetic markers. */
export interface TimelineBeat {
  clipId: string;
  trackId: string;
  time: number;
}
export interface TimelineEditorProps {
  /** Parent supplies actual projected detections only while the beat toggle is enabled. */
  beats?: readonly TimelineBeat[];
  project: KimoProject;
  assets: readonly Asset[];
  editing: EditingAPI;
  editState: EditState;
  selection: readonly string[];
  setSelection: (ids: string[]) => void;
  /** Explicit track inspection, separate from clip selection. */
  onSelectTrack?: (trackId: string) => void;
  playhead: number;
  onSeek: (time: number) => void;
  onScrubStart: () => void;
  onScrub: (time: number) => void;
  onScrubEnd: () => void;
  /** Actual pixels per second, not the legacy Studio zoom multiplier. null = fit. */
  zoom: number | null;
  onZoomChange?: (pxPerSec: number | null) => void;
  tool: 'select' | 'blade' | 'slip' | 'text';
  snapping: boolean;
  linked: boolean;
  onOpenText: (clipId: string) => void;
  onInspect: (clipId: string, section?: 'speed') => void;
  /** Composer prefill, NOT send. Receives exact @clip_name plus trailing space. */
  onMessage?: (prefill: string) => void;
  onReplace?: (clipId: string) => void;
  onUpload?: (files: readonly File[]) => void | Promise<void>;
  mediaHandle?: TimelineMediaHandle | null;
  onTogglePlayback?: () => void;
  onError?: (message: string) => void;
  activeClipId?: string | null;
  /** Last authoritative agent batch; never infer authorship from project differences. */
  agentChange?: { id: string; ops: readonly Op[] };
  /** Provenance from actual agent/user event metadata; absent means unknown. */
  markerOrigins?: Readonly<Record<string, 'agent' | 'user'>>;
  followKimo?: boolean;
  assetsOpen?: boolean;
  onAssetsOpenChange?: (open: boolean) => void;
  /** Inject the text owner's adapter. No second text transaction implementation here. */
  InlineTextEditor?: ComponentType<TimelineInlineTextProps>;
}
