# Design — Hallucinating Splines

The city observatory direction was approved September 23, 2026. Watching and building receive equal emphasis. Preserve the existing identity and routes; extend this system instead of choosing a new theme per page.

## Genre and structure
Playful simulation, with restrained interface chrome. Home uses a Workbench adaptation: a real interactive city and explicit playback beside a build guide. Equal Watch / Build links precede both panels, including on mobile. City detail uses a map workspace with clearly separated current and recorded states. Directory and rankings use dense data views. Docs use a long document with connection choices and a first-city prompt.

## Identity
Keep Press Start 2P for the wordmark, the system face for readable headings and controls, and Space Mono for code. Keep navy, cream and teal. Micropolis sprites are product content, not decoration. Preserve engine credits and Dr. Wright. No generated city images, decorative gradients or fake status tickers. Homepage gallery thumbnails may cycle through real recorded maps and the current view, with each frame labeled; other uses of CityCard keep the current map.

## Tokens
Canonical CSS: `site/public/styles/tokens.css`, loaded after the legacy global stylesheet. Existing token names are retained so all routes inherit the same system. Global CSS is extended in place. Teal fills use cream text; teal links use the lighter accent. Status colors are functional. Current chart colors are shared tokens.

## Typography and spacing
Body: 16px; supporting text: 14px; captions: 12px. No pixel font on small buttons. Roman headings with fluid sizing. Named spacing scale: 8 / 12 / 16 / 32 / 56px. Grid tracks with imagery use minmax(0, …). Controls have 44px minimum targets, immediate focus outlines, single-line labels and wrapping parent groups. Data uses tabular numerals.

## Interaction
Featured and city-detail playback requires an explicit action. Visible Play / Pause / Current view controls; slower playback for reduced motion. The homepage collection uses ambient snapshot previews that pause off screen and stay on the current map when reduced motion is requested. Failed or late requests cannot replace a newer selection. Historical metrics are labeled and limited to what snapshots contain. Current statistics are hidden while a recorded map is displayed. Empty history and errors have visible states. Copy controls remain visible for touch and keyboard users and announce success/failure. Rankings work through real query links, including without JavaScript.

## Content and honesty
“Recently updated” describes sorting, “Active” describes city status. Gallery data is labeled as listed metadata; detail data comes from current simulation state. The known metadata/current-state discrepancy needs a separate API investigation; do not rewrite historical data to make values agree. Counts are fetched, never invented. An inactive or ended city may be featured if it has useful recorded history, with its status visible.

## Route ownership
Existing routes and engine/API behavior remain intact. Shared CityCard owns thumbnails on both the homepage and mayor pages, with ambient replay enabled only on the homepage. FeaturedCity reuses MapViewer and HistoryScrubber. No new framework or image service.

## Verification
Check homepage, city detail, docs, rankings, directory and mayor pages at 320 / 375 / 414 / 768px. Check desktop composition, no root overflow, labels, focus, replay → pause → current view, docs tabs/copy, ranking category/pagination. Run the site build, site TypeScript and snapshot-loader tests. Preserve the prior design review as a dated evidence artifact.

## Exports

Use the canonical token file for this Astro project. These mappings are optional integration examples, not additional runtime dependencies.

### CSS
```css
@import './site/public/styles/tokens.css';
```

### Tailwind v4
```css
@theme inline {
  --color-background: var(--bg);
  --color-foreground: var(--text);
  --color-muted: var(--text-muted);
  --color-primary: var(--accent);
  --color-primary-foreground: var(--text);
  --color-border: var(--border);
  --font-sans: var(--system);
  --font-mono: var(--mono);
}
```

### DTCG
```json
{
  "background": {"$type":"color","$value":{"colorSpace":"srgb","components":[0.1059,0.1333,0.2196],"alpha":1}},
  "foreground": {"$type":"color","$value":{"colorSpace":"srgb","components":[0.9490,0.9255,0.8745],"alpha":1}},
  "accent": {"$type":"color","$value":{"colorSpace":"srgb","components":[0.1569,0.3725,0.3765],"alpha":1}}
}
```

### shadcn/ui mapping
```css
:root {
  --background: var(--bg);
  --foreground: var(--text);
  --primary: var(--accent);
  --primary-foreground: var(--text);
  --muted-foreground: var(--text-muted);
  --ring: var(--focus);
}
```
