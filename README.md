# Fabdale Product Data Scraper

Playwright scraper that turns Batuly's Fabdale product export into resumable Flipkart source data and deduplicated media for a later Laravel import.

The scraper reads Batuly data and public Flipkart pages. It does **not** update Batuly or upload files to Datahub S3.

## Current readiness

Ready and live-validated for controlled sample crawls:

- CSV, JSON, or single-URL input
- Highest exposed 1500px Flipkart gallery images at `q=100`
- Exact Flipkart PID deduplication
- Shared image bundles for identical galleries
- Independent video bundles when matching galleries expose different videos
- Persistent resume, retry, statuses, attempts, and errors
- Atomic progress writes and graceful interruption
- Product-ID, status, offset, and limit controls
- Flipkart Product highlights extracted as importer-facing specifications

Not yet ready for an unattended complete catalog crawl:

- It does not discover every color swatch within a Flipkart product family.
- It only scrapes Flipkart URLs/PIDs already present in the Batuly export.
- It does not yet produce an explicit family → color → size mapping.
- The Laravel/Datahub S3 importer is not implemented.

Before crawling the complete catalog, add color-family discovery so every color gets one gallery while sizes reuse that color's gallery.

## Requirements

- Node.js 20+
- npm

## Install

```bash
npm install
npm run install:browsers
```

## Export Batuly input

From Batuly's `fix/fabdale-dynamic-attribute-backfill` branch:

```bash
php artisan app:export-fabdale-scraper-input --no-interaction
```

Default output:

```text
storage/app/fabdale-product-scraper-input.csv
```

Columns:

```text
product_id,sku,name,parent_id,notes,flipkart_url
```

`product_id` is the future import key. `parent_id` is context only; current parent assignments are not assumed to be final.

## Run a controlled sample

Use a dedicated output directory because it is also the persistent crawl state:

```bash
npm run scrape -- \
  --input /home/pratik/sites/batuly/storage/app/fabdale-product-scraper-input.csv \
  --output data/fabdale-sample \
  --limit 10 \
  --image-quality 100 \
  --max-attempts 3 \
  --delay 1000
```

Show Chromium while validating selectors:

```bash
npm run scrape -- \
  --input /home/pratik/sites/batuly/storage/app/fabdale-product-scraper-input.csv \
  --output data/fabdale-sample \
  --limit 10 \
  --headed
```

Scrape selected Batuly product IDs:

```bash
npm run scrape -- \
  --input /home/pratik/sites/batuly/storage/app/fabdale-product-scraper-input.csv \
  --output data/fabdale-sample \
  --product-id 257 \
  --product-id 447
```

Single URL mode:

```bash
npm run scrape -- \
  --url "https://www.flipkart.com/..." \
  --sku "Fab-Dress-PURNB-001PK-S" \
  --product-id 1234 \
  --output data/single-product
```

## Resume

Run the same input with the same output directory:

```bash
npm run scrape -- \
  --input /home/pratik/sites/batuly/storage/app/fabdale-product-scraper-input.csv \
  --output data/fabdale-sample
```

A source resumes only when:

- Its extraction version and crawl settings match.
- Its saved status is successful, including recovery from a stale `processing` state.
- `source.json` is valid.
- Every claimed downloaded asset exists and is non-empty.

If every selected source is complete, Chromium is not launched.

Changing image quality or media mode causes affected sources to be refreshed. Use a new output directory when the scraper reports an unsupported legacy manifest schema.

## Retry failures

Retry previously failed, partial, or blocked sources:

```bash
npm run scrape -- \
  --input /home/pratik/sites/batuly/storage/app/fabdale-product-scraper-input.csv \
  --output data/fabdale-sample \
  --retry-failed \
  --max-attempts 3 \
  --retry-delay 2000
```

Limit the retry run by status:

```bash
npm run scrape -- \
  --input /home/pratik/sites/batuly/storage/app/fabdale-product-scraper-input.csv \
  --output data/fabdale-sample \
  --status failed \
  --status partial \
  --retry-failed
```

`--max-attempts` applies per source for the current run. Retry delays increase exponentially. Total attempt counts and the latest error persist across runs. Blocked pages are recorded without bypassing access controls and may be retried in a later `--retry-failed` run.

Use `--force` only when successful sources must be refreshed:

```bash
npm run scrape -- \
  --input /home/pratik/sites/batuly/storage/app/fabdale-product-scraper-input.csv \
  --output data/fabdale-sample \
  --product-id 257 \
  --force
```

## Controls

There is currently no UI. Control and monitoring are CLI/JSON based.

```text
--output <dir>           Output and persistent state directory
--product-id <id>       Select IDs; repeat or comma-separate
--status <status>       Select queued/processing/success/partial/blocked/failed
--offset <n>            Skip rows before applying --limit
--limit <n>             Limit selected input rows
--delay <ms>            Delay between unique sources (default: 1000)
--retry-delay <ms>      Initial exponential retry delay (default: 2000)
--max-attempts <n>      Attempts per source in this run (default: 3)
--image-quality <1-100> Flipkart image quality (default: 100)
--retry-failed          Retry prior failed, partial, or blocked sources
--force                 Refresh verified successful sources
--no-media              Extract media metadata without downloading files
--headed                Show Chromium
--help                  Show current CLI help
```

