import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDescriptionSections, formatHighlights } from '../src/scrape-product.js';

test('uses product specifications as compact highlights when no list exists', () => {
  assert.equal(formatHighlights([], {
    Color: 'Purple',
    Pattern: 'Printed'
  }), 'Color: Purple\nPattern: Printed');
});

test('prioritizes useful product attributes and limits highlights to eight lines', () => {
  assert.equal(formatHighlights([], {
    Brand: 'Example',
    Size: 'M',
    'Pack of': '1',
    'Style Code': 'ABC',
    Fit: 'Regular',
    Fabric: 'Cotton',
    Sleeve: 'Full Sleeve',
    Pattern: 'Printed',
    Color: 'Blue',
    Occasion: 'Casual'
  }), [
    'Color: Blue',
    'Fabric: Cotton',
    'Pattern: Printed',
    'Fit: Regular',
    'Sleeve: Full Sleeve',
    'Occasion: Casual',
    'Style Code: ABC',
    'Brand: Example'
  ].join('\n'));
});

test('formats product feature cards into a readable long description', () => {
  assert.equal(formatDescriptionSections([
    { heading: 'High-quality Fabric', body: 'Made from durable polyester.' },
    { heading: 'Ideal for Casual Wear', body: 'Designed for everyday occasions.' }
  ]), [
    'High-quality Fabric',
    'Made from durable polyester.',
    '',
    'Ideal for Casual Wear',
    'Designed for everyday occasions.'
  ].join('\n'));
});
