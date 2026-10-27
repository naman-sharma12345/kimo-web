import { durations } from './motion';

/** Native transitions are cosmetic: navigation must not depend on their lifecycle. */
export function navigationTransition(
  navigate: () => void,
  reducedMotion = false,
): () => void {
  let settled = false;
  const cancel = () => {
    settled = true;
    clearTimeout(fallback);
  };
  const navigateOnce = () => {
    if (settled) return;
    cancel();
    navigate();
  };

  const useNative =
    !reducedMotion &&
    typeof document !== 'undefined' &&
    !!document.startViewTransition;
  // d3 is the existing 220 ms crossfade token, also used by warmupTiming.
  const fallback = useNative
    ? setTimeout(navigateOnce, durations.d3 * 1000)
    : undefined;
  if (!useNative) {
    navigateOnce();
    return cancel;
  }

  try {
    const transition = document.startViewTransition(navigateOnce);
    // Observe every rejection, including ready rejecting when animation is skipped.
    void transition.ready.catch(navigateOnce);
    void transition.updateCallbackDone.catch(navigateOnce);
    void transition.finished.catch(navigateOnce);
  } catch {
    navigateOnce();
  }
  return cancel;
}
