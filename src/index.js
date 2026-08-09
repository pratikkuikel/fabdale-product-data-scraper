import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { parseCsv } from './csv.js';
import { scrapeProduct } from './scrape-product.js';
import { ensureDir, writeJson } from './utils.js';

const { values } = parseArgs({
  options: {
    input: { type: 'string', short: 'i' },
    output: { type: 'string', short: 'o', default: 'data' },
    url: { type: 'string' },
    sku: { type: 'string' },
    'product-id': { type: 'string' },
    limit: { type: 'string' },
    delay: { type: 'string', default: '1000' },
    headed: { type: 'boolean', default: false }
  }
});

const products = await loadProducts(values);
const limit = positiveInteger(values.limit, products.length);
const delayMs = nonNegativeInteger(values.delay, 1000);
const outputRoot = path.resolve(values.output);

await ensureDir(outputRoot);

const browser = await chromium.launch({ headless: !values.headed });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1200 },
  locale: 'en-IN'
});

const selected = products.slice(0, limit);
const results = [];

console.log(`Scraping ${selected.length} product(s) into ${outputRoot}`);

try {
  for (let index = 0; index < selected.length; index += 1) {
    const product = selected[index];
    console.log(`[${index + 1}/${selected.length}] ${product.sku || product.product_id || product.url}`);

    const result = await scrapeProduct({
      context,
      input: product,
      outputRoot
    });

    results.push({
      product_id: result.product_id,
      sku: result.sku,
      name: result.product?.name ?? null,
      parent_id: result.product?.parent_id ?? null,
      url: result.source.url,
      status: result.crawl.status,
      error: result.crawl.error
    });

    await writeManifest(outputRoot, results);

    if (delayMs > 0 && index < selected.length - 1) {
      await sleep(delayMs);
    }
  }
} finally {
  await browser.close();
}

const successful = results.filter((item) => item.status === 'success').length;
const failed = results.length - successful;
console.log(`Done. Success: ${successful}; Failed: ${failed}`);

if (failed > 0) process.exitCode = 1;

async function loadProducts(options) {
  if (options.url) {
    return [validateProduct({
      product_id: options['product-id'] ?? null,
      sku: options.sku ?? null,
      url: options.url
    })];
  }

  if (!options.input) {
    throw new Error('Provide --input fabdale-product-scraper-input.csv or --url https://www.flipkart.com/...');
  }

  const inputPath = path.resolve(options.input);
  const text = await readFile(inputPath, 'utf8');
  const extension = path.extname(inputPath).toLowerCase();

  let rows;
  if (extension === '.csv') {
    rows = parseCsv(text);
  } else if (extension === '.json') {
    const parsed = JSON.parse(text);
    rows = Array.isArray(parsed) ? parsed : parsed.products;
  } else {
    throw new Error('Input file must be .csv or .json.');
  }

  if (!Array.isArray(rows)) {
    throw new Error('Input must contain product rows.');
  }

  return rows.map(validateProduct);
}

function validateProduct(product) {
  if (!product || typeof product !== 'object') {
    throw new Error('Each product entry must be an object.');
  }

  const sourceUrl = emptyToNull(product.flipkart_url)
    || emptyToNull(product.url)
    || extractFlipkartUrl(product.notes);

  if (!sourceUrl) {
    throw new Error(`Missing Flipkart URL for product ${product.sku || product.product_id || product.id || '(unknown)'}.`);
  }

  const url = new URL(sourceUrl);
  if (!/(^|\.)flipkart\.com$/i.test(url.hostname)) {
    throw new Error(`Only flipkart.com product URLs are accepted: ${sourceUrl}`);
  }

  return {
    product_id: emptyToNull(product.product_id ?? product.id),
    sku: emptyToNull(product.sku),
    name: emptyToNull(product.name),
    parent_id: emptyToNull(product.parent_id),
    notes: emptyToNull(product.notes),
    url: url.toString()
  };
}

function extractFlipkartUrl(notes) {
  if (typeof notes !== 'string' || notes.trim() === '') return null;

  const match = notes.match(/https?:\/\/(?:[a-z0-9-]+\.)*flipkart\.com\/[^\s<>"']+/i);
  if (!match) return null;

  return match[0].replace(/[),.;]+$/, '');
}

function emptyToNull(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

async function writeManifest(outputRoot, results) {
  await writeJson(path.join(outputRoot, 'manifest.json'), {
    generated_at: new Date().toISOString(),
    products: results
  });
}

function positiveInteger(value, fallback) {
  if (value == null) return fallback;
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
