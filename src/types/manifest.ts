/** Position and dimensions of a slot on the video canvas */
export interface SlotPosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Source resolver chain — checked in priority order: variable → local → remote → fallback */
export interface SlotSource {
  variable?: string;
  local?: string;
  remote?: string;
  fallback?: string;
}

/** Text rendering properties for text-type slots */
export interface TextStyle {
  content: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  color?: string;
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
  background?: string;
  padding?: number;
}

/** A single media slot in the CMCG timeline */
export interface Slot {
  id: string;
  type: 'image' | 'video' | 'text' | 'audio' | 'overlay';
  start: number;
  duration: number;
  position: SlotPosition;
  source: SlotSource;
  cache?: 'none' | 'session' | 'permanent';
  fetchTimeout?: number;
  text?: TextStyle;
  /** Volume for audio/video slots (0.0 - 1.0) */
  volume?: number;
  /** Whether a video slot should loop within its duration */
  loop?: boolean;
}

/** Video metadata */
export interface ManifestMeta {
  name: string;
  resolution: [number, number];
  fps: number;
  duration: number;
}

/** Top-level .cmcg manifest schema */
export interface CMCGManifest {
  cmcg_version: string;
  meta: ManifestMeta;
  variables: Record<string, string | null>;
  base_video: string;
  slots: Slot[];
}
