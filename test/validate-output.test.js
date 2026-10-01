import assert from 'node:assert/strict';
import test from 'node:test';
import { validateProductOutput } from '../scripts/validate-product-output.js';

test('validates complete variable-product output', () => {
  const report = validateProductOutput(product({
    product_type: 'variable',
    variant_discovery: { attribute: 'size', status: 'complete', selected_value: 'M', error: null },
    variants: [variant('M', 'PID-M', true), variant('L', 'PID-L', false)]
  }));

  assert.equal(report.valid, true);
  assert.deepEqual(report.summary.sizes, ['M', 'L']);
});

test('validates a simple product without variants', () => {
  const report = validateProductOutput(product({
    product_type: 'simple',
    variant_discovery: { attribute: 'size', status: 'not_applicable', selected_value: null, error: null },
    variants: []
  }));

  assert.equal(report.valid, true);
});

test('rejects incomplete variable output and mismatched URLs', () => {
  const report = validateProductOutput(product({
    product_type: 'variable',
    variant_discovery: { attribute: 'size', status: 'incomplete', selected_value: null, error: 'missing links' },
    variants: [
      { ...variant('M', 'PID-M', false), url: 'https://www.flipkart.com/item?pid=OTHER' }
    ]
  }));

  assert.equal(report.valid, false);
  assert.match(report.errors.join('\n'), /complete variant discovery/);
  assert.match(report.errors.join('\n'), /url PID does not match/i);
  assert.match(report.errors.join('\n'), /exactly one selected variant/);
});

function product(overrides) {
  return {
    crawl: { status: 'success', error: null },
    ...overrides
  };
}

function variant(size, pid, selected) {
  return {
    size,
    pid,
    url: `https://www.flipkart.com/example/p/item?pid=${pid}`,
    available: true,
    selected
  };
}
