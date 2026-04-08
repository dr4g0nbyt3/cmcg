import type { CMCGManifest, Slot } from '../types/manifest';
import { resolveSource } from './SourceResolver';

interface ResolvedSlot {
  slot: Slot;
  image: HTMLImageElement;
}

export class CMCGPlayer {
  private container: HTMLElement;
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private manifest: CMCGManifest | null = null;
  private resolvedSlots: ResolvedSlot[] = [];
  private animFrameId = 0;
  private playing = false;

  constructor(container: HTMLElement) {
    this.container = container;

    // Create video element for the base video layer
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = false;
    this.video.style.position = 'absolute';
    this.video.style.top = '0';
    this.video.style.left = '0';
    this.video.style.width = '100%';
    this.video.style.height = '100%';

    // Create canvas overlay for slot compositing
    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';

    this.ctx = this.canvas.getContext('2d')!;

    this.container.appendChild(this.video);
    this.container.appendChild(this.canvas);
  }

  /**
   * Load a .cmcg manifest and resolve all slot sources.
   * Pass variable overrides to inject values at load time.
   */
  async load(
    manifestUrl: string,
    variables: Record<string, string> = {},
  ): Promise<void> {
    // Fetch and parse the manifest
    const res = await fetch(manifestUrl);
    if (!res.ok) throw new Error(`Failed to load manifest: ${res.status}`);
    this.manifest = (await res.json()) as CMCGManifest;

    // Merge variable overrides into the manifest's declared variables
    const mergedVars = { ...this.manifest.variables };
    for (const [key, val] of Object.entries(variables)) {
      mergedVars[key] = val;
    }

    // Set canvas dimensions to match manifest resolution (canvas renders at native res)
    const [width, height] = this.manifest.meta.resolution;
    this.canvas.width = width;
    this.canvas.height = height;
    // Container uses CSS to scale down to fit viewport — don't set pixel width
    this.container.style.position = 'relative';
    this.container.style.overflow = 'hidden';

    // Set base video source
    this.video.src = this.manifest.base_video;

    // Resolve and preload all image slots
    this.resolvedSlots = [];
    const imageSlots = this.manifest.slots.filter((s) => s.type === 'image');

    const loadPromises = imageSlots.map(async (slot) => {
      const url = await resolveSource(
        slot.source,
        mergedVars,
        slot.fetchTimeout,
      );
      if (!url) {
        console.warn(`[CMCG] No source resolved for slot "${slot.id}"`);
        return;
      }

      const img = await this.loadImage(url, slot.source.fallback);
      if (!img) {
        console.warn(`[CMCG] Could not load any image for slot "${slot.id}"`);
        return;
      }

      this.resolvedSlots.push({ slot, image: img });
      console.log(`[CMCG] Slot "${slot.id}" loaded from: ${img.src}`);
    });

    // Wait for base video to be ready + all images loaded
    await Promise.all([
      new Promise<void>((resolve) => {
        if (this.video.readyState >= 3) {
          resolve();
        } else {
          this.video.addEventListener('canplay', () => resolve(), { once: true });
        }
      }),
      ...loadPromises,
    ]);
  }

  /** Try to load an image URL; if it fails, try the fallback */
  private async loadImage(
    url: string,
    fallbackUrl?: string,
  ): Promise<HTMLImageElement | null> {
    const tryLoad = (src: string): Promise<HTMLImageElement | null> => {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });
    };

    let img = await tryLoad(url);
    if (img) return img;

    if (fallbackUrl && fallbackUrl !== url) {
      console.warn(`[CMCG] Primary source failed (${url}), trying fallback`);
      img = await tryLoad(fallbackUrl);
      if (img) return img;
    }

    return null;
  }

  /** Start playback and the render loop */
  play(): void {
    if (!this.manifest) return;
    this.playing = true;
    this.video.play();
    this.renderLoop();
  }

  /** Pause playback */
  pause(): void {
    this.playing = false;
    this.video.pause();
    cancelAnimationFrame(this.animFrameId);
  }

  /** Clean up all DOM elements and stop rendering */
  destroy(): void {
    this.pause();
    this.video.remove();
    this.canvas.remove();
    this.manifest = null;
    this.resolvedSlots = [];
  }

  /** The core render loop — clears canvas and draws all active slots each frame */
  private renderLoop = (): void => {
    if (!this.playing || !this.manifest) return;

    const currentTime = this.video.currentTime;
    const [width, height] = this.manifest.meta.resolution;

    // Clear the entire canvas
    this.ctx.clearRect(0, 0, width, height);

    // Draw each active slot
    for (const { slot, image } of this.resolvedSlots) {
      const slotEnd = slot.start + slot.duration;
      if (currentTime >= slot.start && currentTime < slotEnd) {
        this.ctx.drawImage(
          image,
          slot.position.x,
          slot.position.y,
          slot.position.w,
          slot.position.h,
        );
      }
    }

    this.animFrameId = requestAnimationFrame(this.renderLoop);
  };
}
