'use client';
import * as React from 'react';
import { Row } from '@/components/ui/row';
import { Toggle } from '@/components/ui/toggle';
import { Segmented, SegmentedItem } from '@/components/ui/segmented';
import { Section } from '@/components/ui/section';
import styles from './inspector.module.css';
export function Select({
  label,
  value,
  options,
  onChange,
  disabled,
  acting,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; disabled?: boolean }[];
  onChange(value: string): void;
  disabled?: boolean;
  acting?: boolean;
}) {
  return (
    <Row
      data-acting={acting || undefined}
      label={label}
      value={
        <select
          className={styles.select}
          aria-label={label}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      }
    />
  );
}
export function Switch({
  label,
  value,
  onChange,
  disabled,
  acting,
}: {
  label: string;
  value: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
  acting?: boolean;
}) {
  return (
    <Row
      data-acting={acting || undefined}
      label={label}
      value={
        <Toggle
          aria-label={label}
          checked={value}
          onCheckedChange={onChange}
          disabled={disabled}
        />
      }
    />
  );
}
export function Segments({
  label,
  value,
  options,
  onChange,
  disabled,
  acting,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange(value: string): void;
  disabled?: boolean;
  acting?: boolean;
}) {
  return (
    <Row
      data-acting={acting || undefined}
      label={label}
      value={
        <Segmented
          aria-label={label}
          value={value}
          onValueChange={onChange}
          disabled={disabled}
        >
          {options.map((o) => (
            <SegmentedItem key={o} value={o}>
              {o}
            </SegmentedItem>
          ))}
        </Segmented>
      }
    />
  );
}
export function InspectorSection({
  label,
  scope,
  storage,
  onOpenChange,
  children,
}: {
  label: string;
  scope: string;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const key = `kimo:inspector:v1:${scope}:${label}`;
  const localStore = () => storage ?? window.localStorage;
  const [open, setOpen] = React.useState(true);
  React.useEffect(() => {
    try {
      setOpen(localStore().getItem(key) !== 'closed');
    } catch {
      setOpen(true);
    }
  }, [key, storage]);
  const openCallback = React.useRef(onOpenChange);
  openCallback.current = onOpenChange;
  React.useEffect(() => {
    openCallback.current?.(open);
  }, [open]);
  React.useEffect(() => () => openCallback.current?.(false), []);
  return (
    <Section
      label={label}
      collapsible
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        try {
          localStore().setItem(key, next ? 'open' : 'closed');
        } catch {
          /* Collapse is local convenience only. */
        }
      }}
    >
      {children}
    </Section>
  );
}
export function Reason({ children }: { children: React.ReactNode }) {
  return <p className={styles.reason}>{children}</p>;
}
