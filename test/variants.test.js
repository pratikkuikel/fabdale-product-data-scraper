import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { extractProductVariants } from '../src/scrape-product.js';

const VARIABLE_URL = 'https://www.flipkart.com/example-product/p/itm-example?pid=PID-XS';
const SIMPLE_URL = 'https://www.flipkart.com/simple-product/p/itm-simple?pid=SIMPLE-PID';

test('extracts size-specific URLs and availability from a variable product fixture', async () => {
  const result = await extractFixture('variable-product.html', VARIABLE_URL);

  assert.equal(result.product_type, 'variable');
  assert.equal(result.status, 'complete');
  assert.equal(result.selected_value, 'XS');
  assert.deepEqual(result.variants.map(({ size, pid, available, selected }) => ({ size, pid, available, selected })), [
    { size: 'XS', pid: 'PID-XS', available: true, selected: true },
    { size: 'S', pid: 'PID-S', available: true, selected: false },
    { size: 'M', pid: 'PID-M', available: true, selected: false },
    { size: 'L', pid: 'PID-L', available: false, selected: false }
  ]);
  assert.match(result.variants[1].url, /pid=PID-S/);
});

test('classifies a fixture without a size selector as a simple product', async () => {
  const result = await extractFixture('simple-product.html', SIMPLE_URL);

  assert.deepEqual(result, {
    product_type: 'simple',
    variants: [],
    status: 'not_applicable',
    selected_value: null,
    error: null
  });
});

test('does not silently classify an unreadable size selector as simple', async () => {
  const result = await extractFixture('incomplete-variable-product.html', VARIABLE_URL);

  assert.equal(result.product_type, 'unknown');
  assert.equal(result.status, 'incomplete');
  assert.equal(result.selected_value, 'M');
  assert.match(result.error, /no size-specific product URLs/i);
});

async function extractFixture(name, url) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const html = await readFile(path.join(import.meta.dirname, 'fixtures', name), 'utf8');
    await page.setContent(html);
    return await extractProductVariants(page, url);
  } finally {
    await browser.close();
  }
}
