import type { Slot } from '../types/manifest';

export interface TimelineConfig {
  container: HTMLElement;
  duration: number;
  onSlotSelect: (slotId: string | null) => void;
  onSlotTimeChange: (slotId: string, start: number, duration: number) => void;
}

const TRACK_HEIGHT = 32;
const HEADER_HEIGHT = 28;
const COLORS: Record<string, string> = {
  image: '#4fffb0',
  video: '#7b61ff',
  text: '#ffaf32',
  audio: '#619cff',
  overlay: '#ff6b6b',
};

/**
 * Timeline component for editing slot timing.
 * Renders a horizontal track view where each slot is a colored bar
 * that can be dragged to adjust start/duration.
 */
export class Timeline {
  private canvas: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private config: TimelineConfig;
  private slots: Slot[] = [];
  private selectedId: string | null = null;
  private playheadTime = 0;
  private dragging: { slotId: string; mode: 'move' | 'resize-end'; offsetX: number } | null = null;

  constructor(config: TimelineConfig) {
    this.config = config;

    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.cursor = 'pointer';
    this.config.container.appendChild(this.canvas);

    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('mouseleave', this.onMouseUp);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setSlots(slots: Slot[]): void {
    this.slots = slots;
    this.resize();
    this.render();
  }

  setPlayhead(time: number): void {
    this.playheadTime = time;
    this.render();
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
    this.render();
  }

  private resize(): void {
    const rect = this.config.container.getBoundingClientRect();
    const height = HEADER_HEIGHT + Math.max(this.slots.length, 1) * TRACK_HEIGHT + 8;
    this.canvas.width = rect.width * devicePixelRatio;
    this.canvas.height = height * devicePixelRatio;
    this.canvas.style.height = `${height}px`;
    this.ctx.resetTransform();
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(devicePixelRatio, devicePixelRatio);
  }

  private get pxPerSecond(): number {
    return (this.canvas.width / devicePixelRatio) / this.config.duration;
  }

  render(): void {
    const w = this.canvas.width / devicePixelRatio;
    const totalH = this.canvas.height / devicePixelRatio;

    this.ctx.clearRect(0, 0, w, totalH);

    // Background
    this.ctx.fillStyle = '#131520';
    this.ctx.fillRect(0, 0, w, totalH);

    // Time markers
    this.ctx.fillStyle = '#7b7f9e';
    this.ctx.font = '10px monospace';
    const step = this.config.duration <= 30 ? 1 : this.config.duration <= 120 ? 5 : 10;
    for (let t = 0; t <= this.config.duration; t += step) {
      const x = t * this.pxPerSecond;
      this.ctx.fillStyle = '#252840';
      this.ctx.fillRect(x, HEADER_HEIGHT, 1, totalH);
      this.ctx.fillStyle = '#7b7f9e';
      this.ctx.fillText(`${t}s`, x + 3, 18);
    }

    // Slot tracks
    this.slots.forEach((slot, i) => {
      const y = HEADER_HEIGHT + i * TRACK_HEIGHT + 4;
      const x = slot.start * this.pxPerSecond;
      const barW = slot.duration * this.pxPerSecond;
      const color = COLORS[slot.type] ?? '#ffffff';
      const selected = slot.id === this.selectedId;

      // Track background
      this.ctx.fillStyle = selected ? 'rgba(79,255,176,0.08)' : 'rgba(255,255,255,0.02)';
      this.ctx.fillRect(0, y - 2, w, TRACK_HEIGHT - 2);

      // Slot bar
      this.ctx.fillStyle = selected ? color : `${color}88`;
      this.ctx.beginPath();
      this.ctx.roundRect(x, y, barW, TRACK_HEIGHT - 8, 4);
      this.ctx.fill();

      // Border
      if (selected) {
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.roundRect(x, y, barW, TRACK_HEIGHT - 8, 4);
        this.ctx.stroke();
      }

      // Label
      this.ctx.fillStyle = '#0b0c10';
      this.ctx.font = '10px monospace';
      this.ctx.fillText(slot.id, x + 6, y + 16);
    });

    // Playhead
    const px = this.playheadTime * this.pxPerSecond;
    this.ctx.strokeStyle = '#ff6b6b';
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.moveTo(px, 0);
    this.ctx.lineTo(px, totalH);
    this.ctx.stroke();

    // Playhead triangle
    this.ctx.fillStyle = '#ff6b6b';
    this.ctx.beginPath();
    this.ctx.moveTo(px - 5, 0);
    this.ctx.lineTo(px + 5, 0);
    this.ctx.lineTo(px, 8);
    this.ctx.fill();
  }

  // ── Mouse interaction ────────────────────────────────────────

  private onMouseDown = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    for (let i = this.slots.length - 1; i >= 0; i--) {
      const slot = this.slots[i];
      const y = HEADER_HEIGHT + i * TRACK_HEIGHT + 4;
      const x = slot.start * this.pxPerSecond;
      const barW = slot.duration * this.pxPerSecond;

      if (my >= y && my <= y + TRACK_HEIGHT - 8 && mx >= x && mx <= x + barW) {
        this.selectedId = slot.id;
        this.config.onSlotSelect(slot.id);

        // Check if near the right edge (resize)
        if (mx >= x + barW - 8) {
          this.dragging = { slotId: slot.id, mode: 'resize-end', offsetX: 0 };
        } else {
          this.dragging = { slotId: slot.id, mode: 'move', offsetX: mx - x };
        }
        this.render();
        return;
      }
    }

    // Clicked empty space — deselect
    this.selectedId = null;
    this.config.onSlotSelect(null);
    this.render();
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.dragging) return;
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;

    const slot = this.slots.find((s) => s.id === this.dragging!.slotId);
    if (!slot) return;

    if (this.dragging.mode === 'move') {
      const newStart = Math.max(0, (mx - this.dragging.offsetX) / this.pxPerSecond);
      const clamped = Math.min(newStart, this.config.duration - slot.duration);
      this.config.onSlotTimeChange(slot.id, clamped, slot.duration);
    } else if (this.dragging.mode === 'resize-end') {
      const newEnd = Math.max(slot.start + 0.1, mx / this.pxPerSecond);
      const newDuration = Math.min(newEnd - slot.start, this.config.duration - slot.start);
      this.config.onSlotTimeChange(slot.id, slot.start, newDuration);
    }
  };

  private onMouseUp = (): void => {
    this.dragging = null;
  };
}
