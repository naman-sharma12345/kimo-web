'use client';
import * as React from 'react';
import type { Asset, KimoProject } from '@kimo/client';
import {
  History,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  ArrowUp,
  Grid3x3,
  ScanEye,
  MousePointer2,
  Scissors,
  MoveHorizontal,
  Type,
  Magnet,
  Link,
  ZoomIn,
  ZoomOut,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Panel } from '@/components/ui/panel';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Segmented, SegmentedItem } from '@/components/ui/segmented';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import { Row } from '@/components/ui/row';
import { useStudio, type StudioTool } from '@/stores/studio';
import { IconButton } from './controls';
import { StudioTransport } from './transport';
export interface StudioSlots {
  viewer?: React.ReactNode;
  transport?: React.ReactNode;
  timeline?: React.ReactNode;
  timelineFooter?: React.ReactNode;
  /** A functional timeline already owns its ruler, scrollbars and footer. */
  timelineOwnsChrome?: boolean;
  inspector?: React.ReactNode;
  agentChat?: React.ReactNode;
  agentActions?: React.ReactNode;
  composer?: React.ReactNode;
}
export function AgentPanel({
  prompt,
  slots,
  composerRef,
  toggle,
  tab,
  setTab,
  watchMode = false,
}: {
  prompt: string;
  slots: StudioSlots;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  toggle: () => void;
  tab: string;
  setTab: (value: string) => void;
  watchMode?: boolean;
}) {
  const state = useStudio();
  const [text, setText] = React.useState('');
  if (state.agentCollapsed && !watchMode)
    return (
      <Panel
        flush
        className="studio-agent studio-agent-rail"
        aria-label="agent panel"
        data-testid="studio-agent"
      >
        <Avatar />
        <span
          className="studio-unread"
          data-unread={state.unread || undefined}
          aria-label={state.unread ? 'unread activity' : 'no unread activity'}
        />
        <IconButton
          icon={PanelLeftOpen}
          label="expand agent"
          onClick={toggle}
        />
      </Panel>
    );
  return (
    <Panel
      flush
      className="studio-agent"
      aria-label="agent panel"
      data-testid="studio-agent"
    >
      <div className="studio-panel-header">
        <Avatar />
        <h2>kimo</h2>
        <span className="studio-flex" />
        <IconButton
          icon={History}
          label="action history"
          onClick={() => setTab('actions')}
        />
        <IconButton
          icon={PanelLeftClose}
          label="collapse agent"
          onClick={toggle}
        />
      </div>
      <Tabs value={tab} onValueChange={setTab} className="studio-agent-tabs">
        <TabsList aria-label="agent activity">
          <TabsTrigger value="chat">chat</TabsTrigger>
          <TabsTrigger value="actions">actions</TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="studio-agent-scroll">
          {prompt ? (
            <article
              className="studio-first-message"
              aria-label="original request"
            >
              <Avatar identity="user" />
              <p>{prompt}</p>
            </article>
          ) : null}
          {slots.agentChat ?? (
            <p className="studio-boundary">
              live conversation connects in Phase 8
            </p>
          )}
        </TabsContent>
        <TabsContent value="actions" className="studio-agent-scroll">
          {slots.agentActions ?? (
            <p className="studio-boundary">
              {state.actionIds.length} actions received this visit · action
              history connects in Phase 8
            </p>
          )}
        </TabsContent>
      </Tabs>
      {slots.composer ?? (
        <div className="studio-composer-wrap">
          {state.agent === 'acting' && (
            <p className="studio-interrupt-hint">
              kimo will stop after the current step and read your note
            </p>
          )}
          <div className="studio-composer">
            <textarea
              ref={composerRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="tell kimo what to change"
              placeholder={
                state.agent === 'acting'
                  ? 'type to interrupt kimo…'
                  : 'tell kimo what to change…'
              }
            />
            <div>
              <IconButton icon={Paperclip} label="attach (Phase 8)" disabled />
              <span className="studio-flex" />
              <Button
                className="studio-send"
                size="md"
                variant="secondary"
                iconOnly
                aria-label="send (Phase 8)"
                tooltip="sending connects in Phase 8"
                disabled
              >
                <ArrowUp />
              </Button>
            </div>
          </div>
          <p className="studio-boundary studio-composer-boundary">
            draft only · sending connects in Phase 8
          </p>
        </div>
      )}
    </Panel>
  );
}
export function ViewerPanel({
  project,
  assets,
  slots,
  viewerRef,
}: {
  project: KimoProject;
  assets: Asset[];
  slots: StudioSlots;
  viewerRef: React.RefObject<HTMLElement | null>;
}) {
  const hasOps = useStudio((s) => s.hasOps);
  const zoom = useStudio((s) => s.viewerZoom);
  const guides = useStudio((s) => s.guides);
  const overlays = useStudio((s) => s.overlays);
  const thumbnail = assets.find(
    (asset) =>
      asset.source === 'user' && (asset.thumbUrl || asset.kind === 'image'),
  );
  return (
    <Panel
      ref={viewerRef}
      flush
      className="studio-viewer"
      aria-label="viewer"
      data-testid="studio-viewer"
    >
      {!hasOps && (
        <div
          className="studio-first-progress"
          role="progressbar"
          aria-label="laying out first cut"
        />
      )}
      <div className="studio-viewer-overlay">
        <span>
          {project.width} × {project.height} · {project.fps} fps
        </span>
        <span className="studio-flex" />
        <Segmented
          value={zoom}
          onValueChange={(value) =>
            useStudio.setState({ viewerZoom: value as 'fit' | '50%' | '100%' })
          }
          aria-label="viewer zoom"
        >
          {['fit', '50%', '100%'].map((value) => (
            <SegmentedItem key={value} value={value}>
              {value}
            </SegmentedItem>
          ))}
        </Segmented>
        <IconButton
          icon={Grid3x3}
          label="safe-area/thirds guides"
          aria-pressed={guides}
          onClick={() => useStudio.setState({ guides: !guides })}
        />
        <IconButton
          icon={ScanEye}
          label="show AI overlays"
          aria-pressed={overlays}
          onClick={() => useStudio.setState({ overlays: !overlays })}
        />
      </div>
      <div className="studio-viewer-frame-area">
        {slots.viewer ?? (
          <div
            className="studio-viewer-frame"
            style={
              {
                aspectRatio: `${project.width}/${project.height}`,
                '--studio-frame-ratio': project.width / project.height,
              } as React.CSSProperties
            }
            data-portrait={project.height > project.width || undefined}
            data-guides={guides || undefined}
            data-zoom={zoom}
            data-ai-overlays={overlays}
          >
            {!hasOps && thumbnail && (
              <img
                className="studio-first-thumbnail"
                src={thumbnail.thumbUrl ?? thumbnail.url}
                alt=""
              />
            )}
            <p>
              {hasOps
                ? 'live preview connects in Phase 6'
                : 'kimo is laying out the first cut…'}
            </p>
          </div>
        )}
      </div>
      {slots.transport ?? <StudioTransport />}
    </Panel>
  );
}
export function InspectorPanel({
  project,
  assets,
  slots,
}: {
  project: KimoProject;
  assets: Asset[];
  slots: StudioSlots;
}) {
  const selection = useStudio((s) => s.selection);
  const follow = useStudio((s) => s.followKimo);
  const clip =
    selection.length === 1 ? project.clips[selection[0] ?? ''] : undefined;
  const asset = assets.find((item) => item.id === clip?.assetId);
  const title =
    selection.length > 1
      ? `${selection.length} clips`
      : clip
        ? `${clip.kind === 'audio' ? 'audio' : clip.kind === 'text' ? 'text' : 'clip'} · ${clip.text?.content ?? asset?.name ?? clip.id}`
        : 'project';
  return (
    <Panel
      flush
      className="studio-inspector"
      aria-label="inspector"
      data-testid="studio-inspector"
    >
      <div className="studio-panel-header">
        <h2 title={title}>{title}</h2>
        <span className="studio-flex" />
        <span className="studio-follow">follow kimo</span>
        <Toggle
          aria-label="follow kimo"
          checked={follow}
          onCheckedChange={(followKimo) => useStudio.setState({ followKimo })}
        />
      </div>
      {slots.inspector ?? (
        <div className="studio-inspector-body">
          <Row label="format" value={`${project.width} × ${project.height}`} />
          <Row label="frame rate" value={`${project.fps} fps`} />
          <p className="studio-boundary">
            {clip ? 'selection properties' : 'project settings'} connect in
            Phase 7
          </p>
        </div>
      )}
    </Panel>
  );
}
export function TimelinePanel({
  project,
  slots,
  toggle,
  zoom,
  onZoomChange,
}: {
  project: KimoProject;
  slots: StudioSlots;
  toggle: () => void;
  zoom?: number | null;
  onZoomChange?: (value: number | null) => void;
}) {
  const state = useStudio();
  const zoomValue = zoom ?? 40;
  const tools = [
    { id: 'select', label: 'select (V)', icon: MousePointer2 },
    { id: 'blade', label: 'blade (B)', icon: Scissors },
    { id: 'slip', label: 'slip (Y)', icon: MoveHorizontal },
    { id: 'text', label: 'add text (T)', icon: Type },
  ] as const;
  return (
    <Panel
      flush
      className="studio-timeline"
      aria-label="timeline"
      data-testid="studio-timeline"
      data-collapsed={state.timelineCollapsed || undefined}
    >
      <div className="studio-timeline-toolbar">
        <Segmented
          aria-label="timeline tool"
          value={state.tool}
          onValueChange={(tool) =>
            useStudio.setState({ tool: tool as StudioTool })
          }
        >
          {tools.map(({ id, label, icon: Icon }) => (
            <SegmentedItem key={id} value={id} aria-label={label}>
              <Icon aria-hidden="true" />
            </SegmentedItem>
          ))}
        </Segmented>
        <i className="studio-divider" />
        <IconButton
          icon={Magnet}
          label="snapping (S)"
          aria-pressed={state.snapping}
          onClick={() => useStudio.setState({ snapping: !state.snapping })}
        />
        <IconButton
          icon={Link}
          label="linked selection"
          aria-pressed={state.linked}
          onClick={() => useStudio.setState({ linked: !state.linked })}
        />
        <span className="studio-tool-hint">
          {state.tool}
          {slots.timelineOwnsChrome ? '' : ' · editing connects in Phase 7'}
        </span>
        <span className="studio-flex" />
        <div className="studio-timeline-zoom">
          <IconButton
            icon={ZoomOut}
            label="zoom out timeline"
            size="xs"
            onClick={() =>
              onZoomChange
                ? onZoomChange(Math.max(4, zoomValue / 1.25))
                : useStudio.setState({
                    zoom: Math.max(0.25, state.zoom - 0.25),
                  })
            }
          />
          <Slider
            aria-label="timeline zoom"
            min={onZoomChange ? 4 : 0.25}
            max={onZoomChange ? 600 : 4}
            step={onZoomChange ? 1 : 0.25}
            value={[onZoomChange ? zoomValue : state.zoom]}
            onValueChange={([value]) =>
              onZoomChange
                ? onZoomChange(value ?? null)
                : useStudio.setState({ zoom: value ?? 1 })
            }
          />
          <IconButton
            icon={ZoomIn}
            label="zoom in timeline"
            size="xs"
            onClick={() =>
              onZoomChange
                ? onZoomChange(Math.min(600, zoomValue * 1.25))
                : useStudio.setState({ zoom: Math.min(4, state.zoom + 0.25) })
            }
          />
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              onZoomChange
                ? onZoomChange(null)
                : useStudio.setState({ zoom: 1 })
            }
          >
            fit
          </Button>
        </div>
        <IconButton
          icon={state.timelineCollapsed ? ChevronUp : ChevronDown}
          label={
            state.timelineCollapsed ? 'expand timeline' : 'collapse timeline'
          }
          size="xs"
          onClick={toggle}
        />
      </div>
      {!state.timelineCollapsed && (
        <>
          {!slots.timelineOwnsChrome && (
            <div className="studio-ruler" aria-label="timeline ruler">
              <span className="studio-track-header" />
              <span>00:00</span>
            </div>
          )}
          <div
            className="studio-timeline-tracks"
            data-editor={slots.timelineOwnsChrome || undefined}
          >
            {slots.timeline ??
              (!state.hasOps ? (
                <div
                  aria-label="loading timeline"
                  className="studio-timeline-skeletons"
                >
                  {[0, 1, 2].map((index) => (
                    <div key={index}>
                      <Skeleton className="studio-track-header" />
                      <Skeleton className="studio-clip-skeleton" />
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div className="studio-track-names">
                    {project.tracks.map((track) => (
                      <div key={track.id}>{track.name}</div>
                    ))}
                  </div>
                  <p className="studio-boundary">
                    timeline editing connects in Phase 7
                  </p>
                </>
              ))}
          </div>
          {!slots.timelineOwnsChrome && (
            <div className="studio-timeline-footer">
              {slots.timelineFooter ?? (
                <div
                  className="studio-minimap"
                  aria-label="timeline scrollbar (Phase 7)"
                >
                  <span />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
