import type { CMCGManifest, Slot } from '../types/manifest';
import { resolveSource } from './SourceResolver';

interface ResolvedImageSlot {
  kind: 'image';
  slot: Slot;
  image: HTMLImageElement;
}

interface ResolvedVideoSlot {
  kind: 'video';
  slot: Slot;
  video: HTMLVideoElement;
  started: boolean;
}

interface ResolvedTextSlot {
  kind: 'text';
  slot: Slot;
  content: string;
}

interface ResolvedAudioSlot {
  kind: 'audio';
  slot: Slot;
  audio: HTMLAudioElement;
  started: boolean;
}

type ResolvedSlot = ResolvedImageSlot | ResolvedVideoSlot | ResolvedTextSlot | ResolvedAudioSlot;

export class CMCGPlayer {
  private container: HTMLElement;
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private manifest: CMCGManifest | null = null;
  private mergedVars: Record<string, string | null> = {};
  private resolvedSlots: ResolvedSlot[] = [];
  private animFrameId = 0;
  private playing = false;

  /** Fires when playback ends */
  onEnded: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = false;
    this.video.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none';

    this.ctx = this.canvas.getContext('2d')!;

    this.container.appendChild(this.video);
    this.container.appendChild(this.canvas);

    this.video.addEventListener('ended', () => {
      this.playing = false;
      this.stopAllMedia();
      this.onEnded?.();
    });
  }

  /** Current playback time in seconds */
  get currentTime(): number {
    return this.video.currentTime;
  }

  /** Total duration from the manifest */
  get duration(): number {
    return this.manifest?.meta.duration ?? 0;
  }

  /** Whether the player is currently playing */
  get isPlaying(): boolean {
    return this.playing;
  }

  /** The loaded manifest (read-only) */
  get loadedManifest(): CMCGManifest | null {
    return this.manifest;
  }

  /**
   * Load a .cmcg manifest and resolve all slot sources.
   * Accepts either a URL to fetch or a pre-parsed manifest object.
   */
  async load(
    manifestOrUrl: string | CMCGManifest,
    variables: Record<string, string> = {},
  ): Promise<void> {
    if (typeof manifestOrUrl === 'string') {
      const res = await fetch(manifestOrUrl);
      if (!res.ok) throw new Error(`Failed to load manifest: ${res.status}`);
      this.manifest = (await res.json()) as CMCGManifest;
    } else {
      this.manifest = manifestOrUrl;
    }

    // Merge variable overrides
    this.mergedVars = { ...this.manifest.variables };
    for (const [key, val] of Object.entries(variables)) {
      this.mergedVars[key] = val;
    }

    // Resolve text slot content that references variables (e.g. "$brandColor" in text.content)
    this.resolveTextVariables();

    const [width, height] = this.manifest.meta.resolution;
    this.canvas.width = width;
    this.canvas.height = height;
    this.container.style.position = 'relative';
    this.container.style.overflow = 'hidden';

    this.video.src = this.manifest.base_video;

    // Resolve all slots in parallel
    this.resolvedSlots = [];
    const loadPromises = this.manifest.slots.map((slot) => this.resolveSlot(slot));

    await Promise.all([
      new Promise<void>((resolve) => {
        if (this.video.readyState >= 3) resolve();
        else this.video.addEventListener('canplay', () => resolve(), { once: true });
      }),
      ...loadPromises,
    ]);

    console.log(`[CMCG] Loaded ${this.resolvedSlots.length} slots`);
  }

  /** Seek to a specific time */
  seek(time: number): void {
    this.video.currentTime = time;
    this.stopAllMedia();
  }

  play(): void {
    if (!this.manifest) return;
    this.playing = true;
    this.video.play();
    this.renderLoop();
  }

  pause(): void {
    this.playing = false;
    this.video.pause();
    cancelAnimationFrame(this.animFrameId);
    this.pauseAllMedia();
  }

  destroy(): void {
    this.pause();
    this.stopAllMedia();
    this.video.remove();
    this.canvas.remove();
    this.manifest = null;
    this.resolvedSlots = [];
  }

  // ── Slot Resolution ──────────────────────────────────────────

  private async resolveSlot(slot: Slot): Promise<void> {
    switch (slot.type) {
      case 'image':
      case 'overlay':
        return this.resolveImageSlot(slot);
      case 'video':
        return this.resolveVideoSlot(slot);
      case 'text':
        return this.resolveTextSlot(slot);
      case 'audio':
        return this.resolveAudioSlot(slot);
    }
  }

  private async resolveImageSlot(slot: Slot): Promise<void> {
    const url = await resolveSource(slot.source, this.mergedVars, slot.fetchTimeout);
    if (!url) {
      console.warn(`[CMCG] No source for image slot "${slot.id}"`);
      return;
    }

    const img = await this.loadImage(url, slot.source.fallback);
    if (!img) {
      console.warn(`[CMCG] Failed to load image slot "${slot.id}"`);
      return;
    }

    this.resolvedSlots.push({ kind: 'image', slot, image: img });
    console.log(`[CMCG] Image slot "${slot.id}" ready`);
  }

  private async resolveVideoSlot(slot: Slot): Promise<void> {
    const url = await resolveSource(slot.source, this.mergedVars, slot.fetchTimeout);
    if (!url) {
      console.warn(`[CMCG] No source for video slot "${slot.id}"`);
      return;
    }

    const vid = document.createElement('video');
    vid.crossOrigin = 'anonymous';
    vid.playsInline = true;
    vid.muted = true; // muted by default; unmute via volume property
    vid.preload = 'auto';
    vid.loop = slot.loop ?? false;
    if (slot.volume !== undefined) {
      vid.volume = slot.volume;
      vid.muted = slot.volume === 0;
    }
    vid.src = url;

    await new Promise<void>((resolve) => {
      if (vid.readyState >= 3) resolve();
      else vid.addEventListener('canplay', () => resolve(), { once: true });
    });

    this.resolvedSlots.push({ kind: 'video', slot, video: vid, started: false });
    console.log(`[CMCG] Video slot "${slot.id}" ready`);
  }

  private async resolveTextSlot(slot: Slot): Promise<void> {
    if (!slot.text) {
      console.warn(`[CMCG] Text slot "${slot.id}" has no text property`);
      return;
    }

    // Resolve content — could be a variable reference or literal text
    let content = slot.text.content;
    if (content.startsWith('$')) {
      content = this.mergedVars[content] ?? content;
    }

    this.resolvedSlots.push({ kind: 'text', slot, content });
    console.log(`[CMCG] Text slot "${slot.id}" ready: "${content.slice(0, 40)}..."`);
  }

  private async resolveAudioSlot(slot: Slot): Promise<void> {
    const url = await resolveSource(slot.source, this.mergedVars, slot.fetchTimeout);
    if (!url) {
      console.warn(`[CMCG] No source for audio slot "${slot.id}"`);
      return;
    }

    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    if (slot.volume !== undefined) audio.volume = slot.volume;
    audio.src = url;

    await new Promise<void>((resolve) => {
      audio.addEventListener('canplaythrough', () => resolve(), { once: true });
      audio.addEventListener('error', () => {
        console.warn(`[CMCG] Failed to load audio slot "${slot.id}": ${url}`);
        resolve();
      }, { once: true });
    });

    this.resolvedSlots.push({ kind: 'audio', slot, audio, started: false });
    console.log(`[CMCG] Audio slot "${slot.id}" ready`);
  }

  // ── Image Loading ────────────────────────────────────────────

  private async loadImage(url: string, fallbackUrl?: string): Promise<HTMLImageElement | null> {
    const tryLoad = (src: string): Promise<HTMLImageElement | null> =>
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });

    let img = await tryLoad(url);
    if (img) return img;

    if (fallbackUrl && fallbackUrl !== url) {
      console.warn(`[CMCG] Primary source failed (${url}), trying fallback`);
      img = await tryLoad(fallbackUrl);
      if (img) return img;
    }

    return null;
  }

  // ── Variable Resolution ──────────────────────────────────────

  private resolveTextVariables(): void {
    if (!this.manifest) return;
    for (const slot of this.manifest.slots) {
      if (slot.type === 'text' && slot.text) {
        // Replace $variable references in text content
        slot.text.content = slot.text.content.replace(
          /\$\w+/g,
          (match) => this.mergedVars[match] ?? match,
        );
      }
    }
  }

  // ── Media Playback Control ───────────────────────────────────

  private stopAllMedia(): void {
    for (const rs of this.resolvedSlots) {
      if (rs.kind === 'video') {
        rs.video.pause();
        rs.video.currentTime = 0;
        rs.started = false;
      }
      if (rs.kind === 'audio') {
        rs.audio.pause();
        rs.audio.currentTime = 0;
        rs.started = false;
      }
    }
  }

  private pauseAllMedia(): void {
    for (const rs of this.resolvedSlots) {
      if (rs.kind === 'video') rs.video.pause();
      if (rs.kind === 'audio') rs.audio.pause();
    }
  }

  // ── Render Loop ──────────────────────────────────────────────

  private renderLoop = (): void => {
    if (!this.playing || !this.manifest) return;

    const t = this.video.currentTime;
    const [width, height] = this.manifest.meta.resolution;

    this.ctx.clearRect(0, 0, width, height);

    for (const rs of this.resolvedSlots) {
      const { slot } = rs;
      const active = t >= slot.start && t < slot.start + slot.duration;

      switch (rs.kind) {
        case 'image':
          if (active) {
            this.ctx.drawImage(rs.image, slot.position.x, slot.position.y, slot.position.w, slot.position.h);
          }
          break;

        case 'video':
          if (active) {
            if (!rs.started) {
              rs.video.currentTime = t - slot.start;
              rs.video.play();
              rs.started = true;
            }
            this.ctx.drawImage(rs.video, slot.position.x, slot.position.y, slot.position.w, slot.position.h);
          } else if (rs.started) {
            rs.video.pause();
            rs.started = false;
          }
          break;

        case 'text':
          if (active) this.renderText(rs);
          break;

        case 'audio':
          if (active) {
            if (!rs.started) {
              rs.audio.currentTime = t - slot.start;
              rs.audio.play();
              rs.started = true;
            }
          } else if (rs.started) {
            rs.audio.pause();
            rs.started = false;
          }
          break;
      }
    }

    this.animFrameId = requestAnimationFrame(this.renderLoop);
  };

  // ── Text Rendering ───────────────────────────────────────────

  private renderText(rs: ResolvedTextSlot): void {
    const { slot, content } = rs;
    const style = slot.text!;
    const { x, y, w, h } = slot.position;

    // Background
    if (style.background) {
      this.ctx.fillStyle = style.background;
      const pad = style.padding ?? 0;
      this.ctx.fillRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
    }

    // Text setup
    const fontSize = style.fontSize ?? 24;
    const fontWeight = style.fontWeight ?? '400';
    const fontFamily = style.fontFamily ?? 'system-ui, sans-serif';
    this.ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    this.ctx.fillStyle = style.color ?? '#ffffff';
    this.ctx.textBaseline = 'top';

    // Alignment
    const align = style.align ?? 'left';
    if (align === 'center') {
      this.ctx.textAlign = 'center';
    } else if (align === 'right') {
      this.ctx.textAlign = 'right';
    } else {
      this.ctx.textAlign = 'left';
    }

    const textX = align === 'center' ? x + w / 2 : align === 'right' ? x + w : x;
    const lineHeight = style.lineHeight ?? fontSize * 1.4;

    // Word-wrap and draw
    const lines = this.wrapText(content, w);
    for (let i = 0; i < lines.length; i++) {
      const lineY = y + i * lineHeight;
      if (lineY + fontSize > y + h) break; // clip to slot height
      this.ctx.fillText(lines[i], textX, lineY);
    }
  }

  private wrapText(text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (this.ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines;
  }
}
