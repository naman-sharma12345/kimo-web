'use client';
import * as React from 'react';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import styles from './review.module.css';

export const REVIEW_PROMPT_DURATION_MS = 3000;
export interface ReviewPromptProps {
  requestId: string | number | null;
  onWatch: () => void;
}
export function ReviewPrompt({ requestId, onWatch }: ReviewPromptProps) {
  // A keyed child resets the budget only for a new review event, not rerenders.
  return requestId === null ? null : (
    <Prompt key={requestId} onWatch={onWatch} />
  );
}
function Prompt({ onWatch }: Pick<ReviewPromptProps, 'onWatch'>) {
  const [visible, setVisible] = React.useState(true);
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const remaining = React.useRef(REVIEW_PROMPT_DURATION_MS);
  React.useEffect(() => {
    if (!visible || hovered || focused) return;
    const start = performance.now();
    const timer = setTimeout(() => setVisible(false), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(
        0,
        remaining.current - (performance.now() - start),
      );
    };
  }, [visible, hovered, focused]);
  return (
    <div
      className={styles.prompt}
      data-visible={visible}
      aria-hidden={!visible}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      <Button
        className={styles.play}
        variant="secondary"
        aria-label="watch the first cut"
        tabIndex={visible ? 0 : -1}
        disabled={!visible}
        onClick={() => {
          setVisible(false);
          onWatch();
        }}
      >
        <Play aria-hidden="true" size={20} />
      </Button>
      <span>watch the first cut</span>
    </div>
  );
}
