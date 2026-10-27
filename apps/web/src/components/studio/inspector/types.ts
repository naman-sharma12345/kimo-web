import type { Asset, KimoProject } from '@kimo/client';
import type { EditingAPI, EditState } from '@/lib/editing/types';
export type LUTName = 'warm film' | 'teal & orange' | 'bleach' | 'mono';
export type Availability = { available: false; reason: string };
export interface PropertyActivity {
  clipId: string;
  property: string;
  actionId: string;
  running: boolean;
}
export interface MeterSample {
  /** Actual linear peak amplitudes at existing output, not clip gain. */
  channels: readonly number[];
  playing: boolean;
}
export type LevelMeterAPI =
  | Availability
  | {
      available: true;
      /** Master output, not isolated clip output. clipId is adapter context only. */
      measure(clipId: string): MeterSample;
      subscribe(listener: () => void): () => void;
    };
export interface InspectorEditorProps {
  project: KimoProject;
  assets: readonly Asset[];
  editing: EditingAPI;
  editState: EditState;
  selection: readonly string[];
  playhead: number;
  propertyActivity?: readonly PropertyActivity[];
  onMaskOpen?: (open: boolean) => void;
  onMessage?: (text: string, clipId: string) => void | Promise<void>;
  onReplace?: (
    clipId: string,
    mode: 'search' | 'upload',
  ) => void | Promise<void>;
  compare?:
    | Availability
    | {
        available: true;
        enabled: boolean;
        onChange(enabled: boolean, clipId: string): void;
      };
  levelMeter?: LevelMeterAPI;
  audioCapabilities?: (clipId: string) => {
    keepPitch: boolean;
    reason?: string;
  };
  lutAssets?: Partial<Record<LUTName, string>>;
  maskPreview?: { clipId: string; cutoutUrl?: string; subjectLabel?: string };
  onReframeRequest?: (
    size: Pick<KimoProject, 'width' | 'height'>,
  ) => void | Promise<void>;
  onSeek?: (time: number) => void;
  captionTrackId?: string;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}
