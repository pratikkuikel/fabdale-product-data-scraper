import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomic } from './utils.js';

export class MediaStore {
  constructor(outputRoot) {
    this.outputRoot = outputRoot;
  }

  async resolve({ candidates, imageQuality, enabled, download }) {
    const images = await this.resolvePart({
      type: 'images',
      urls: candidates.images,
      imageQuality,
      enabled,
      download: (directory) => download(directory, { images: candidates.images, videos: [] })
    });
    const videos = await this.resolvePart({
      type: 'videos',
      urls: candidates.videos,
      imageQuality,
      enabled,
      download: (directory) => download(directory, { images: [], videos: candidates.videos })
    });

    return {
      bundle: {
        images: images.bundle,
        videos: videos.bundle
      },
      media: {
        images: images.items,
        videos: videos.items
      }
    };
  }

  async resolvePart({ type, urls, imageQuality, enabled, download }) {
    if (urls.length === 0) return { bundle: null, items: [] };

    const key = mediaFingerprint(type, urls, imageQuality, enabled);
    const directory = path.join(this.outputRoot, 'media', type, key);
    const manifestPath = path.join(directory, 'media.json');
    let items = await readValidItems(manifestPath, directory, type, urls.length, enabled);
    let reused = true;

    if (!items) {
      const media = await download(directory);
      items = media[type];
      await writeJsonAtomic(manifestPath, {
        key,
        type,
        image_quality: type === 'images' ? imageQuality : null,
        download_media: enabled,
        created_at: new Date().toISOString(),
        items
      });
      reused = false;
    }

    return {
      bundle: {
        key,
        path: path.posix.join('media', type, key, 'media.json'),
        reused
      },
      items: rewriteForSource(items, type, key)
    };
  }
}

export function mediaFingerprint(type, urls, imageQuality, enabled) {
  const canonical = {
    type,
    mode: enabled ? 'download' : 'metadata',
    image_quality: type === 'images' ? imageQuality : null,
    urls: urls.map(normalizeMediaUrl)
  };

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 24);
}

async function readValidItems(manifestPath, directory, type, expectedCount, enabled) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    return null;
  }

  if (!Array.isArray(parsed.items) || parsed.type !== type || parsed.download_media !== enabled) return null;
  if (parsed.items.length !== expectedCount) return null;
  if (!enabled) return parsed.items;
  if (type === 'images' && parsed.items.some((item) => !item.downloaded)) return null;
  if (type === 'videos' && parsed.items.some((item) => !item.downloaded && item.reason !== 'streaming_manifest')) return null;

  const downloaded = parsed.items.filter((item) => item.downloaded && item.local_path);
  for (const item of downloaded) {
    try {
      if ((await stat(path.join(directory, item.local_path))).size === 0) return null;
    } catch {
      return null;
    }
  }

  return parsed.items;
}

function rewriteForSource(items, type, key) {
  return items.map((item) => ({
    ...item,
    local_path: item.local_path
      ? path.posix.join('..', '..', 'media', type, key, item.local_path)
      : null
  }));
}

function normalizeMediaUrl(value) {
  const url = new URL(value);
  url.searchParams.delete('q');
  url.hash = '';
  return url.toString();
}
