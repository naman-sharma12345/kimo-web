const posters = new Map<string, Blob>();
/** Memory only. A reload intentionally loses the review poster. */
export function setRenderPoster(sessionId: string, poster: Blob): void {
  posters.clear();
  posters.set(sessionId, poster);
}
export function takeRenderPoster(sessionId: string): Blob | undefined {
  const poster = posters.get(sessionId);
  posters.delete(sessionId);
  return poster;
}
const key = (id: string) => `kimo-render-arrival:${id}`;
export function markRenderArrival(id: string): void {
  try {
    sessionStorage.setItem(key(id), '1');
  } catch {
    /* optional visual only */
  }
}
export function consumeRenderArrival(id: string): boolean {
  try {
    const arrived = sessionStorage.getItem(key(id)) === '1';
    sessionStorage.removeItem(key(id));
    return arrived;
  } catch {
    return false;
  }
}
export function deliveryTransition(
  navigate: () => void,
  reduced: boolean,
): void {
  let routed = false;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  const once = () => {
    if (!routed) {
      routed = true;
      clearTimeout(fallback);
      navigate();
    }
  };
  if (!reduced && typeof document.startViewTransition === 'function') {
    try {
      const transition = document.startViewTransition(once);
      void transition.finished.catch(once);
      // A buggy/unsupported native implementation must not trap delivery forever.
      if (!routed) fallback = setTimeout(once, 220);
    } catch {
      once();
    }
  } else once();
}

/** Named Phase 9 motion values, seconds for Motion (CSS equivalents owned by parent). */
export const renderMotion = {
  frameFade: 0.18,
  stageFade: 0.22,
  reducedFade: 0.14,
  barStagger: 0.06,
  barRise: 24,
  tileSlide: 16,
} as const;
