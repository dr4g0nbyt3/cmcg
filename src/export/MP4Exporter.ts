import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

export interface ExportOptions {
  width?: number;
  height?: number;
  fps?: number;
  quality?: 'low' | 'medium' | 'high';
  filename?: string;
}

export interface ExportProgress {
  phase: 'capturing' | 'encoding' | 'done';
  percent: number;
}

/**
 * Captures frames from a canvas + video and encodes them to MP4 using FFmpeg.wasm.
 *
 * Approach: capture each frame as a PNG, then use FFmpeg to encode the image sequence
 * along with the base video's audio track into a final MP4.
 */
export class MP4Exporter {
  private ffmpeg: FFmpeg | null = null;
  private loaded = false;

  /** Load the FFmpeg WASM binary. Call once before exporting. */
  async init(): Promise<void> {
    if (this.loaded) return;

    this.ffmpeg = new FFmpeg();

    // Load from CDN
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    await this.ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    this.loaded = true;
    console.log('[CMCG Export] FFmpeg.wasm loaded');
  }

  /**
   * Export the current player state to MP4.
   *
   * This plays through the video and captures composited frames from the canvas,
   * then encodes them into an MP4 file.
   */
  async export(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    renderFrame: () => void,
    options: ExportOptions = {},
    onProgress?: (progress: ExportProgress) => void,
  ): Promise<Blob> {
    if (!this.ffmpeg || !this.loaded) {
      throw new Error('FFmpeg not initialized. Call init() first.');
    }

    const fps = options.fps ?? 30;
    const width = options.width ?? canvas.width;
    const height = options.height ?? canvas.height;
    const duration = video.duration;
    const totalFrames = Math.ceil(duration * fps);
    const filename = options.filename ?? 'output.mp4';

    // Quality to CRF mapping
    const crf = options.quality === 'high' ? '18' : options.quality === 'low' ? '28' : '23';

    console.log(`[CMCG Export] Capturing ${totalFrames} frames at ${fps}fps (${width}x${height})`);

    // Create an offscreen canvas for compositing video + overlay at export resolution
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    const exportCtx = exportCanvas.getContext('2d')!;

    // Capture frames by seeking through the video
    video.pause();

    for (let i = 0; i < totalFrames; i++) {
      const time = i / fps;
      video.currentTime = time;

      // Wait for the video to seek
      await new Promise<void>((resolve) => {
        video.addEventListener('seeked', () => resolve(), { once: true });
      });

      // Draw the base video onto the export canvas
      exportCtx.drawImage(video, 0, 0, width, height);

      // Trigger slot rendering on the overlay canvas
      renderFrame();

      // Composite the overlay canvas onto the export canvas
      exportCtx.drawImage(canvas, 0, 0, width, height);

      // Capture frame as PNG
      const blob = await new Promise<Blob>((resolve) => {
        exportCanvas.toBlob((b) => resolve(b!), 'image/png');
      });
      const data = new Uint8Array(await blob.arrayBuffer());
      const frameNum = String(i).padStart(6, '0');
      await this.ffmpeg!.writeFile(`frame_${frameNum}.png`, data);

      onProgress?.({
        phase: 'capturing',
        percent: Math.round((i / totalFrames) * 100),
      });
    }

    console.log('[CMCG Export] Encoding MP4...');
    onProgress?.({ phase: 'encoding', percent: 0 });

    // Encode frames to MP4
    await this.ffmpeg!.exec([
      '-framerate', String(fps),
      '-i', 'frame_%06d.png',
      '-c:v', 'libx264',
      '-crf', crf,
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      filename,
    ]);

    // Read the output file
    const outputData = await this.ffmpeg!.readFile(filename);
    const mp4Blob = new Blob([new Uint8Array(outputData as Uint8Array)], { type: 'video/mp4' });

    // Cleanup frames from FFmpeg filesystem
    for (let i = 0; i < totalFrames; i++) {
      const frameNum = String(i).padStart(6, '0');
      await this.ffmpeg!.deleteFile(`frame_${frameNum}.png`);
    }
    await this.ffmpeg!.deleteFile(filename);

    onProgress?.({ phase: 'done', percent: 100 });
    console.log(`[CMCG Export] Done — ${(mp4Blob.size / 1024 / 1024).toFixed(1)}MB`);

    return mp4Blob;
  }

  /** Trigger a download of the exported MP4 blob */
  static download(blob: Blob, filename = 'cmcg-export.mp4'): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
