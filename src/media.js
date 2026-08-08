import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, extensionFrom, unique } from './utils.js';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);
const MAX_IMAGES = 20;
const MAX_VIDEOS = 10;

export async function collectMediaCandidates(page, productJsonLd, capturedMediaUrls = []) {
  const domMedia = await page.evaluate(() => {
    const images = [...document.images]
      .filter((img) => img.naturalWidth >= 250 && img.naturalHeight >= 250)
      .map((img) => img.currentSrc || img.src)
      .filter(Boolean);

    const videos = [...document.querySelectorAll('video, video source')]
      .map((node) => node.currentSrc || node.src)
      .filter(Boolean);

    return { images, videos };
  });

  const jsonLdImages = normalizeJsonLdImages(productJsonLd?.image);
  const capturedVideos = capturedMediaUrls.filter((url) => looksLikeVideo(url) || looksLikeStream(url));

  return {
    // Do not include every image network response: that would pull icons, banners and
    // recommendations. JSON-LD + large rendered images are much closer to product media.
    images: unique([...jsonLdImages, ...domMedia.images]).filter(isHttpUrl).slice(0, MAX_IMAGES),
    videos: unique([...domMedia.videos, ...capturedVideos]).filter(isHttpUrl).slice(0, MAX_VIDEOS)
  };
}

export async function downloadMedia({ context, sourceUrl, outputDir, candidates }) {
  const imagesDir = path.join(outputDir, 'assets', 'images');
  const videosDir = path.join(outputDir, 'assets', 'videos');
  await ensureDir(imagesDir);
  await ensureDir(videosDir);

  const images = [];
  for (let index = 0; index < candidates.images.length; index += 1) {
    images.push(await downloadAsset({
      context,
      sourceUrl,
      url: candidates.images[index],
      outputDir: imagesDir,
      relativeDir: 'assets/images',
      basename: `image-${String(index + 1).padStart(3, '0')}`,
      allowedTypes: IMAGE_TYPES,
      fallbackExtension: '.jpg'
    }));
  }

  const videos = [];
  for (let index = 0; index < candidates.videos.length; index += 1) {
    const url = candidates.videos[index];

    if (looksLikeStream(url)) {
      videos.push({
        source_url: url,
        local_path: null,
        downloaded: false,
        reason: 'streaming_manifest'
      });
      continue;
    }

    videos.push(await downloadAsset({
      context,
      sourceUrl,
      url,
      outputDir: videosDir,
      relativeDir: 'assets/videos',
      basename: `video-${String(index + 1).padStart(3, '0')}`,
      allowedTypes: VIDEO_TYPES,
      fallbackExtension: '.mp4'
    }));
  }

  return {
    images: images.filter(Boolean),
    videos: videos.filter(Boolean)
  };
}

async function downloadAsset({
  context,
  sourceUrl,
  url,
  outputDir,
  relativeDir,
  basename,
  allowedTypes,
  fallbackExtension
}) {
  try {
    const response = await context.request.get(url, {
      headers: { referer: sourceUrl },
      timeout: 30_000
    });

    if (!response.ok()) {
      return { source_url: url, local_path: null, downloaded: false, reason: `http_${response.status()}` };
    }

    const contentType = (response.headers()['content-type'] || '').split(';')[0].toLowerCase();
    if (allowedTypes.size && !allowedTypes.has(contentType)) {
      return { source_url: url, local_path: null, downloaded: false, reason: `unsupported_content_type:${contentType || 'unknown'}` };
    }

    const extension = extensionFrom(contentType, url) || fallbackExtension;
    const filename = `${basename}${extension}`;
    const absolutePath = path.join(outputDir, filename);
    await writeFile(absolutePath, await response.body());

    return {
      source_url: url,
      local_path: `${relativeDir}/${filename}`,
      downloaded: true,
      content_type: contentType
    };
  } catch (error) {
    return {
      source_url: url,
      local_path: null,
      downloaded: false,
      reason: error.message
    };
  }
}

function normalizeJsonLdImages(image) {
  if (!image) return [];
  if (typeof image === 'string') return [image];
  if (Array.isArray(image)) return image.flatMap(normalizeJsonLdImages);
  if (typeof image === 'object') return [image.url, image.contentUrl].filter(Boolean);
  return [];
}

function looksLikeVideo(url) {
  return /\.(mp4|webm)(?:[?#]|$)/i.test(url);
}

function looksLikeStream(url) {
  return /\.m3u8(?:[?#]|$)/i.test(url);
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
