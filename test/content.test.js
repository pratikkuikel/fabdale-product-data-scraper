import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProductContent, formatDescriptionSections, formatHighlights } from '../src/scrape-product.js';

test('exposes only Product highlights as importer-facing specifications', () => {
  const result = buildProductContent({
    title: 'Black Dress',
    meta_description: 'Description',
    highlights: [],
    description: null,
    description_sections: [],
    product_highlights: {
      Color: 'Black',
      Length: 'Ankle Length',
      Pattern: 'Floral Print',
      Type: 'Fit and Flare',
      'Sleeve Length': '3/4 Sleeve',
      Sleeve: '3/4 Sleeve'
    },
    raw_specifications: {
      Brand: 'Example Brand',
      'Style Code': 'ABC123',
      Fabric: 'Cotton Blend'
    }
  });

  assert.deepEqual(result.content.specifications, {
    Color: 'Black',
    Length: 'Ankle Length',
    Pattern: 'Floral Print',
    Type: 'Fit and Flare',
    'Sleeve Length': '3/4 Sleeve',
    Sleeve: '3/4 Sleeve'
  });
  assert.deepEqual(result.raw.specifications, {
    Brand: 'Example Brand',
    'Style Code': 'ABC123',
    Fabric: 'Cotton Blend'
  });
});

test('uses product-highlight attributes as the compact short description', () => {
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
