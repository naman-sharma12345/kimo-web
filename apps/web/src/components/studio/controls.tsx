'use client';
import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useStudio,
  clampPanel,
  responsiveSizes,
  type PanelName,
} from '@/stores/studio';
export function IconButton({
  icon: Icon,
  label,
  size = 'sm',
  ...props
}: {
  icon: LucideIcon;
  label: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
} & Omit<React.ComponentPropsWithoutRef<'button'>, 'children'>) {
  return (
    <Button
      variant="ghost"
      size={size}
      iconOnly
      aria-label={label}
      tooltip={label}
      {...props}
    >
      <Icon aria-hidden="true" />
    </Button>
  );
}
export function Resizer({
  panel,
  value,
  userKey,
}: {
  panel: PanelName;
  value: number;
  userKey: string;
}) {
  const origin = React.useRef<{ coordinate: number; size: number } | null>(
    null,
  );
  // Match the server and first client render; viewport reads belong after hydration.
  const [viewportHeight, setViewportHeight] = React.useState(1080);
  React.useEffect(() => {
    const resize = () => setViewportHeight(window.innerHeight);
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const horizontal = panel !== 'timeline';
  function change(size: number) {
    const current = useStudio.getState();
    // Preserve the viewer's 560px minimum while either side is resized.
    const other =
      panel === 'agent'
        ? current.inspectorCollapsed || window.innerWidth < 1280
          ? 0
          : (current.sizes.inspector ??
            responsiveSizes(window.innerWidth).inspector)
        : current.agentCollapsed
          ? 48
          : (current.sizes.agent ?? responsiveSizes(window.innerWidth).agent);
    const clamped = clampPanel(panel, size, window.innerHeight);
    useStudio.setState({
      sizes: {
        ...current.sizes,
        [panel]: horizontal
          ? Math.min(
              clamped,
              Math.max(
                panel === 'agent' ? 300 : 280,
                window.innerWidth - other - 560 - 32,
              ),
            )
          : clamped,
      },
    });
  }
  function reset() {
    const sizes = { ...useStudio.getState().sizes };
    sizes[panel] = undefined;
    useStudio.setState({ sizes });
    useStudio.getState().persist(userKey);
  }
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={`resize ${panel}`}
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(value)}
      aria-valuemin={
        panel === 'agent' ? 300 : panel === 'inspector' ? 280 : 200
      }
      aria-valuemax={
        horizontal
          ? panel === 'agent'
            ? 480
            : 420
          : Math.max(200, viewportHeight * 0.6)
      }
      className={`studio-resizer studio-resizer-${panel}`}
      onDoubleClick={reset}
      onPointerDown={(e) => {
        origin.current = {
          coordinate: horizontal ? e.clientX : e.clientY,
          size: value,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!origin.current) return;
        const delta =
          (horizontal ? e.clientX : e.clientY) - origin.current.coordinate;
        change(origin.current.size + (panel === 'agent' ? delta : -delta));
      }}
      onPointerUp={() => {
        origin.current = null;
        useStudio.getState().persist(userKey);
      }}
      onPointerCancel={() => {
        origin.current = null;
        useStudio.getState().persist(userKey);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Home') {
          e.preventDefault();
          reset();
        } else if (
          ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
        ) {
          e.preventDefault();
          change(
            value + (e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 8 : -8),
          );
          useStudio.getState().persist(userKey);
        }
      }}
    />
  );
}
