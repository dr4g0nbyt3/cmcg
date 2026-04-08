import type { SlotSource } from '../types/manifest';

/**
 * Resolves a slot's media source by walking the priority chain:
 * variable → local → remote → fallback
 *
 * Returns the resolved URL string, or null if nothing resolved.
 */
export async function resolveSource(
  source: SlotSource,
  variables: Record<string, string | null>,
  fetchTimeout = 3000,
): Promise<string | null> {
  // 1. Check variable binding
  if (source.variable) {
    const value = variables[source.variable];
    if (value) return value;
  }

  // 2. Local file path (usable when serving from the .cmcg bundle)
  if (source.local) {
    return source.local;
  }

  // 3. Remote URL — return directly; the image/media loader will handle failures
  if (source.remote) {
    return source.remote;
  }

  // 4. Fallback asset
  if (source.fallback) {
    return source.fallback;
  }

  return null;
}
