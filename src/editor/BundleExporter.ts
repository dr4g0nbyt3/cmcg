import JSZip from 'jszip';
import type { CMCGManifest } from '../types/manifest';

/**
 * Export a manifest as a .cmcg ZIP bundle.
 * Packages the manifest.json and any local assets into a downloadable file.
 */
export async function exportBundle(
  manifest: CMCGManifest,
  assets: Map<string, Blob> = new Map(),
): Promise<Blob> {
  const zip = new JSZip();

  // Add manifest
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  // Add assets
  for (const [path, blob] of assets) {
    zip.file(path.replace(/^\.\//, ''), blob);
  }

  return zip.generateAsync({ type: 'blob' });
}

/** Trigger a download of a .cmcg bundle */
export function downloadBundle(blob: Blob, filename = 'template.cmcg'): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
