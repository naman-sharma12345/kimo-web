'use client';
import * as React from 'react';
import type { Asset, KimoProject, ServerEvent } from '@kimo/client';
import {
  CompositorController,
  videoCache,
  retainCompositorMediaOwnership,
  type ControllerMetrics,
  type ActionOverlay,
  type SceneGraph,
} from '@kimo/compositor';
import { useProject } from '@/stores/project';
import { useSession } from '@/stores/session';
import { createFilmstripCache } from './compositor-filmstrip';
import { useStudio, canPlayPreview, type StudioState } from '@/stores/studio';
import { CompositorOverlay } from './compositor-overlay';
import {
  CompositorFullscreenControls,
  useCompositorFullscreen,
} from './compositor-fullscreen';
import styles from './compositor.module.css';
import { maskEdgePath } from './compositor-mask-edge';
import { previewFailure } from './preview-failure';
import { useViewerTransform } from './viewer-transform';
import type { EditingAPI } from '@/lib/editing/types';
import { ViewerTextLayer } from './viewer-text-layer';
export interface StudioCompositorHandle {
  getFilmstrip?: CompositorController['getFilmstrip'];
  getWaveform?: CompositorController['getWaveform'];
  getAudioLevel?: CompositorController['getAudioLevel'];
  getAudioCapabilities?: CompositorController['getAudioCapabilities'];
  getCompareCapability?: CompositorController['getCompareCapability'];
  setEditingTextClip?: CompositorController['setEditingTextClip'];
  subscribeAudioLevel?: (listener: () => void) => () => void;
  event: (event: ServerEvent) => void;
  assets: (assets: readonly Asset[]) => void;
}
function transport(state: StudioState) {
  const {
    playing,
    speed,
    volume,
    loop,
    inPoint,
    outPoint,
    scrubbing,
    scrubAudioEnabled,
    followKimo,
    shuttle,
  } = state;
  const playable = canPlayPreview(state.previewStatus);
  return {
    playing: playing && playable,
    speed,
    volume,
    loop,
    inPoint,
    outPoint,
    scrubbing: scrubbing && playable,
    scrubAudioEnabled: scrubAudioEnabled && playable,
    followKimo,
    shuttle: playable ? shuttle : 0,
  };
}
export function observeCompositor(
  controller: CompositorController,
): () => void {
  let intent = transport(useStudio.getState());
  controller.setTransport(intent, useStudio.getState().playhead);
  const stopProject = useProject.subscribe((state, previous) => {
    if (state.project && state.project !== previous.project)
      controller.updateProject(state.project);
  });
  const stopStudio = useStudio.subscribe((state, previous) => {
    const next = transport(state);
    const seek = state.seekRevision !== previous.seekRevision;
    if (
      seek ||
      Object.keys(next).some(
        (key) =>
          next[key as keyof typeof next] !== intent[key as keyof typeof intent],
      )
    ) {
      intent = next;
      controller.setTransport(next, seek ? state.playhead : undefined);
    }
  });
  return () => {
    stopProject();
    stopStudio();
  };
}
export function StudioCompositor({
  project,
  assets,
  bridgeRef,
  debug = false,
  editing,
  onOpenText,
  activeTextId,
  onTextFinish,
}: {
  project: KimoProject;
  assets: Asset[];
  bridgeRef: React.RefObject<StudioCompositorHandle | null>;
  debug?: boolean;
  editing?: EditingAPI | null;
  onOpenText?: (clipId: string) => void;
  activeTextId?: string | null;
  onTextFinish?: () => void;
}) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const host = React.useRef<HTMLDivElement>(null);
  const controller = React.useRef<CompositorController | null>(null);
  const lastSceneAt = React.useRef(-Infinity);
  const audioListeners = React.useRef(new Set<() => void>());
  const lastMaskIdentity = React.useRef('');
  const reducedFade = React.useRef<Animation | null>(null);
  const initial = React.useRef({ project, assets });
  const [metrics, setMetrics] = React.useState<ControllerMetrics | null>(null);
  const [overlay, setOverlay] = React.useState<ActionOverlay | null>(null);
  const [editAt, setEditAt] = React.useState<{
    actionId: string;
    time: number;
  } | null>(null);
  const [scene, setScene] = React.useState<SceneGraph | null>(null);
  const [maskEdge, setMaskEdge] = React.useState<string | undefined>(undefined);
  const [error, setError] = React.useState('');
  const [fatal, setFatal] = React.useState<ReturnType<
    typeof previewFailure
  > | null>(null);
  const [ready, setReady] = React.useState(false);
  const [bounds, setBounds] = React.useState({ width: 1, height: 1 });
  React.useEffect(() => {
    const identity = `${overlay?.actionId ?? ''}:${overlay?.mask?.maskAssetId ?? ''}`;
    if (lastMaskIdentity.current !== identity) {
      lastMaskIdentity.current = identity;
      setMaskEdge(undefined);
    }
    const mask = overlay?.mask;
    if (!mask) return;
    const asset = assets.find((asset) => asset.id === mask.maskAssetId);
    if (!asset?.mask) return;
    const resource = controller.current?.getResource({
      clipId: mask.clipId,
      assetId: mask.maskAssetId,
      sourceTime:
        scene?.layers.find((layer) => layer.clipId === mask.clipId)
          ?.sourceTime ?? 0,
      role: 'mask',
    });
    if (!resource) return;
    try {
      setMaskEdge(
        maskEdgePath(
          resource,
          asset.mask.channel,
          project.clips[mask.clipId]?.mask?.invert,
        ),
      );
    } catch (reason) {
      setError(`mask edge unavailable: ${String(reason)}`);
    } finally {
      resource.release?.();
    }
  }, [overlay, scene, assets, project]);
  const zoom = useStudio((s) => s.viewerZoom);
  const fullscreen = useStudio((s) => s.fullscreen);
  useCompositorFullscreen(host, fullscreen);
  React.useEffect(() => {
    setReady(false);
    setFatal(null);
    useStudio.getState().setPreviewStatus('initializing');
    const releaseOwnership = retainCompositorMediaOwnership();
    let disposed = false;
    const fail = (reason: unknown) => {
      if (disposed) return;
      const failure = previewFailure(reason);
      setReady(false);
      setFatal(failure);
      useStudio.getState().setPreviewStatus(failure.status);
    };
    let stop: (() => void) | undefined;
    const queued: ServerEvent[] = [];
    let latestAssets: readonly Asset[] = initial.current.assets;
    bridgeRef.current = {
      event: (event) => {
        if (queued.length >= 64) queued.shift();
        queued.push(event);
      },
      assets: (next) => {
        latestAssets = next;
      },
    };
    // No Pixi import or DOM work on the server. StrictMode cleanup guards lazy initialization.
    void import('@kimo/compositor')
      .then(async ({ PixiRenderer }) => {
        if (disposed || !canvas.current) return;
        const renderer = new PixiRenderer({
          getResource: (request) => current.getResource(request),
        });
        const current: CompositorController = new CompositorController({
          project: initial.current.project,
          assets: latestAssets,
          filmstripCache: createFilmstripCache(
            () => useSession.getState().draft?.assetLocalMap ?? {},
          ),
          renderer,
          warmup: videoCache,
          hardwareConcurrency: navigator.hardwareConcurrency,
          onReducedFollow: () => {
            const node = canvas.current;
            if (!node?.animate) return;
            const duration = Number.parseFloat(
              window.getComputedStyle(node).getPropertyValue('--dur-2'),
            );
            if (!Number.isFinite(duration)) return;
            reducedFade.current?.cancel();
            reducedFade.current = node.animate(
              [{ opacity: 0 }, { opacity: 1 }],
              { duration, easing: 'linear' },
            );
          },
          reducedMotion:
            window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ??
            false,
          onPlayback: (time, playing, fps) => {
            useStudio.getState().publishPlayback(time, playing, fps);
            for (const listener of audioListeners.current) listener();
          },
          onMetrics: setMetrics,
          onOverlay: setOverlay,
          onEditAt: setEditAt,
          // Only overlay geometry subscribes to scene changes, and not to each playback frame.
          onScene: (next) => {
            const now = performance.now();
            if (
              !useStudio.getState().playing ||
              now - lastSceneAt.current >= 100
            ) {
              lastSceneAt.current = now;
              setScene(next);
            }
          },
        });
        controller.current = current;
        bridgeRef.current = {
          event: (event) => current.event(event),
          assets: (next) => current.setAssets(next),
          getFilmstrip: current.getFilmstrip.bind(current),
          getWaveform: current.getWaveform.bind(current),
          getAudioLevel: current.getAudioLevel?.bind(current),
          getAudioCapabilities: current.getAudioCapabilities?.bind(current),
          getCompareCapability: current.getCompareCapability?.bind(current),
          setEditingTextClip: current.setEditingTextClip?.bind(current),
          subscribeAudioLevel: (listener) => {
            audioListeners.current.add(listener);
            return () => {
              audioListeners.current.delete(listener);
            };
          },
        };
        const latestProject = useProject.getState().project;
        if (latestProject?.id === initial.current.project.id)
          current.updateProject(latestProject);
        stop = observeCompositor(current);
        queued.forEach((event) => current.event(event));
        queued.length = 0;
        try {
          await current.init(canvas.current);
          if (disposed) return;
          setReady(true);
          useStudio.getState().setPreviewStatus('ready');
          if (host.current)
            current.resize(
              host.current.clientWidth * window.devicePixelRatio,
              host.current.clientHeight * window.devicePixelRatio,
            );
        } catch (reason) {
          fail(reason);
        }
      })
      .catch((reason) => {
        fail(reason);
      });
    return () => {
      disposed = true;
      useStudio.getState().requestPlayback(false);
      useStudio.getState().setPreviewStatus('legacy');
      stop?.();
      bridgeRef.current = null;
      reducedFade.current?.cancel();
      controller.current?.dispose();
      controller.current = null;
      releaseOwnership();
    };
  }, [bridgeRef]);
  React.useEffect(() => {
    bridgeRef.current?.assets(assets);
  }, [assets, bridgeRef]);
  React.useEffect(() => {
    const node = host.current;
    if (!node) return;
    const resize = () => {
      const width = node.clientWidth;
      const height = node.clientHeight;
      setBounds({ width, height });
      controller.current?.resize(
        width * window.devicePixelRatio,
        height * window.devicePixelRatio,
      );
    };
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    resize();
    return () => observer.disconnect();
  }, []);
  const fit = Math.min(
    bounds.width / project.width,
    bounds.height / project.height,
  );
  const scale = zoom === 'fit' ? fit : zoom === '50%' ? 0.5 : 1;
  React.useEffect(() => {
    if (activeTextId) useStudio.getState().requestPlayback(false);
  }, [activeTextId]);
  const transformStart = useViewerTransform(editing, scale, setError);
  const geometry = {
    width: project.width * scale,
    height: project.height * scale,
  };
  const approximate = ready && (!!error || !!metrics?.issues.length);
  return (
    <div
      ref={host}
      className={`${styles.host} ${fullscreen ? styles.fullscreen : ''}`}
      data-testid="compositor"
      data-fullscreen={fullscreen || undefined}
      data-zoom={zoom}
      data-rendered-frame={ready ? scene?.frame : undefined}
      data-preview-ready={ready}
      data-preview-status={fatal?.status ?? (ready ? 'ready' : 'initializing')}
      data-preparing={!fatal && !scene}
    >
      <div className={styles.surface} style={geometry} hidden={!ready}>
        <canvas
          ref={canvas}
          className={styles.canvas}
          aria-label="live project preview"
          data-testid="compositor-canvas"
        />
        <CompositorOverlay
          project={project}
          assets={assets}
          scene={scene}
          overlay={overlay}
          maskEdge={maskEdge}
          displayScale={scale}
          onTransformStart={transformStart}
          onEditIntent={(intent) => {
            useStudio.setState({
              selection: [intent.clipId],
              inspectorCollapsed: false,
            });
            if (intent.kind === 'text') onOpenText?.(intent.clipId);
          }}
        />
        {editing && activeTextId ? (
          <ViewerTextLayer
            clipId={activeTextId}
            project={project}
            scene={controller.current?.currentScene ?? scene}
            editing={editing}
            displayScale={scale}
            onTransientHide={(id, hidden) =>
              controller.current?.setEditingTextClip(hidden ? id : null)
            }
            onFinish={() => onTextFinish?.()}
          />
        ) : null}
      </div>
      {!ready ? (
        <div
          className={styles.fallback}
          role={fatal ? 'alert' : 'status'}
          data-testid="preview-fallback"
        >
          <strong>
            {fatal ? 'Preview unavailable' : 'Initializing preview'}
          </strong>
          <p>
            {fatal
              ? 'Live preview requires a browser with an available WebGPU or WebGL GPU renderer. Check browser GPU support or use a GPU-capable browser. Timeline editing and manual seeking remain available; playback is stopped.'
              : 'Waiting for the GPU renderer to initialize.'}
          </p>
          {fatal ? <pre>{fatal.details}</pre> : null}
        </div>
      ) : null}
      {approximate ? (
        <span
          className={styles.approx}
          title={[error, ...(metrics?.issues ?? [])].filter(Boolean).join('\n')}
        >
          preview approx.
        </span>
      ) : null}
      {ready && editAt ? (
        <button
          className={styles.editAt}
          onClick={() => {
            useStudio.getState().seek(editAt.time);
            setEditAt(null);
          }}
        >
          edit at {new Date(editAt.time * 1000).toISOString().slice(14, 19)}
        </button>
      ) : null}
      {debug && ready ? (
        <output className={styles.debug} data-testid="compositor-debug">
          video rVFC presentation and renderer submission timing; GPU pixels
          unmeasured. {JSON.stringify(metrics)}
          {error}
        </output>
      ) : null}
      {fullscreen ? <CompositorFullscreenControls /> : null}
    </div>
  );
}
