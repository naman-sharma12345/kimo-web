'use client';
import * as React from 'react';
import { useStudio, canPlayPreview } from '@/stores/studio';
import { timecode } from './transport';
import styles from './compositor.module.css';
/** Fullscreen styles never change the host/child keys or create a second canvas/context. */
export function useCompositorFullscreen(
  host: React.RefObject<HTMLDivElement | null>,
  active: boolean,
): void {
  React.useEffect(() => {
    if (!active) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const node = host.current;
    let disposed = false;
    const exit = () => {
      useStudio.setState({ fullscreen: false });
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && node) {
        const controls = [
          ...node.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]',
          ),
        ];
        const first = controls[0],
          last = controls.at(-1),
          current = document.activeElement;
        if (first && last) {
          if (
            event.shiftKey &&
            (current === first || !node.contains(current))
          ) {
            event.preventDefault();
            last.focus();
          } else if (
            !event.shiftKey &&
            (current === last || !node.contains(current))
          ) {
            event.preventDefault();
            first.focus();
          }
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        exit();
      }
    };
    const change = () => {
      if (!document.fullscreenElement && !disposed) exit();
    };
    document.addEventListener('keydown', key);
    document.addEventListener('fullscreenchange', change);
    // API denial keeps the exact same mounted host as an in-page fallback.
    if (!document.fullscreenElement)
      void node
        ?.requestFullscreen?.()
        .then(() => {
          if (disposed && document.fullscreenElement === node)
            void document.exitFullscreen?.().catch(() => undefined);
        })
        .catch(() => undefined);
    node?.querySelector<HTMLButtonElement>('[data-fullscreen-close]')?.focus();
    return () => {
      disposed = true;
      document.removeEventListener('keydown', key);
      document.removeEventListener('fullscreenchange', change);
      if (document.fullscreenElement === node)
        void document.exitFullscreen?.().catch(() => undefined);
      previous?.focus();
    };
  }, [active, host]);
}
export function CompositorFullscreenControls() {
  const state = useStudio();
  const [visible, setVisible] = React.useState(true);
  const focused = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const reveal = React.useCallback(() => {
    setVisible(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!focused.current) setVisible(false);
    }, 2000);
  }, []);
  React.useEffect(() => {
    reveal();
    const move = () => reveal();
    window.addEventListener('pointermove', move);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('pointermove', move);
    };
  }, [reveal]);
  return (
    <div
      className={styles.fullControls}
      data-visible={visible}
      onFocus={(event) => {
        focused.current = event.target.matches(':focus-visible');
        reveal();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          focused.current = false;
          reveal();
        }
      }}
    >
      <label className={styles.scrub}>
        <span className="studio-sr">fullscreen playhead</span>
        <input
          type="range"
          min={0}
          max={state.duration}
          step={1 / 30}
          value={state.playhead}
          onPointerDown={() => state.beginScrubbing()}
          onChange={(event) =>
            state.updateScrubbing(Number(event.target.value))
          }
          onPointerUp={(event) =>
            state.endScrubbing(Number(event.currentTarget.value))
          }
          onPointerCancel={(event) =>
            state.endScrubbing(Number(event.currentTarget.value))
          }
          onKeyDown={(event) => {
            if (
              [
                'ArrowLeft',
                'ArrowRight',
                'Home',
                'End',
                'PageUp',
                'PageDown',
              ].includes(event.key)
            )
              state.beginScrubbing();
          }}
          onKeyUp={(event) =>
            state.endScrubbing(Number(event.currentTarget.value))
          }
          onBlur={(event) => {
            if (useStudio.getState().scrubbing)
              state.endScrubbing(Number(event.currentTarget.value));
          }}
        />
      </label>
      <button
        disabled={!canPlayPreview(state.previewStatus)}
        onClick={() => state.requestPlayback(!state.playing)}
      >
        {state.playing ? 'pause preview' : 'play preview'}
      </button>
      <span>{timecode(state.playhead)}</span>
      <button
        data-fullscreen-close
        onClick={() => useStudio.setState({ fullscreen: false })}
      >
        close preview
      </button>
    </div>
  );
}
