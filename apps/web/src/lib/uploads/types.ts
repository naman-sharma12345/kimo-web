import type { KimoClient, SessionRequest, Upload } from '@kimo/client';
import type { MediaMetadata } from '../media/probe';
export type UploadStatus =
  'queued' | 'probing' | 'uploading' | 'done' | 'error' | 'canceled';
export type MediaKind = 'video' | 'image' | 'audio' | 'doc';
export interface UploadItem {
  localId: string;
  file: File;
  kind: MediaKind;
  status: UploadStatus;
  progress: number;
  bytesSent: number;
  assetId?: string;
  error?: string;
  meta: MediaMetadata;
}
/** Optional abort endpoint proposal: DELETE /v1/uploads/:assetId. */
export type UploadClient = Pick<
  KimoClient,
  'uploads' | 'completeUpload' | 'createSession' | 'session'
> & { abortUpload?: (assetId: string) => Promise<unknown> };
export type PresignedUpload = Upload;
export type StartSessionInput = Omit<SessionRequest, 'assetIds'>;
export interface StoredAttachment {
  localId: string;
  assetId: string;
  name: string;
  size: number;
  kind: MediaKind;
}
export interface UploadSession {
  sessionId: string;
  wsUrl: string;
  prompt: string;
  assetLocalMap: Record<string, string>;
  attachments: StoredAttachment[];
}
