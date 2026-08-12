import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseCsv } from './csv.js';

export async function loadProducts(options) {
  if (options.url) {
    return [validateProduct({
      product_id: options.productIds[0] ?? null,
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

export function validateProduct(product) {
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
