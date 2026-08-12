import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CrawlStore } from '../src/crawl-store.js';
import { runCrawl, selectProducts } from '../src/crawl-runner.js';

test('scrapes one source for duplicate PIDs and resumes without scraping again', async (context) => {
  const outputRoot = await temporaryDirectory(context);
  const products = [
    product('1', 'ABC123'),
    product('2', 'ABC123'),
    product('3', 'XYZ789')
  ];
  let calls = 0;
  const scrape = async ({ input }) => {
    calls++;
    return success(input.url);
  };

  const first = await runCrawl({
    products,
    context: null,
    store: new CrawlStore(outputRoot),
    options: options(),
    scrape,
    wait: async () => {}
  });

  assert.equal(calls, 2);
  assert.deepEqual(first, { selected: 3, sources: 2, scraped: 2, skipped: 0, failed: 0, interrupted: false });

  const second = await runCrawl({
    products,
    context: null,
    store: new CrawlStore(outputRoot),
    options: options(),
    scrape,
    wait: async () => {}
  });

  assert.equal(calls, 2);
  assert.equal(second.skipped, 2);

  const productResult = JSON.parse(await readFile(path.join(outputRoot, 'products', '2', 'product.json'), 'utf8'));
  assert.equal(productResult.source_bundle.key, 'pid-ABC123');
  assert.equal(productResult.product_id, '2');
});

test('does not create a browser context when every source resumes', async (context) => {
  const outputRoot = await temporaryDirectory(context);
  const products = [product('1', 'ABC123')];
  const scrape = async ({ input }) => success(input.url);

  const skipped = await runCrawl({
    products,
    context: null,
    store: new CrawlStore(outputRoot),
    options: options(),
    scrape,
    wait: async () => {}
  });

  await runCrawl({
    products,
    context: null,
    getContext: async () => assert.fail('resume should not create a browser context'),
    store: new CrawlStore(outputRoot),
    options: options(),
    scrape,
    wait: async () => {}
  });
});

test('recovers a successful source left processing by an interrupted coordinator', async (context) => {
  const outputRoot = await temporaryDirectory(context);
  const products = [product('1', 'ABC123')];
  const store = new CrawlStore(outputRoot);

  await runCrawl({
    products,
    context: null,
    store,
    options: options(),
    scrape: async ({ input }) => success(input.url),
    wait: async () => {}
  });
  store.manifest.sources['pid-ABC123'].status = 'processing';
  await store.save();

  const recovered = await runCrawl({
    products,
    context: null,
    getContext: async () => assert.fail('valid saved source should recover without a browser'),
    store: new CrawlStore(outputRoot),
    options: options(),
    scrape: async () => assert.fail('valid saved source should not be scraped'),
    wait: async () => {}
  });

  const manifest = JSON.parse(await readFile(path.join(outputRoot, 'manifest.json'), 'utf8'));
  assert.equal(recovered.skipped, 1);
  assert.equal(manifest.sources['pid-ABC123'].status, 'success');
});

test('records unexpected browser or scraper exceptions as failed attempts', async (context) => {
  const outputRoot = await temporaryDirectory(context);
  const products = [product('1', 'ABC123')];

  const run = await runCrawl({
    products,
    context: null,
    getContext: async () => { throw new Error('browser unavailable'); },
    store: new CrawlStore(outputRoot),
    options: options(),
    wait: async () => {}
  });

  const manifest = JSON.parse(await readFile(path.join(outputRoot, 'manifest.json'), 'utf8'));
  assert.equal(run.failed, 1);
  assert.equal(manifest.sources['pid-ABC123'].status, 'failed');
  assert.equal(manifest.sources['pid-ABC123'].error, 'browser unavailable');
});

test('does not resume when image quality changes', async (context) => {
  const outputRoot = await temporaryDirectory(context);
  const products = [product('1', 'ABC123')];
  let calls = 0;
  const scrape = async ({ input }) => {
    calls++;
    return success(input.url);
  };

  await runCrawl({
    products,
    context: null,
    store: new CrawlStore(outputRoot),
    options: options({ imageQuality: 70 }),
    scrape,
    wait: async () => {}
  });
  await runCrawl({
    products,
    context: null,
    store: new CrawlStore(outputRoot),
    options: options({ imageQuality: 100 }),
    scrape,
    wait: async () => {}
  });

  assert.equal(calls, 2);
});

