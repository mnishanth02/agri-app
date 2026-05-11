/**
 * Module 6.4 prerequisite — `useClerkTokenRef`.
 *
 * Maintains a synchronous, mutable handle to the latest Clerk JWT so that
 * MapLibre's `transformRequest` (which is constructed once and snapshotted
 * by `useMapInstance`) can attach `Authorization: Bearer ${token}` to every
 * EOSDA render-tile fetch without ever calling `getToken()` per tile.
 *
 * ## Why a ref, not state
 *
 * `useMapInstance` captures `transformRequest` at construction time. A
 * closure over React state would freeze the token at first render; a closure
 * over a ref re-reads `ref.current` each tile request and stays current
 * across token rotations. The companion `isReady` flag is for components
 * that need to gate UI on the first non-null token (e.g. `<NdviLayer>` not
 * mounting tile sources before auth is established, which would emit a
 * burst of unauthenticated 401s).
 *
 * ## Refresh cadence
 *
 * Clerk session JWTs default to a 60s lifetime. We refresh at 50s to leave
 * a safety margin against clock skew + in-flight tile requests. On refresh
 * failure (e.g. transient network blip) the previous token stays in place
 * so the map keeps loading tiles; the next interval will retry.
 *
 * Sign-out resets `ref.current` to `null` and clears `isReady`.
 */

import { useAuth } from '@clerk/react';
import { type RefObject, useEffect, useRef, useState } from 'react';

const REFRESH_INTERVAL_MS = 50_000;

export type UseClerkTokenRefResult = {
  /**
   * Stable ref whose `.current` holds the latest Clerk JWT (or `null`
   * before the first token resolves / after sign-out). Read inside
   * MapLibre `transformRequest` closures — never destructure.
   */
  ref: RefObject<string | null>;
  /**
   * `true` once a non-null token has been written at least once for the
   * current session. Components that emit authenticated network requests
   * (e.g. raster tile sources) should gate mount on this flag so the
   * first request never goes out unauthenticated.
   */
  isReady: boolean;
};

export function useClerkTokenRef(): UseClerkTokenRefResult {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const ref = useRef<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      ref.current = null;
      setIsReady(false);
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      try {
        const token = await getToken();
        if (cancelled) return;
        ref.current = token;
        if (token) setIsReady(true);
      } catch (err) {
        if (cancelled) return;
        // Transient failure (network blip, Clerk degraded). Keep the
        // previous token in place so in-flight tile loads keep working;
        // the next interval tick will retry. Surfaced via console.warn
        // because the web app has no logger module yet.
        console.warn('[useClerkTokenRef] token refresh failed', err);
      }
    };

    void refresh();
    const intervalId = window.setInterval(refresh, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [getToken, isLoaded, isSignedIn]);

  return { ref, isReady };
}
