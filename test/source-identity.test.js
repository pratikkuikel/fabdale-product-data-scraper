import assert from 'node:assert/strict';
import test from 'node:test';
import { groupBySource, sourceKeyFor } from '../src/source-identity.js';

test('deduplicates Batuly rows that use the same exact Flipkart PID', () => {
  const products = [
    product('1', 'https://www.flipkart.com/example/p/item?pid=ABC123&lid=one'),
    product('2', 'https://www.flipkart.com/example/p/item?pid=ABC123&lid=two'),
    product('3', 'https://www.flipkart.com/example/p/item?pid=XYZ789')
  ];

  const groups = groupBySource(products);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].products.map((item) => item.product_id), ['1', '2']);
  assert.equal(sourceKeyFor(products[0]), 'pid-ABC123');
});

test('does not guess that PID-less URLs with different selectors are the same source', () => {
  const first = product('1', 'https://www.flipkart.com/example/p/item?color=blue');
  const second = product('2', 'https://www.flipkart.com/example/p/item?color=red');

  assert.notEqual(sourceKeyFor(first), sourceKeyFor(second));
});

function product(productId, url) {
  return { product_id: productId, sku: `SKU-${productId}`, name: null, parent_id: null, notes: null, url };
}
