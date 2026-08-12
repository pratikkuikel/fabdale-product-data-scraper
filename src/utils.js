import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

export function safeName(value, fallback = 'product') {
  const normalized = String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}

export async function writeJsonAtomic(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function extensionFrom(contentType, url) {
  const type = (contentType || '').split(';')[0].trim().toLowerCase();
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/avif': '.avif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'application/vnd.apple.mpegurl': '.m3u8',
    'application/x-mpegurl': '.m3u8'
  };

  if (map[type]) return map[type];

  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (/^\.[a-z0-9]{2,5}$/.test(ext)) return ext;
  } catch {
    // Ignore invalid URLs; caller will choose a fallback extension.
  }

  return '';
}
