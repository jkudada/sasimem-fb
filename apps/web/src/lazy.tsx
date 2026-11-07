import { signal } from "@preact/signals";
import type { ComponentType } from "preact";

/**
 * A screen loaded on first use, showing "Loading…" meanwhile. Plain signals rather
 * than suspense: preact-iso's Router only re-routes on a URL change, and onboarding
 * changes screen without one.
 */
export function lazyScreen<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  const loaded = signal<ComponentType<P> | null>(null);
  let started = false;
  return (props: P) => {
    if (!started) {
      started = true;
      void load().then((c) => (loaded.value = c));
    }
    const Screen = loaded.value;
    return Screen === null ? <main class="narrow"><p>Loading…</p></main> : <Screen {...props} />;
  };
}
