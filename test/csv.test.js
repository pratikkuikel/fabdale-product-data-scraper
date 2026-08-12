import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCsv } from '../src/csv.js';

test('parses Batuly CSV fields containing commas, quotes, and multiline notes', () => {
  const csv = [
    'product_id,sku,name,parent_id,notes,flipkart_url',
    '257,Fab-Dress-001,"Dress, Purple",5091,"Line one',
    'Line ""two""",https://www.flipkart.com/example/p/item'
  ].join('\n');

  assert.deepEqual(parseCsv(csv), [{
    product_id: '257',
    sku: 'Fab-Dress-001',
    name: 'Dress, Purple',
    parent_id: '5091',
    notes: 'Line one\nLine "two"',
    flipkart_url: 'https://www.flipkart.com/example/p/item'
  }]);
});
