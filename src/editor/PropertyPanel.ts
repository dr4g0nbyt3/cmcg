import type { Slot } from '../types/manifest';

export interface PropertyPanelConfig {
  container: HTMLElement;
  onUpdate: (slot: Slot) => void;
  onDelete: (slotId: string) => void;
}

/**
 * Property panel for editing the selected slot's properties.
 * Renders a form with fields for position, source, text style, etc.
 */
export class PropertyPanel {
  private container: HTMLElement;
  private config: PropertyPanelConfig;
  private currentSlot: Slot | null = null;

  constructor(config: PropertyPanelConfig) {
    this.config = config;
    this.container = config.container;
  }

  show(slot: Slot): void {
    this.currentSlot = slot;
    this.render();
  }

  clear(): void {
    this.currentSlot = null;
    this.container.innerHTML = '<p class="muted">Select a slot to edit properties</p>';
  }

  private render(): void {
    const slot = this.currentSlot;
    if (!slot) return this.clear();

    const isText = slot.type === 'text';
    const textStyle = slot.text;

    this.container.innerHTML = `
      <div class="prop-section">
        <div class="prop-row">
          <label>ID</label>
          <input type="text" data-field="id" value="${slot.id}" />
        </div>
        <div class="prop-row">
          <label>Type</label>
          <select data-field="type">
            ${['image', 'video', 'text', 'audio', 'overlay'].map(
              (t) => `<option value="${t}" ${t === slot.type ? 'selected' : ''}>${t}</option>`
            ).join('')}
          </select>
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-section-title">Position</div>
        <div class="prop-grid">
          <div class="prop-row"><label>X</label><input type="number" data-field="position.x" value="${slot.position.x}" /></div>
          <div class="prop-row"><label>Y</label><input type="number" data-field="position.y" value="${slot.position.y}" /></div>
          <div class="prop-row"><label>W</label><input type="number" data-field="position.w" value="${slot.position.w}" /></div>
          <div class="prop-row"><label>H</label><input type="number" data-field="position.h" value="${slot.position.h}" /></div>
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-section-title">Timing</div>
        <div class="prop-grid">
          <div class="prop-row"><label>Start</label><input type="number" step="0.1" data-field="start" value="${slot.start}" /></div>
          <div class="prop-row"><label>Duration</label><input type="number" step="0.1" data-field="duration" value="${slot.duration}" /></div>
        </div>
      </div>

      ${!isText ? `
      <div class="prop-section">
        <div class="prop-section-title">Source</div>
        <div class="prop-row"><label>Variable</label><input type="text" data-field="source.variable" value="${slot.source.variable ?? ''}" placeholder="$varName" /></div>
        <div class="prop-row"><label>Remote</label><input type="text" data-field="source.remote" value="${slot.source.remote ?? ''}" placeholder="https://..." /></div>
        <div class="prop-row"><label>Local</label><input type="text" data-field="source.local" value="${slot.source.local ?? ''}" placeholder="./assets/file.png" /></div>
        <div class="prop-row"><label>Fallback</label><input type="text" data-field="source.fallback" value="${slot.source.fallback ?? ''}" placeholder="./assets/fallback.png" /></div>
      </div>
      ` : ''}

      ${isText && textStyle ? `
      <div class="prop-section">
        <div class="prop-section-title">Text</div>
        <div class="prop-row"><label>Content</label><textarea data-field="text.content" rows="2">${textStyle.content}</textarea></div>
        <div class="prop-grid">
          <div class="prop-row"><label>Size</label><input type="number" data-field="text.fontSize" value="${textStyle.fontSize ?? 24}" /></div>
          <div class="prop-row"><label>Weight</label><input type="text" data-field="text.fontWeight" value="${textStyle.fontWeight ?? '400'}" /></div>
          <div class="prop-row"><label>Color</label><input type="color" data-field="text.color" value="${textStyle.color ?? '#ffffff'}" /></div>
          <div class="prop-row">
            <label>Align</label>
            <select data-field="text.align">
              ${['left', 'center', 'right'].map(
                (a) => `<option value="${a}" ${a === textStyle.align ? 'selected' : ''}>${a}</option>`
              ).join('')}
            </select>
          </div>
        </div>
        <div class="prop-row"><label>Font</label><input type="text" data-field="text.fontFamily" value="${textStyle.fontFamily ?? 'system-ui'}" /></div>
        <div class="prop-row"><label>Background</label><input type="text" data-field="text.background" value="${textStyle.background ?? ''}" placeholder="rgba(0,0,0,0.5)" /></div>
      </div>
      ` : ''}

      <div class="prop-section">
        <button class="btn-delete" id="delete-slot-btn">Delete Slot</button>
      </div>
    `;

    // Bind events
    this.container.querySelectorAll('input, select, textarea').forEach((el) => {
      el.addEventListener('change', () => this.handleChange(el as HTMLInputElement));
    });

    this.container.querySelector('#delete-slot-btn')?.addEventListener('click', () => {
      if (this.currentSlot) {
        this.config.onDelete(this.currentSlot.id);
      }
    });
  }

  private handleChange(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
    if (!this.currentSlot) return;

    const field = el.dataset.field!;
    const value = el.type === 'number' ? parseFloat(el.value) : el.value;
    const parts = field.split('.');

    // Deep set the value
    let obj: any = this.currentSlot;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;

    this.config.onUpdate({ ...this.currentSlot });
  }
}
