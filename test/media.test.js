import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizeVideoUrls, normalizeImageQualityUrl, selectProductImages } from '../src/media.js';

test('requests maximum configured quality from Flipkart product images', () => {
  assert.equal(
    normalizeImageQualityUrl('https://rukmini1.flixcart.com/image/1500/1500/product.jpeg?q=70', 100),
    'https://rukmini1.flixcart.com/image/1500/1500/product.jpeg?q=100'
  );
});

test('does not add Flipkart quality parameters to unrelated media hosts', () => {
  assert.equal(
    normalizeImageQualityUrl('https://example.com/image/1500/1500/product.jpeg', 100),
    'https://example.com/image/1500/1500/product.jpeg'
  );
});

test('uses the product-scoped JSON-LD gallery without DOM recommendations', () => {
  const jsonLdImages = [
    'https://rukmini1.flixcart.com/image/1500/1500/product-one.jpeg?q=70',
    'https://rukmini1.flixcart.com/image/1500/1500/product-two.jpeg?q=70'
  ];
  const domImages = [
    ...jsonLdImages,
    'https://rukminim2.flixcart.com/www/400/400/promos/banner.png?q=80',
    'https://rukminim2.flixcart.com/image/530/710/recommended-product.jpeg?q=80'
  ];

  assert.deepEqual(selectProductImages(jsonLdImages, domImages), jsonLdImages);
});

test('filters promotional images from the DOM fallback', () => {
  assert.deepEqual(selectProductImages([], [
    'https://rukminim2.flixcart.com/image/800/1070/product.jpeg?q=80',
    'https://rukminim2.flixcart.com/www/400/400/promos/banner.png?q=80'
  ]), [
    'https://rukminim2.flixcart.com/image/800/1070/product.jpeg?q=80'
  ]);
});

test('keeps one HLS master manifest instead of every rendition playlist', () => {
  const root = 'https://vod1.flixcart.com/fk-p-transcode-video/example';

  assert.deepEqual(canonicalizeVideoUrls([
    `${root}/manifest.m3u8`,
    `${root}/chunk_stream0.m3u8`,
    `${root}/chunk_stream1.m3u8`
  ]), [
    `${root}/manifest.m3u8`
  ]);
});

test('excludes recommendation catalog streams from product videos', () => {
  assert.deepEqual(canonicalizeVideoUrls([
    'https://vod1.flixcart.com/fk-p-transcode-video/cgt/FPS/product/manifest.m3u8',
    'https://vod1.flixcart.com/fk-p-transcode-video/minivet/MINIVET_CATALOG/recommendation/manifest.m3u8'
  ]), [
    'https://vod1.flixcart.com/fk-p-transcode-video/cgt/FPS/product/manifest.m3u8'
  ]);
});
