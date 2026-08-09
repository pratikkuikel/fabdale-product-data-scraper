# Fabdale Product Data Scraper

Playwright-based staging scraper for Fabdale products whose Batuly `notes` field contains a Flipkart product URL.

The scraper does **not** update Batuly directly. It creates a deterministic folder + JSON dataset that a Laravel importer can later read, upload media to Datahub S3, and apply through Batuly's normal product/catalog-image logic.

## Requirements

- Node.js 20+
- npm

## Install

```bash
npm install
npm run install:browsers
```

## Batuly → scraper handoff

On Batuly's `fix/fabdale-dynamic-attribute-backfill` branch, export the Fabdale scraper input:

```bash
php artisan app:export-fabdale-scraper-input
```

Default output:

```text
storage/app/fabdale-product-scraper-input.csv
```

The CSV contains:

```text
product_id,sku,name,parent_id,notes,flipkart_url
```

`product_id` is the canonical key for the later Laravel import. `sku`, `name`, and `parent_id` are preserved as useful context, while `flipkart_url` is extracted from the product's existing `notes` field by Batuly.

A custom export path can also be used:

```bash
php artisan app:export-fabdale-scraper-input --output=storage/app/fabdale.csv
```

## Run

Scrape the Batuly CSV export:

```bash
npm run scrape -- --input fabdale-product-scraper-input.csv
```

Test only the first few products:

```bash
npm run scrape -- --input fabdale-product-scraper-input.csv --limit 10 --headed
```

Test a single product without a CSV:

```bash
npm run scrape -- \
  --url "https://www.flipkart.com/..." \
  --sku "Fab-Dress-PURNB-001PK-S" \
  --product-id "1234"
```

JSON batch input is still supported for compatibility, but the Batuly-generated CSV is the intended workflow.

Useful options:

```text
--output <dir>    Output directory (default: data)
--limit <n>       Only scrape the first n products
--delay <ms>      Delay between products (default: 1000)
--headed          Show the Chromium window while scraping
```

## Output

Each product gets its own folder:

```text
data/
├── manifest.json
└── Fab-Dress-PURNB-001PK-S/
    ├── product.json
    └── assets/
        ├── images/
        │   ├── image-001.webp
        │   └── image-002.webp
        └── videos/
            └── video-001.mp4
```

Example `product.json`:

```json
{
  "product_id": "1234",
  "sku": "Fab-Dress-PURNB-001PK-S",
  "product": {
    "name": "Example Product",
    "parent_id": null,
    "notes": "Source: https://www.flipkart.com/..."
  },
  "source": {
    "url": "https://www.flipkart.com/...",
    "final_url": "https://www.flipkart.com/...",
    "scraped_at": "2026-08-09T00:00:00.000Z"
  },
  "crawl": {
    "status": "success",
    "error": null
  },
  "content": {
    "title": "Product title",
    "short_description": "Highlights or page summary",
    "description": "Product description",
    "specifications": {
      "Fabric": "Cotton",
      "Color": "Pink"
    }
  },
  "media": {
    "images": [
      {
        "source_url": "https://...",
        "local_path": "assets/images/image-001.webp",
        "downloaded": true,
        "content_type": "image/webp"
      }
    ],
    "videos": []
  },
  "raw": {
    "json_ld": {}
  }
}
```

If Flipkart exposes a streaming manifest such as `.m3u8`, the scraper records the source URL but does not pretend it downloaded a standalone video file.

## Intended Laravel import flow

```text
Batuly products
    ↓
app:export-fabdale-scraper-input
    ↓
CSV
    ↓
Playwright scraper
    ↓
product.json + local media
    ↓
Laravel importer
    ↓
upload local media to Datahub S3
    ↓
store S3 object/file names using Batuly catalog-image conventions
    ↓
apply short description / description / specs to the matching product or parent
```

The Laravel importer should match by `product_id` and reuse Batuly's existing product-update/catalog-image services rather than duplicating database behavior.

## Notes

- The CSV parser supports quoted commas, quotes, and multiline `notes` fields produced by PHP `fputcsv`.
- The scraper uses semantic fallbacks (JSON-LD, headings, tables, definition lists, and compact key/value rows) instead of depending only on unstable Flipkart CSS class names.
- It detects obvious captcha/block pages and marks the product as failed; it does not attempt to bypass access controls.
- Product images are downloaded when directly accessible. Direct MP4/WebM videos are downloaded; streaming manifests are recorded for later handling.
- Treat the first run as validation: test a small sample across dresses, sarees, jeans, jewellery, etc. before running the full catalog.
