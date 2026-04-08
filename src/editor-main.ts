import type { CMCGManifest, Slot } from './types/manifest';
import { Timeline } from './editor/Timeline';
import { PropertyPanel } from './editor/PropertyPanel';
import { createDefaultSlot, drawSlotOverlays, hitTest, clampPosition, type DragState } from './editor/SlotEditor';
import { exportBundle, downloadBundle } from './editor/BundleExporter';
import { loadBundle, releaseBundle, type CMCGBundle } from './loader/BundleLoader';
import { CMCGPlayer } from './player/CMCGPlayer';

// ── State ──────────────────────────────────────────────────────

let manifest: CMCGManifest = {
  cmcg_version: '1.0',
  meta: { name: 'Untitled Template', resolution: [1920, 1080], fps: 30, duration: 15 },
  variables: {},
  base_video: '',
  slots: [],
};

let selectedSlotId: string | null = null;
let currentBundle: CMCGBundle | null = null;
let playing = false;

// ── DOM ────────────────────────────────────────────────────────

const video = document.getElementById('editor-video') as HTMLVideoElement;
const renderCanvas = document.getElementById('editor-render-canvas') as HTMLCanvasElement;
const overlayCanvas = document.getElementById('editor-overlay-canvas') as HTMLCanvasElement;
const renderCtx = renderCanvas.getContext('2d')!;
const overlayCtx = overlayCanvas.getContext('2d')!;
const canvasContainer = document.getElementById('editor-canvas-container')!;
const templateNameInput = document.getElementById('template-name') as HTMLInputElement;

// ── Player (for live preview) ──────────────────────────────────

const playerContainer = document.createElement('div');
playerContainer.style.display = 'none';
document.body.appendChild(playerContainer);
const player = new CMCGPlayer(playerContainer);

// ── Timeline ───────────────────────────────────────────────────

const timeline = new Timeline({
  container: document.getElementById('editor-timeline')!,
  duration: manifest.meta.duration,
  onSlotSelect: (id) => {
    selectedSlotId = id;
    updatePropertyPanel();
    renderOverlay();
  },
  onSlotTimeChange: (id, start, duration) => {
    const slot = manifest.slots.find((s) => s.id === id);
    if (slot) {
      slot.start = Math.round(start * 10) / 10;
      slot.duration = Math.round(duration * 10) / 10;
      timeline.setSlots(manifest.slots);
      updatePropertyPanel();
    }
  },
});

// ── Property Panel ─────────────────────────────────────────────

const propPanel = new PropertyPanel({
  container: document.getElementById('props-body')!,
  onUpdate: (updated) => {
    const idx = manifest.slots.findIndex((s) => s.id === selectedSlotId);
    if (idx >= 0) {
      manifest.slots[idx] = updated;
      timeline.setSlots(manifest.slots);
      renderOverlay();
    }
  },
  onDelete: (id) => {
    manifest.slots = manifest.slots.filter((s) => s.id !== id);
    selectedSlotId = null;
    timeline.setSlots(manifest.slots);
    propPanel.clear();
    renderOverlay();
  },
});

function updatePropertyPanel(): void {
  const slot = manifest.slots.find((s) => s.id === selectedSlotId);
  if (slot) {
    propPanel.show(slot);
  } else {
    propPanel.clear();
  }
}

// ── Canvas Setup ───────────────────────────────────────────────

function setupCanvas(): void {
  const [w, h] = manifest.meta.resolution;
  renderCanvas.width = w;
  renderCanvas.height = h;
  overlayCanvas.width = w;
  overlayCanvas.height = h;
}
setupCanvas();

// ── Overlay Rendering ──────────────────────────────────────────

function renderOverlay(): void {
  drawSlotOverlays(
    overlayCtx,
    manifest.slots,
    selectedSlotId,
    manifest.meta.resolution[0],
    manifest.meta.resolution[1],
    video.currentTime,
  );
}

// ── Drag & Drop on Overlay Canvas ──────────────────────────────

const drag: DragState = {
  active: false,
  mode: 'none',
  slotId: null,
  startX: 0,
  startY: 0,
  offsetX: 0,
  offsetY: 0,
};

