import JSZip from 'jszip';
import type { CMCGManifest } from '../types/manifest';

export interface CMCGBundle {
  manifest: CMCGManifest;
  /** Object URLs for assets extracted from the bundle. Key = path inside zip. */
  assetUrls: Map<string, string>;
}

/**
 * Load a .cmcg file (ZIP bundle) and extract the manifest + assets.
 * Returns object URLs for all embedded files so the player can reference them.
 */
export async function loadBundle(source: File | ArrayBuffer | Blob): Promise<CMCGBundle> {
  const zip = await JSZip.loadAsync(source);

  // Find and parse manifest.json
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    throw new Error('Invalid .cmcg bundle: missing manifest.json');
  }
  const manifestText = await manifestFile.async('text');
  const manifest = JSON.parse(manifestText) as CMCGManifest;

  // Extract all files as blob URLs
  const assetUrls = new Map<string, string>();
  const entries = Object.entries(zip.files);

  await Promise.all(
    entries.map(async ([path, file]) => {
      if (file.dir) return;
      const blob = await file.async('blob');
      const url = URL.createObjectURL(blob);
      assetUrls.set(path, url);

      // Also map with ./ prefix and / prefix for flexible lookup
      if (!path.startsWith('./')) assetUrls.set(`./${path}`, url);
      if (!path.startsWith('/')) assetUrls.set(`/${path}`, url);
    }),
  );

  // Rewrite the base_video path to point to the extracted blob URL
  const baseVideoPath = manifest.base_video;
  const baseVideoUrl = assetUrls.get(baseVideoPath)
    ?? assetUrls.get(baseVideoPath.replace('./', ''))
    ?? assetUrls.get(baseVideoPath.replace('/', ''));
  if (baseVideoUrl) {
    manifest.base_video = baseVideoUrl;
  }

  // Rewrite slot source local/fallback paths to blob URLs
  for (const slot of manifest.slots) {
    const { source } = slot;
    if (source.local) {
      const url = assetUrls.get(source.local) ?? assetUrls.get(source.local.replace('./', ''));
      if (url) source.local = url;
    }
    if (source.fallback) {
      const url = assetUrls.get(source.fallback) ?? assetUrls.get(source.fallback.replace('./', ''));
      if (url) source.fallback = url;
    }
  }

  return { manifest, assetUrls };
}

/** Revoke all object URLs from a bundle to free memory */
export function releaseBundle(bundle: CMCGBundle): void {
  for (const url of bundle.assetUrls.values()) {
    URL.revokeObjectURL(url);
  }
  bundle.assetUrls.clear();
}
