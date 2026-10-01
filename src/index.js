import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { CrawlStore } from './crawl-store.js';
import { runCrawl } from './crawl-runner.js';
import { loadProducts } from './product-input.js';

const { values } = parseArgs({
  options: {
    input: { type: 'string', short: 'i' },
    output: { type: 'string', short: 'o', default: 'data' },
    url: { type: 'string' },
    sku: { type: 'string' },
    'product-id': { type: 'string', multiple: true, default: [] },
    status: { type: 'string', multiple: true, default: [] },
    offset: { type: 'string', default: '0' },
    limit: { type: 'string' },
    delay: { type: 'string', default: '1000' },
    'retry-delay': { type: 'string', default: '2000' },
    'max-attempts': { type: 'string', default: '3' },
    'image-quality': { type: 'string', default: '100' },
    'retry-failed': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    'no-media': { type: 'boolean', default: false },
    headed: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false }
  }
});

if (values.help) {
  console.log(`Usage: npm run scrape -- --input <csv|json> [options]

Options:
  --output <dir>          Output directory (default: data)
  --url <flipkart-url>    Scrape one Flipkart product and discover its size variants
  --sku <sku>             Optional Batuly SKU for single-URL mode
  --product-id <id>      Select a Batuly product ID; repeat or comma-separate
  --status <status>      Select prior statuses; repeat or comma-separate
  --offset <n>           Skip input rows before applying --limit
  --limit <n>            Limit selected input rows
  --delay <ms>           Delay between unique sources (default: 1000)
  --retry-delay <ms>     Initial exponential retry delay (default: 2000)
  --max-attempts <n>     Attempts per source in this run (default: 3)
  --image-quality <1-100> Flipkart image quality (default: 100)
  --retry-failed         Retry prior failed, partial, or blocked sources
  --force                Re-scrape even verified successful sources
  --no-media             Extract media metadata without downloading files
  --headed               Show Chromium
  --help                 Show this help`);
  process.exit(0);
}

const options = normalizeOptions(values);
const products = await loadProducts(options);
const outputRoot = path.resolve(values.output);
const store = new CrawlStore(outputRoot);
let stopRequested = false;

process.once('SIGINT', requestStop);
process.once('SIGTERM', requestStop);

let browser = null;
let context = null;

console.log(`Preparing ${products.length} product row(s) in ${outputRoot}`);

try {
  const result = await runCrawl({
    products,
    context,
    getContext: async () => {
      if (context) return context;

      browser = await chromium.launch({ headless: !values.headed });
      context = await browser.newContext({
        viewport: { width: 1440, height: 1200 },
        locale: 'en-IN'
      });
      return context;
    },
    store,
    options,
    shouldStop: () => stopRequested,
    onProgress: ({ index, total, group, action }) => {
      const label = group.representative.sku || group.representative.product_id || group.representative.url;
      console.log(`[${index + 1}/${total}] ${label} (${group.products.length} row(s), ${action})`);
    }
  });

  console.log(`Done. Selected rows: ${result.selected}; Unique sources: ${result.sources}; Scraped: ${result.scraped}; Resumed/skipped: ${result.skipped}; Non-success: ${result.failed}`);

  if (result.interrupted) {
    console.error('Stopped safely after the current source. Run the same command to resume.');
    process.exitCode = 130;
  } else if (result.failed > 0) {
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
}

function requestStop() {
  if (stopRequested) return;
  stopRequested = true;
  console.error('Stop requested; finishing the current source and saving progress...');
}

function normalizeOptions(raw) {
  const statuses = splitValues(raw.status);
  const allowedStatuses = new Set(['queued', 'processing', 'success', 'partial', 'blocked', 'failed']);
  for (const status of statuses) {
    if (!allowedStatuses.has(status)) throw new Error(`Invalid --status value: ${status}`);
  }

  return {
    input: raw.input,
    url: raw.url,
    sku: raw.sku,
    productIds: splitValues(raw['product-id']),
    statuses,
    offset: integerOption('--offset', raw.offset, { minimum: 0 }),
    limit: raw.limit == null ? null : integerOption('--limit', raw.limit, { minimum: 1 }),
    delayMs: integerOption('--delay', raw.delay, { minimum: 0 }),
    retryDelayMs: integerOption('--retry-delay', raw['retry-delay'], { minimum: 0 }),
    maxAttempts: integerOption('--max-attempts', raw['max-attempts'], { minimum: 1, maximum: 10 }),
    imageQuality: integerOption('--image-quality', raw['image-quality'], { minimum: 1, maximum: 100 }),
    retryFailed: raw['retry-failed'],
    force: raw.force,
    downloadMedia: !raw['no-media'],
    checkpointEvery: 25
  };
}

function splitValues(values) {
  return values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean);
}

function integerOption(name, value, { minimum, maximum = Number.MAX_SAFE_INTEGER }) {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer.`);
  const number = Number.parseInt(value, 10);
  if (number < minimum || number > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}