test('retries failures with cumulative attempts only when requested on later runs', async (context) => {
  const outputRoot = await temporaryDirectory(context);
  const products = [product('1', 'ABC123')];
  let calls = 0;
  const fail = async ({ input }) => {
    calls++;
    return failure(input.url);
  };

  await runCrawl({
    products,
    context: null,
    store: new CrawlStore(outputRoot),
    options: options({ maxAttempts: 2 }),
    scrape: fail,
    wait: async () => {}
  });
  assert.equal(calls, 2);

  const skipped = await runCrawl({
    products,
    context: null,
    store: new CrawlStore(outputRoot),
    options: options(),
    scrape: fail,
    wait: async () => {}
  });
  assert.equal(calls, 2);
  assert.equal(skipped.failed, 1);

  await runCrawl({
    products,
    context: null,
    store: new CrawlStore(outputRoot),
    options: options({ retryFailed: true, maxAttempts: 1 }),
    scrape: async ({ input }) => {
      calls++;
      return success(input.url);
    },
    wait: async () => {}
  });

  const manifest = JSON.parse(await readFile(path.join(outputRoot, 'manifest.json'), 'utf8'));
  assert.equal(calls, 3);
  assert.equal(manifest.sources['pid-ABC123'].attempt_count, 3);
  assert.equal(manifest.sources['pid-ABC123'].status, 'success');
});

test('filters by prior status and product ID before offset and limit', () => {
  const products = [product('1', 'ONE'), product('2', 'TWO'), product('3', 'THREE')];
  const manifest = {
    products: {
      1: { status: 'success' },
      2: { status: 'failed' },
      3: { status: 'failed' }
    }
  };

  const selected = selectProducts(products, manifest, options({
    productIds: ['2', '3'],
    statuses: ['failed'],
    offset: 1,
    limit: 1
  }));

  assert.deepEqual(selected.map((item) => item.product_id), ['3']);
});

test('stops between sources and persists an interrupted manifest', async (context) => {
  const outputRoot = await temporaryDirectory(context);
  const products = [product('1', 'ONE'), product('2', 'TWO')];
  let calls = 0;

  const run = await runCrawl({
    products,
    context: null,
    store: new CrawlStore(outputRoot),
    options: options(),
    scrape: async ({ input }) => {
      calls++;
      return success(input.url);
    },
    shouldStop: () => calls === 1,
    wait: async () => {}
  });

  const manifest = JSON.parse(await readFile(path.join(outputRoot, 'manifest.json'), 'utf8'));
  assert.equal(run.interrupted, true);
  assert.equal(calls, 1);
  assert.equal(manifest.interrupted, true);
  assert.equal(manifest.summary.sources.success, 1);
  assert.equal(manifest.summary.sources.queued, 1);
});

function product(productId, pid) {
  return {
    product_id: productId,
    sku: `SKU-${productId}`,
    name: `Product ${productId}`,
    parent_id: null,
    notes: null,
    url: `https://www.flipkart.com/example/p/item?pid=${pid}`
  };
}

function success(url) {
  return result(url, 'success', null);
}

function failure(url) {
  return result(url, 'failed', 'network failure');
}

function result(url, status, error) {
  return {
    source: { url, final_url: url, scraped_at: new Date().toISOString() },
    crawl: { status, error },
    content: { title: 'Title', short_description: 'Short', description: 'Long', specifications: { Color: 'Blue' } },
    media: { images: [], videos: [] },
    raw: { json_ld: {}, dom: {} }
  };
}

function options(overrides = {}) {
  return {
    productIds: [],
    statuses: [],
    offset: 0,
    limit: null,
    delayMs: 0,
    retryDelayMs: 0,
    maxAttempts: 1,
    imageQuality: 100,
    retryFailed: false,
    force: false,
    downloadMedia: true,
    checkpointEvery: 25,
    ...overrides
  };
}

async function temporaryDirectory(context) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fabdale-scraper-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