Authoritative CLI reference:

```bash
npm run scrape -- --help
```

## Statuses and interruption

Statuses:

- `queued`: selected but not started
- `processing`: attempt started
- `success`: content succeeded and downloadable media completed
- `partial`: content succeeded but one or more media assets failed
- `blocked`: captcha, access-denied, unavailable, or equivalent page
- `failed`: browser, navigation, extraction, or other runtime failure

Press Ctrl+C once to request a graceful stop. The scraper finishes the current source, writes its state, and exits. Run the same command to resume.

Progress is written atomically to small per-source state files. The global manifest is checkpointed periodically and on clean shutdown; startup reconciles per-source state before continuing.

## Output model

```text
data/fabdale-sample/
├── manifest.json
├── products/
│   └── 1234/
│       └── product.json
├── sources/
│   └── pid-DREGM8YTW9FANWXM/
│       ├── state.json
│       └── source.json
└── media/
    ├── images/
    │   └── <gallery-fingerprint>/
    │       ├── media.json
    │       └── assets/images/image-001.jpg
    └── videos/
        └── <video-fingerprint>/
            └── media.json
```

Responsibilities:

- `manifest.json`: crawl-wide summary and product/source index
- `products/<product_id>/product.json`: Batuly identity plus resolved source/media references
- `sources/<source_key>/source.json`: one Flipkart extraction result
- `sources/<source_key>/state.json`: durable status, attempts, timestamps, and error
- `media/images/<fingerprint>`: one downloaded image gallery shared wherever identical
- `media/videos/<fingerprint>`: video metadata/assets independently deduplicated

Rows with the same exact Flipkart PID share one source extraction. Different PIDs retain separate content and Product highlights. Identical image galleries can still share one image bundle across PIDs. Video fingerprints remain independent so image equality never merges different videos.

## Extracted data

Each Batuly product result preserves:

- `product_id`, SKU, current name, current `parent_id`, and notes
- source URL, final URL, scrape timestamps, status, attempts, and error
- Flipkart title
- compact Product-highlights summary
- long description/feature sections when exposed
- product-scoped JSON-LD
- raw DOM extraction for later normalization improvements
- product gallery images and video metadata

### Product attributes contract

Importer-facing `content.specifications` contains only Flipkart's **Product highlights** pairs, for example:

```json
{
  "Color": "Black",
  "Length": "Ankle Length",
  "Pattern": "Floral Print",
  "Type": "Fit and Flare",
  "Sleeve Length": "3/4 Sleeve",
  "Sleeve": "3/4 Sleeve"
}
```

These are intended to become Batuly product attributes that describe the product and are not assumed to define variants.

The broader Flipkart Specifications-tab extraction is preserved only under `raw.dom.specifications`. It must not be imported as Batuly product attributes. Original Product highlights are also preserved under `raw.dom.product_highlights`.

## Media behavior

- Product-scoped JSON-LD is preferred over broad DOM image collection to avoid banners, reviews, and recommendations.
- Flipkart's exposed 1500px gallery URLs are requested at `q=100` by default.
- `source_url` preserves the original JSON-LD URL; `download_url` records the fetched `q=100` URL.
- Direct JPEG, PNG, WebP, GIF, and AVIF images are downloaded.
- Direct MP4/WebM files are downloaded when exposed.
- HLS `.m3u8` masters are recorded without claiming they were downloaded as standalone videos.
- HLS rendition playlists are collapsed to the master manifest.
- Minivet recommendation/autoplay streams are excluded.

## Remaining color-family work

The desired final model is:

```text
Flipkart product family
├── Purple
│   ├── sizes: S, M, L, XL
│   └── one Purple gallery
├── Black
│   ├── sizes: S, M, L
│   └── one Black gallery
└── unresolved source colors
```

The next scraper capability must:

1. Discover all Flipkart color swatches/PIDs in a family.
2. Visit one representative source per color.
3. Trust the Product highlights `Color` value instead of guessing from SKU.
4. Map size variants beneath that color.
5. Reuse one image gallery for all sizes of the color.
6. Keep same-color/different-gallery conflicts separate and visible.
7. Preserve untrusted or missing colors as unresolved.

Do not start the unattended complete 6,261-row crawl until this behavior is implemented and validated across several multi-color families.

## Intended Laravel import flow

```text
Batuly CSV
    ↓
resumable Flipkart scrape
    ↓
product/source/media bundles
    ↓
Laravel importer matched by product_id
    ↓
resolve product vs parent target
    ↓
upload media to Datahub S3
    ↓
reuse Batuly catalog-image conventions
    ↓
write descriptions and Product-highlight attributes
    ↓
persist import status for idempotent reruns
```

The importer must be dry-run capable, idempotent, retryable, and reuse Batuly's normal product/catalog-image behavior. Image replacement/append policy and parent/variant placement remain explicit importer decisions.

## Tests

```bash
npm test
```

Current coverage includes CSV edge cases, Product-highlights isolation, description formatting, `q=100` URL normalization, media filtering, image/video bundle separation, exact-PID deduplication, resume, retries, filters, interruption, and recovery.
