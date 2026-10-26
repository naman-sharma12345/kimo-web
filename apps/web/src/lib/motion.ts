export const durations = {
  d1: 0.09,
  d2: 0.14,
  d3: 0.22,
  d4: 0.36,
  d5: 0.64,
  unfold: 0.9,
} as const;
export const easings = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
  in: [0.55, 0, 1, 0.45],
} as const;
export const spring = {
  snappy: { type: 'spring', stiffness: 520, damping: 40, mass: 0.8 },
  soft: { type: 'spring', stiffness: 260, damping: 32 },
} as const;
export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: durations.d2 },
};
export const motionPresets = {
  fade,
  panel: {
    initial: { opacity: 0, y: 8, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { duration: durations.d4, ease: easings.out },
  },
  chip: {
    initial: { opacity: 0, scale: 0.9 },
    animate: { opacity: 1, scale: 1 },
    transition: spring.snappy,
  },
};
