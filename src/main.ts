import { CMCGPlayer } from './player/CMCGPlayer';
import { parseVariablesFromURL } from './utils/urlParams';
import { loadBundle, releaseBundle, type CMCGBundle } from './loader/BundleLoader';
import { MP4Exporter } from './export/MP4Exporter';

// ── DOM Elements ───────────────────────────────────────────────

const container = document.getElementById('player-container')!;
const playBtn = document.getElementById('play-btn')!;
const pauseBtn = document.getElementById('pause-btn')!;
const exportBtn = document.getElementById('export-btn')!;
const scrubber = document.getElementById('scrubber') as HTMLInputElement;
const timeCurrent = document.getElementById('time-current')!;
const timeTotal = document.getElementById('time-total')!;
const slotList = document.getElementById('slot-list')!;
const variableList = document.getElementById('variable-list')!;
const filePicker = document.getElementById('file-picker') as HTMLInputElement;
const exportOverlay = document.getElementById('export-overlay')!;
const exportPhase = document.getElementById('export-phase')!;
const exportBar = document.getElementById('export-bar')!;
const exportPercent = document.getElementById('export-percent')!;

// ── State ──────────────────────────────────────────────────────

const player = new CMCGPlayer(container);
let currentBundle: CMCGBundle | null = null;
let scrubbing = false;

// ── URL Param Variables ────────────────────────────────────────

const urlVars = parseVariablesFromURL();
const manifestUrl = new URLSearchParams(window.location.search).get('manifest') ?? '/manifest.json';

// ── Formatting Helpers ─────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── UI: Populate Panels ────────────────────────────────────────

function populateSlotPanel(): void {
  const manifest = player.loadedManifest;
  if (!manifest) return;

  slotList.innerHTML = manifest.slots.map((slot) => `
    <div class="slot-item">
      <span class="slot-type slot-type-${slot.type}">${slot.type}</span>
      <span class="slot-id">${slot.id}</span>
      <span class="slot-time">${slot.start}s — ${slot.start + slot.duration}s</span>
    </div>
  `).join('');
}

function populateVariablePanel(): void {
  const manifest = player.loadedManifest;
  if (!manifest) return;

  const entries = Object.entries(manifest.variables);
  if (entries.length === 0) {
    variableList.innerHTML = '<p class="muted">No variables declared</p>';
    return;
  }

  variableList.innerHTML = entries.map(([name, value]) => `
    <div class="var-item">
      <span class="var-name">${name}</span>
      <input class="var-input" data-var="${name}"
             value="${value ?? ''}"
             placeholder="null (unset)" />
    </div>
  `).join('');
}

// ── UI: Timeline Updates ───────────────────────────────────────

function updateTimeline(): void {
  if (scrubbing) return;
  const t = player.currentTime;
  const d = player.duration;
  timeCurrent.textContent = formatTime(t);
  timeTotal.textContent = formatTime(d);
  scrubber.max = String(d || 100);
  scrubber.value = String(t);
  if (player.isPlaying) requestAnimationFrame(updateTimeline);
}

// ── Load Manifest ──────────────────────────────────────────────

async function loadFromManifestUrl(url: string, vars: Record<string, string> = {}): Promise<void> {
  try {
    await player.load(url, vars);
    populateSlotPanel();
    populateVariablePanel();
    timeTotal.textContent = formatTime(player.duration);
    console.log('[CMCG] Ready to play');
  } catch (e) {
    console.error('[CMCG] Failed to load:', e);
  }
}

async function loadFromBundle(file: File): Promise<void> {
  try {
    if (currentBundle) releaseBundle(currentBundle);
    currentBundle = await loadBundle(file);
    await player.load(currentBundle.manifest, urlVars);
    populateSlotPanel();
    populateVariablePanel();
    timeTotal.textContent = formatTime(player.duration);
    console.log(`[CMCG] Loaded bundle: ${file.name}`);
  } catch (e) {
    console.error('[CMCG] Failed to load bundle:', e);
  }
}

// ── Event Handlers ─────────────────────────────────────────────

playBtn.addEventListener('click', () => {
  player.play();
  updateTimeline();
});

pauseBtn.addEventListener('click', () => {
  player.pause();
});

player.onEnded = () => {
  updateTimeline();
};

// Scrubber
scrubber.addEventListener('input', () => {
  scrubbing = true;
  const time = parseFloat(scrubber.value);
  player.seek(time);
  timeCurrent.textContent = formatTime(time);
});
scrubber.addEventListener('change', () => {
  scrubbing = false;
});

// File picker for .cmcg bundles
filePicker.addEventListener('change', () => {
  const file = filePicker.files?.[0];
  if (file) loadFromBundle(file);
});

// Export button
exportBtn.addEventListener('click', async () => {
  if (!player.loadedManifest) return;

  exportOverlay.classList.remove('hidden');
  exportPhase.textContent = 'Loading FFmpeg...';
  exportBar.style.width = '0%';
  exportPercent.textContent = '0%';

  try {
    const exporter = new MP4Exporter();
    await exporter.init();

    // Access internal video/canvas via the DOM
    const videoEl = container.querySelector('video')!;
    const canvasEl = container.querySelector('canvas')!;

    const blob = await exporter.export(
      videoEl,
      canvasEl,
      () => {
        // Trigger a manual render frame — the player reads video.currentTime
        // which we've already seeked to the correct position
      },
      {
        fps: player.loadedManifest.meta.fps,
        width: player.loadedManifest.meta.resolution[0],
        height: player.loadedManifest.meta.resolution[1],
        quality: 'high',
      },
      (progress) => {
        exportPhase.textContent = progress.phase === 'capturing' ? 'Capturing frames...'
          : progress.phase === 'encoding' ? 'Encoding MP4...'
          : 'Done!';
        exportBar.style.width = `${progress.percent}%`;
        exportPercent.textContent = `${progress.percent}%`;
      },
    );

    MP4Exporter.download(blob);
  } catch (e) {
    console.error('[CMCG Export] Failed:', e);
    exportPhase.textContent = 'Export failed — check console';
  }

  setTimeout(() => exportOverlay.classList.add('hidden'), 1500);
});

// ── Init ───────────────────────────────────────────────────────

// Update the sample manifest with text and audio demo slots
await loadFromManifestUrl(manifestUrl, urlVars);
