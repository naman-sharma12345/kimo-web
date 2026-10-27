'use client';
import * as React from 'react';
import { RouteError } from '@/components/navigation/route-error';
export default function ErrorPage({
  reset,
  error,
}: {
  reset: () => void;
  error: Error;
}) {
  return <RouteError screen="delivery" reset={reset} error={error} />;
}