function canvasToManifest(clientX: number, clientY: number): { x: number; y: number } {
  const rect = overlayCanvas.getBoundingClientRect();
  const scaleX = manifest.meta.resolution[0] / rect.width;
  const scaleY = manifest.meta.resolution[1] / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

overlayCanvas.addEventListener('mousedown', (e) => {
  const { x, y } = canvasToManifest(e.clientX, e.clientY);

  // Check slots in reverse order (top-most first)
  for (let i = manifest.slots.length - 1; i >= 0; i--) {
    const slot = manifest.slots[i];
    const hit = hitTest(x, y, slot);
    if (hit) {
      selectedSlotId = slot.id;
      drag.active = true;
      drag.slotId = slot.id;
      drag.startX = x;
      drag.startY = y;
      drag.mode = hit === 'resize-handle' ? 'resize' : 'move';
      drag.offsetX = x - slot.position.x;
      drag.offsetY = y - slot.position.y;

      timeline.setSelected(slot.id);
      updatePropertyPanel();
      renderOverlay();
      return;
    }
  }

  // Clicked empty space
  selectedSlotId = null;
  timeline.setSelected(null);
  propPanel.clear();
  renderOverlay();
});

overlayCanvas.addEventListener('mousemove', (e) => {
  if (!drag.active || !drag.slotId) return;
  const { x, y } = canvasToManifest(e.clientX, e.clientY);
  const slot = manifest.slots.find((s) => s.id === drag.slotId);
  if (!slot) return;

  const [cw, ch] = manifest.meta.resolution;

  if (drag.mode === 'move') {
    slot.position = clampPosition(
      { ...slot.position, x: Math.round(x - drag.offsetX), y: Math.round(y - drag.offsetY) },
      cw, ch,
    );
  } else if (drag.mode === 'resize') {
    slot.position = clampPosition(
      { ...slot.position, w: Math.round(Math.max(20, x - slot.position.x)), h: Math.round(Math.max(20, y - slot.position.y)) },
      cw, ch,
    );
  }

  renderOverlay();
  updatePropertyPanel();
});

overlayCanvas.addEventListener('mouseup', () => {
  drag.active = false;
  drag.slotId = null;
});

// ── Add Slot Buttons ───────────────────────────────────────────

document.querySelectorAll('.add-slot-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const type = (btn as HTMLElement).dataset.type as Slot['type'];
    const [w, h] = manifest.meta.resolution;
    const newSlot = createDefaultSlot(
      type,
      { x: Math.round(w * 0.1), y: Math.round(h * 0.1), w: Math.round(w * 0.3), h: Math.round(h * 0.15) },
      manifest.meta.duration,
    );
    manifest.slots.push(newSlot);
    selectedSlotId = newSlot.id;

    timeline.setSlots(manifest.slots);
    timeline.setSelected(newSlot.id);
    updatePropertyPanel();
    renderOverlay();
  });
});

// ── Playback ───────────────────────────────────────────────────

let animFrame = 0;
function playbackLoop(): void {
  if (!playing) return;
  timeline.setPlayhead(video.currentTime);
  renderOverlay();
  animFrame = requestAnimationFrame(playbackLoop);
}

document.getElementById('editor-play-btn')!.addEventListener('click', () => {
  playing = true;
  video.play();
  playbackLoop();
});

document.getElementById('editor-pause-btn')!.addEventListener('click', () => {
  playing = false;
  video.pause();
  cancelAnimationFrame(animFrame);
});

video.addEventListener('timeupdate', () => {
  const t = video.currentTime;
  const d = manifest.meta.duration;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  document.getElementById('editor-time')!.textContent = `${fmt(t)} / ${fmt(d)}`;
});

// ── File Operations ────────────────────────────────────────────

// Load base video
document.getElementById('load-video-btn')!.addEventListener('click', () => {
  (document.getElementById('video-picker') as HTMLInputElement).click();
});

document.getElementById('video-picker')!.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  video.src = url;
  manifest.base_video = file.name;
  video.addEventListener('loadedmetadata', () => {
    manifest.meta.duration = video.duration;
    manifest.meta.resolution = [video.videoWidth, video.videoHeight];
    setupCanvas();
    timeline.setSlots(manifest.slots);
    renderOverlay();
  }, { once: true });
});

// Open .cmcg bundle
document.getElementById('open-cmcg-btn')!.addEventListener('click', () => {
  (document.getElementById('cmcg-picker') as HTMLInputElement).click();
});

document.getElementById('cmcg-picker')!.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (currentBundle) releaseBundle(currentBundle);
  currentBundle = await loadBundle(file);
  manifest = currentBundle.manifest;
  templateNameInput.value = manifest.meta.name;
  video.src = manifest.base_video;
  setupCanvas();
  timeline.setSlots(manifest.slots);
  selectedSlotId = null;
  propPanel.clear();
  renderOverlay();
});

// Save .cmcg bundle
document.getElementById('save-cmcg-btn')!.addEventListener('click', async () => {
  manifest.meta.name = templateNameInput.value;
  const blob = await exportBundle(manifest);
  downloadBundle(blob, `${manifest.meta.name.replace(/\s+/g, '-').toLowerCase()}.cmcg`);
});

// Export JSON
document.getElementById('save-json-btn')!.addEventListener('click', () => {
  manifest.meta.name = templateNameInput.value;
  const json = JSON.stringify(manifest, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'manifest.json';
  a.click();
  URL.revokeObjectURL(url);
});

// Template name sync
templateNameInput.addEventListener('input', () => {
  manifest.meta.name = templateNameInput.value;
});
