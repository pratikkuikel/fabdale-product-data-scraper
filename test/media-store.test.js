import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MediaStore, mediaFingerprint } from '../src/media-store.js';

test('gallery fingerprints ignore Flipkart quality query differences', () => {
  const first = ['https://rukmini1.flixcart.com/image/1500/1500/product.jpeg?q=70'];
  const second = ['https://rukmini1.flixcart.com/image/1500/1500/product.jpeg?q=80'];

  assert.equal(mediaFingerprint('images', first, 100, true), mediaFingerprint('images', second, 100, true));
});

test('reuses an existing media bundle for an identical extracted gallery', async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'fabdale-media-test-'));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const store = new MediaStore(outputRoot);
  const candidates = { images: ['https://rukmini1.flixcart.com/image/1500/1500/product.jpeg?q=70'], videos: [] };
  let downloads = 0;
  const request = {
    candidates,
    imageQuality: 100,
    enabled: true,
    download: async (directory, selected) => {
      downloads++;
      await mkdir(path.join(directory, 'assets', 'images'), { recursive: true });
      await writeFile(path.join(directory, 'assets', 'images', 'image-001.jpg'), 'image');
      return {
        images: selected.images.length > 0 ? [{
          source_url: candidates.images[0],
          download_url: candidates.images[0],
          local_path: 'assets/images/image-001.jpg',
          downloaded: true,
          content_type: 'image/jpeg'
        }] : [],
        videos: []
      };
    }
  };

  const first = await store.resolve(request);
  const second = await store.resolve(request);

  assert.equal(downloads, 1);
  assert.equal(first.bundle.images.reused, false);
  assert.equal(second.bundle.images.reused, true);
  assert.equal(first.bundle.images.key, second.bundle.images.key);
});

test('uses independent fingerprints for shared images and distinct videos', () => {
  const images = ['https://rukmini1.flixcart.com/image/1500/1500/product.jpeg?q=70'];
  const firstVideo = ['https://vod1.flixcart.com/video/one/manifest.m3u8'];
  const secondVideo = ['https://vod1.flixcart.com/video/two/manifest.m3u8'];

  assert.equal(mediaFingerprint('images', images, 100, true), mediaFingerprint('images', images, 100, true));
  assert.notEqual(mediaFingerprint('videos', firstVideo, 100, true), mediaFingerprint('videos', secondVideo, 100, true));
});

test('reuses matching images while retaining distinct video bundles', async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'fabdale-media-split-test-'));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const store = new MediaStore(outputRoot);
  const image = 'https://rukmini1.flixcart.com/image/1500/1500/product.jpeg?q=70';
  let imageDownloads = 0;
  let videoResolutions = 0;
  const download = async (directory, selected) => {
    if (selected.images.length > 0) {
      imageDownloads++;
      await mkdir(path.join(directory, 'assets', 'images'), { recursive: true });
      await writeFile(path.join(directory, 'assets', 'images', 'image-001.jpg'), 'image');
    }
    if (selected.videos.length > 0) videoResolutions++;

    return {
      images: selected.images.map((url) => ({ source_url: url, local_path: 'assets/images/image-001.jpg', downloaded: true })),
      videos: selected.videos.map((url) => ({ source_url: url, local_path: null, downloaded: false, reason: 'streaming_manifest' }))
    };
  };

  const first = await store.resolve({
    candidates: { images: [image], videos: ['https://vod1.flixcart.com/video/one/manifest.m3u8'] },
    imageQuality: 100,
    enabled: true,
    download
  });
  const second = await store.resolve({
    candidates: { images: [image], videos: ['https://vod1.flixcart.com/video/two/manifest.m3u8'] },
    imageQuality: 100,
    enabled: true,
    download
  });

  assert.equal(imageDownloads, 1);
  assert.equal(videoResolutions, 2);
  assert.equal(first.bundle.images.key, second.bundle.images.key);
  assert.equal(second.bundle.images.reused, true);
  assert.notEqual(first.bundle.videos.key, second.bundle.videos.key);
});
