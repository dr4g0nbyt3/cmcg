import type { Slot, SlotPosition, TextStyle } from '../types/manifest';

export interface DragState {
  active: boolean;
  mode: 'move' | 'resize' | 'create' | 'none';
  slotId: string | null;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
}

let nextSlotId = 1;

/** Generate a unique slot ID */
export function generateSlotId(type: string): string {
  return `slot_${type}_${nextSlotId++}`;
}

/** Create a default slot of the given type */
export function createDefaultSlot(
  type: Slot['type'],
  position: SlotPosition,
  duration: number,
  startTime = 0,
): Slot {
  const id = generateSlotId(type);

  const base: Slot = {
    id,
    type,
    start: startTime,
    duration,
    position,
    source: {},
  };

  if (type === 'text') {
    base.text = {
      content: 'New Text',
      fontSize: 32,
      fontWeight: '400',
      color: '#ffffff',
      fontFamily: 'system-ui, sans-serif',
      align: 'left',
      lineHeight: 40,
    };
  }

  return base;
}

/** Hit test: is the point inside the slot's bounding box? */
export function hitTest(
  x: number,
  y: number,
  slot: Slot,
): 'body' | 'resize-handle' | null {
  const { position: p } = slot;
  const handleSize = 12;

  // Check resize handle (bottom-right corner)
  if (
    x >= p.x + p.w - handleSize &&
    x <= p.x + p.w + handleSize &&
    y >= p.y + p.h - handleSize &&
    y <= p.y + p.h + handleSize
  ) {
    return 'resize-handle';
  }

  // Check body
  if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) {
    return 'body';
  }

  return null;
}

/** Clamp a position within canvas bounds */
export function clampPosition(
  pos: SlotPosition,
  canvasWidth: number,
  canvasHeight: number,
): SlotPosition {
  return {
    x: Math.max(0, Math.min(pos.x, canvasWidth - pos.w)),
    y: Math.max(0, Math.min(pos.y, canvasHeight - pos.h)),
    w: Math.max(20, Math.min(pos.w, canvasWidth)),
    h: Math.max(20, Math.min(pos.h, canvasHeight)),
  };
}

/** Draw slot outlines and handles on the editor overlay canvas */
export function drawSlotOverlays(
  ctx: CanvasRenderingContext2D,
  slots: Slot[],
  selectedId: string | null,
  canvasWidth: number,
  canvasHeight: number,
  currentTime: number,
): void {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  for (const slot of slots) {
    const active = currentTime >= slot.start && currentTime < slot.start + slot.duration;
    const selected = slot.id === selectedId;
    const { x, y, w, h } = slot.position;

    // Slot outline
    ctx.strokeStyle = selected ? '#4fffb0' : active ? 'rgba(123,97,255,0.6)' : 'rgba(255,255,255,0.2)';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.setLineDash(selected ? [] : [4, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    // Label
    ctx.fillStyle = selected ? '#4fffb0' : 'rgba(255,255,255,0.5)';
    ctx.font = '11px monospace';
    ctx.fillText(`${slot.id} [${slot.type}]`, x + 4, y - 4);

    // Resize handle for selected slot
    if (selected) {
      ctx.fillStyle = '#4fffb0';
      ctx.fillRect(x + w - 6, y + h - 6, 12, 12);
    }
  }
}
