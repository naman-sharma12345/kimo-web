import * as React from 'react';
import { cn } from '@/lib/cn';
export interface AvatarProps extends React.ComponentPropsWithoutRef<'span'> {
  identity?: 'agent' | 'user';
  name?: string;
  active?: boolean;
}
export const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(
  function Avatar(
    { identity = 'agent', name = 'you', active = false, className, ...props },
    ref,
  ) {
    const userName = name.trim() || 'you';
    return (
      <span
        ref={ref}
        role="img"
        aria-label={
          identity === 'agent'
            ? active
              ? 'kimo is working'
              : 'kimo'
            : userName
        }
        className={cn('ui-avatar', className)}
        data-identity={identity}
        {...props}
      >
        {identity === 'agent' ? (
          <svg
            className="ui-avatar-mark"
            aria-hidden="true"
            viewBox="0 0 24 24"
          >
            <g fill="currentColor">
              <rect x="2" y="9" width="3" height="10" rx="1.5" />
              <rect x="7.5" y="3" width="3" height="16" rx="1.5" />
              <rect x="13" y="7" width="3" height="12" rx="1.5" />
              <rect x="18.5" y="12" width="3" height="7" rx="1.5" />
              <path d="m13 3 2 3 2-3z" />
            </g>
            <path d="M15 5v17" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        ) : (
          <span aria-hidden="true">
            {userName === 'you'
              ? 'you'
              : Array.from(userName)[0]?.toLocaleUpperCase()}
          </span>
        )}
        {identity === 'agent' && active && (
          <svg
            aria-hidden="true"
            className="ui-avatar-ring"
            viewBox="0 0 20 20"
          >
            <circle
              cx="10"
              cy="10"
              r="9"
              pathLength="360"
              strokeDasharray="100 260"
            />
          </svg>
        )}
      </span>
    );
  },
);
