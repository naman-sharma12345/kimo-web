'use client';
import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type HTMLMotionProps,
} from 'motion/react';
import { CircleCheck, CircleAlert, Info, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { durations, spring } from '@/lib/motion';
import { Button } from './button';
import { uiTiming } from './tokens';
export interface ToastMessage {
  id: string;
  message: string;
  tone?: 'info' | 'success' | 'error';
  action?: { label: string; onClick: () => void };
}
export interface ToastProps
  extends Omit<HTMLMotionProps<'div'>, 'children'>, Omit<ToastMessage, 'id'> {
  onDismiss?: () => void;
  paused?: boolean;
  older?: boolean;
}
export const Toast = React.forwardRef<HTMLDivElement, ToastProps>(
  function Toast(
    {
      message,
      tone = 'info',
      action,
      onDismiss,
      paused = false,
      older = false,
      className,
      onMouseEnter,
      onMouseLeave,
      onFocus,
      onBlur,
      onKeyDown,
      ...props
    },
    ref,
  ) {
    const reduced = useReducedMotion();
    const [hovered, setHovered] = React.useState(false);
    const [focused, setFocused] = React.useState(false);
    const [hidden, setHidden] = React.useState(false);
    const remaining = React.useRef<number>(
      tone === 'error' ? uiTiming.toastError : uiTiming.toast,
    );
    const dismissRef = React.useRef(onDismiss);
    dismissRef.current = onDismiss;
    React.useEffect(() => {
      remaining.current =
        tone === 'error' ? uiTiming.toastError : uiTiming.toast;
    }, [message, tone]);
    React.useEffect(() => {
      const change = () => setHidden(document.hidden);
      change();
      document.addEventListener('visibilitychange', change);
      return () => document.removeEventListener('visibilitychange', change);
    }, []);
    React.useEffect(() => {
      if (paused || hovered || focused || hidden || !dismissRef.current) return;
      const start = performance.now();
      const timer = window.setTimeout(
        () => dismissRef.current?.(),
        remaining.current,
      );
      return () => {
        window.clearTimeout(timer);
        remaining.current = Math.max(
          0,
          remaining.current - (performance.now() - start),
        );
      };
    }, [paused, hovered, focused, hidden, message, tone]);
    const Icon =
      tone === 'success' ? CircleCheck : tone === 'error' ? CircleAlert : Info;
    return (
      <motion.div
        ref={ref}
        role={tone === 'error' ? 'alert' : 'status'}
        aria-atomic="true"
        className={cn('ui-toast', className)}
        data-tone={tone}
        initial={{ opacity: 0, y: reduced ? 0 : 12 }}
        animate={{
          opacity: older ? 0.7 : 1,
          y: 0,
          scale: reduced ? 1 : older ? 0.96 : 1,
        }}
        exit={{ opacity: 0 }}
        transition={reduced ? { duration: durations.d2 } : spring.soft}
        onMouseEnter={(event) => {
          setHovered(true);
          onMouseEnter?.(event);
        }}
        onMouseLeave={(event) => {
          setHovered(false);
          onMouseLeave?.(event);
        }}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setFocused(false);
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && event.key === 'Escape' && onDismiss) {
            event.preventDefault();
            onDismiss();
          }
        }}
        {...props}
      >
        <Icon className="ui-toast-icon" aria-hidden="true" />
        <span className="ui-toast-message">{message}</span>
        {action && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              action.onClick();
              onDismiss?.();
            }}
          >
            {action.label}
          </Button>
        )}
        {onDismiss && (
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            aria-label="Dismiss notification"
            tooltip="Dismiss notification"
            onClick={onDismiss}
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </motion.div>
    );
  },
);
interface ToastContextValue {
  notify: (toast: Omit<ToastMessage, 'id'>) => string;
  dismiss: (id: string) => void;
}
const ToastContext = React.createContext<ToastContextValue | null>(null);
export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error('useToast requires ToastProvider');
  return context;
}
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = React.useState<ToastMessage[]>([]);
  const [mounted, setMounted] = React.useState(false);
  const counter = React.useRef(0);
  const prefix = React.useId();
  React.useEffect(() => setMounted(true), []);
  const dismiss = React.useCallback(
    (id: string) =>
      setMessages((current) => current.filter((item) => item.id !== id)),
    [],
  );
  const notify = React.useCallback(
    (message: Omit<ToastMessage, 'id'>) => {
      const id = `${prefix}-${++counter.current}`;
      setMessages((current) => [...current, { ...message, id }].slice(-3));
      return id;
    },
    [prefix],
  );
  const context = React.useMemo(() => ({ notify, dismiss }), [notify, dismiss]);
  return (
    <ToastContext.Provider value={context}>
      {children}
      {mounted &&
        createPortal(
          <div
            className="ui-toast-viewport"
            role="region"
            aria-label="Notifications"
            aria-live="polite"
            aria-relevant="additions text"
          >
            <AnimatePresence initial={false}>
              {messages.map((message, index) => (
                <Toast
                  key={message.id}
                  {...message}
                  older={index < messages.length - 1}
                  onDismiss={() => dismiss(message.id)}
                />
              ))}
            </AnimatePresence>
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}
