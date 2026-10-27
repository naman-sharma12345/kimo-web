import type { CSSProperties } from 'react';
import type { Clip, KimoProject } from '@kimo/client';
import type { EditingAPI, EditSource } from '@/lib/editing/types';

export interface TextFieldProps {
  editing: EditingAPI;
  clip: Clip;
  field?: 'content' | 'secondaryContent';
  source?: EditSource;
  label?: string;
  autoFocus?: boolean;
  selectAll?: boolean;
  className?: string;
  onFinish?: (reason: 'commit' | 'cancel' | 'removed') => void;
}
export type InspectorTextFieldProps = TextFieldProps;
export type TimelineTextEditorProps = Omit<TextFieldProps, 'source'>;
export interface MeasuredTextRegion {
  /** Pixi-measured local bounds BEFORE clip transform, relative to scene centre. */
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LoadedTextStyle {
  fontFamily: string;
  /** Resolved content pixels, already including text.scale, NOT displayScale. */
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic' | 'oblique';
  lineHeight: number;
  letterSpacing: number;
  color: string;
  textAlign: 'left' | 'center' | 'right';
  textTransform?: CSSProperties['textTransform'];
  WebkitTextStroke?: string;
}
export interface ViewerTextLayout {
  /** Parent must assert loaded fonts and current Pixi measurements before hiding preview. */
  status: 'ready' | 'font-pending' | 'unavailable';
  sceneWidth: number;
  sceneHeight: number;
  displayScale: number;
  letterbox: { x: number; y: number };
  transform: Clip['transform'];
  primary: { bounds: MeasuredTextRegion; style: LoadedTextStyle };
  /** Required to edit lower-third secondary in place; never measured in the DOM. */
  secondary?: { bounds: MeasuredTextRegion; style: LoadedTextStyle };
}
export interface ViewerTextEditorProps {
  editing: EditingAPI;
  clip: Clip;
  layout: ViewerTextLayout;
  active: boolean;
  onTransientHide: (clipId: string, hidden: boolean) => void;
  onFinish?: TextFieldProps['onFinish'];
  restoreFocusRef?: { readonly current: HTMLElement | null };
  onEditIntent?: (
    event: React.PointerEvent<HTMLElement>,
    clipId: string,
    kind: 'move' | 'scale' | 'rotate',
  ) => void;
}
export interface CaptionsEditorProps {
  editing: EditingAPI;
  /** Optional projection from parent. Subscription remains the editing authority. */
  project?: KimoProject;
  trackId?: string;
  playhead: number;
  onSeek: (time: number) => void;
  className?: string;
}
