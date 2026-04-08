<p align="center">
  <img src="assets/logo.svg" alt="CMCG Logo" width="120" />
</p>

<h1 align="center">CMCG</h1>

<p align="center">
  <strong>Connected Media Container & Generator</strong><br/>
  A dynamic video template format — like HTML, but for video.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-BUSL--1.1-blue" alt="License" /></a>
  <a href="#"><img src="https://img.shields.io/badge/version-0.1.0-4fffb0" alt="Version" /></a>
  <a href="https://github.com/dr4g0nbyt3/cmcg/actions"><img src="https://github.com/dr4g0nbyt3/cmcg/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
</p>

<p align="center">
  <img src="assets/demo.gif" alt="CMCG Demo" width="720" />
</p>

---

## The Problem

Video is the most rigid media format on the internet. To change a single image in a 30-second ad, you re-open your editor, swap the asset, re-render, re-upload, and re-distribute. Multiply that by 50 audience segments, 4 seasons, and 3 platforms — and you've got a production bottleneck that costs teams thousands of hours a year.

**CMCG fixes this.** A `.cmcg` file is a video template where media slots (images, clips, audio, text) resolve from live URLs or variables at play time. Swap an ad image by changing a URL. Generate 1,000 personalized videos by passing different variables. No re-encoding. No re-rendering. No re-uploading.

## Quick Start

```bash
git clone https://github.com/dr4g0nbyt3/cmcg.git
cd cmcg
npm install
npm run dev
```

Open `http://localhost:5173` — you'll see a base video with dynamic image slots composited on top via Canvas.

## Features

- **Slot-based video templates** — Define image, video, audio, and text slots on a video timeline
- **Source resolver chain** — Each slot checks: variable → local file → remote URL → fallback
- **Variable injection** — Pass content into templates via URL params, environment variables, or API
- **Live playback** — Play `.cmcg` templates in the browser with real-time slot compositing
- **MP4 export** — Bake any template into a static `.mp4` with all slots resolved *(Phase 2)*
- **Open format** — JSON manifest + bundled assets in a ZIP-like container
- **Privacy-first personalization** — Contextual signals, not behavioral tracking

## How It Works

```
┌─────────────────────────────────────────────────┐
│                 .cmcg Template                   │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ manifest  │  │ /assets/ │  │  /base/  │      │
│  │  .json    │  │ fallback │  │  video   │      │
│  │          │  │  assets  │  │  layers  │      │
│  └────┬─────┘  └──────────┘  └──────────┘      │
│       │                                          │
└───────┼──────────────────────────────────────────┘
        │
        ▼
┌──────────────────┐     ┌──────────────────┐
│  Source Resolver  │────▶│   CMCG Player    │
│                  │     │                  │
│  $variable?      │     │  <video> base    │
│  local file?     │     │  <canvas> slots  │
│  remote URL?     │     │  rAF render loop │
│  fallback?       │     │                  │
└──────────────────┘     └──────────────────┘
```

A `.cmcg` file is a bundle containing:
- **manifest.json** — Timeline definition with slots, timing, resolution, and variable declarations
- **/assets/** — Optional embedded fallback assets
- **/base/** — Static base video layer(s)
- **config.json** — Runtime settings and default variables

The player loads the manifest, resolves each slot's media source through the priority chain, preloads assets, and composites them onto a canvas overlaying the base video in a `requestAnimationFrame` loop.

## Example Manifest

```json
{
  "cmcg_version": "1.0",
  "meta": {
    "name": "Summer Ad Template",
    "resolution": [1920, 1080],
    "fps": 30,
    "duration": 30.0
  },
  "variables": {
    "$adImage": null,
    "$brandColor": "#ff6b6b"
  },
  "base_video": "./base/background.mp4",
  "slots": [
    {
      "id": "slot_ad_banner",
      "type": "image",
      "start": 2.0,
      "duration": 8.0,
      "position": { "x": 40, "y": 620, "w": 1840, "h": 200 },
      "source": {
        "variable": "$adImage",
        "remote": "https://cdn.example.com/ads/current.jpg",
        "fallback": "./assets/placeholder.png"
      },
      "cache": "session",
      "fetchTimeout": 3000
    }
  ]
}
```

## Use Cases

| Who | What | How |
|---|---|---|
| **Ad agencies** | 50 ad variants from one template | Pass different `$productImage` per audience segment |
| **Churches** | Weekly announcement videos | Non-technical volunteer updates image URLs in a form |
| **Esports orgs** | Auto-generated winner highlights | Tournament system injects player data via API |
| **Game devs** | Living trailers | Trailer slots point to press kit URLs — always up to date |
| **Small businesses** | Self-serve promo videos | Update a sale image and export to MP4, no designer needed |
| **SaaS platforms** | Programmatic video generation | REST API + variable map = thousands of personalized videos |

## Roadmap

| Phase | Status | Description |
|---|---|---|
| 1. Spec & PoC | **Current** | Manifest schema, TypeScript canvas player, image slot compositing |
| 2. Web Player MVP | Next | Multi-slot types, URL param variables, FFmpeg.wasm export |
| 3. CLI Renderer | Planned | Rust-based CLI for server-side/batch MP4 rendering |
| 4. Template Editor | Planned | Visual drag-and-drop editor for creating .cmcg templates |
| 5. API & Marketplace | Planned | Batch render API, template marketplace, SaaS layer |

## Project Structure

```
cmcg/
├── src/
│   ├── types/manifest.ts         # .cmcg manifest schema (TypeScript interfaces)
│   ├── player/CMCGPlayer.ts      # Core player — video + canvas + render loop
│   ├── player/SourceResolver.ts  # Source resolution: variable → local → remote → fallback
│   ├── main.ts                   # Demo entry point
│   └── style.css
├── sample/                       # Sample template served by Vite
│   ├── manifest.json
│   ├── assets/                   # Placeholder SVG fallbacks
│   └── base/background.mp4
├── docs/                         # Product design document
└── index.html                    # Demo page
```

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and guidelines.

If you're looking for a place to start, check out issues labeled [`good first issue`](https://github.com/dr4g0nbyt3/cmcg/labels/good%20first%20issue).

## License

CMCG is released under the [Business Source License 1.1](LICENSE). The spec and reference player are open for non-production use. Commercial use requires a license from [Nostalgia Nuke LLC](https://github.com/dr4g0nbyt3).

---

<p align="center">
  <sub>Built by <a href="https://github.com/dr4g0nbyt3">Nostalgia Nuke LLC</a></sub>
</p>
