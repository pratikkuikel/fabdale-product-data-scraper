import { createHash } from 'node:crypto';
import { safeName } from './utils.js';

export function sourceKeyFor(product) {
  const url = new URL(product.url);
  const pid = url.searchParams.get('pid');

  if (pid) return `pid-${safeName(pid.toUpperCase())}`;

  return `url-${createHash('sha256').update(normalizeFallbackUrl(url)).digest('hex').slice(0, 24)}`;
}

export function groupBySource(products) {
  const groups = new Map();

  for (const product of products) {
    const sourceKey = sourceKeyFor(product);
    const group = groups.get(sourceKey) ?? { sourceKey, representative: product, products: [] };
    group.products.push(product);
    groups.set(sourceKey, group);
  }

  return [...groups.values()];
}

export function productKeyFor(product) {
  return safeName(product.product_id || product.sku || sourceKeyFor(product));
}

function normalizeFallbackUrl(url) {
  const normalized = new URL(url.origin + url.pathname);
  const ignored = new Set(['pageUID']);

  for (const [key, value] of [...url.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (!ignored.has(key)) normalized.searchParams.append(key, value);
  }

  return normalized.toString();
}
