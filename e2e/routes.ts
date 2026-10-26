export const routes = [
  { path: '/dev/tokens', name: 'tokens', phase: '00' },
  { path: '/dev/ui', name: 'ui', phase: '01' },
  { path: '/', name: 'landing', phase: '02' },
  { path: '/warmup/preview', name: 'warmup', phase: '04' },
] as const;
