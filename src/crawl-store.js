import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, writeJsonAtomic } from './utils.js';
import { productKeyFor } from './source-identity.js';

const SCHEMA_VERSION = 2;

export class CrawlStore {
  constructor(outputRoot) {
    this.outputRoot = outputRoot;
    this.manifestPath = path.join(outputRoot, 'manifest.json');
    this.manifest = null;
  }

  async load() {
    await ensureDir(this.outputRoot);

    try {
      const parsed = JSON.parse(await readFile(this.manifestPath, 'utf8'));
      if (parsed.schema_version !== SCHEMA_VERSION) {
        throw new Error(`Unsupported manifest schema ${parsed.schema_version ?? 'legacy'} in ${this.manifestPath}. Use a new output directory.`);
      }
      this.manifest = parsed;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.manifest = this.emptyManifest();
    }

    await this.reconcileSourceStates();

    return this.manifest;
  }

  emptyManifest() {
    const now = new Date().toISOString();
    return {
      schema_version: SCHEMA_VERSION,
      created_at: now,
      updated_at: now,
      interrupted: false,
      settings: {},
      sources: {},
      products: {},
      summary: emptySummary()
    };
  }

  sourceDirectory(sourceKey) {
    return path.join(this.outputRoot, 'sources', sourceKey);
  }

  sourceJsonPath(sourceKey) {
    return path.join(this.sourceDirectory(sourceKey), 'source.json');
  }

  sourceStatePath(sourceKey) {
    return path.join(this.sourceDirectory(sourceKey), 'state.json');
  }

  async save(settings = {}) {
    this.manifest.updated_at = new Date().toISOString();
    this.manifest.settings = { ...this.manifest.settings, ...settings };
    this.manifest.summary = summarize(this.manifest);
    await writeJsonAtomic(this.manifestPath, this.manifest);
  }

  async writeSource(sourceKey, sourceResult) {
    await writeJsonAtomic(this.sourceJsonPath(sourceKey), sourceResult);
  }

  async writeSourceState(sourceKey, state) {
    await writeJsonAtomic(this.sourceStatePath(sourceKey), state);
  }

  async readSource(sourceKey) {
    return JSON.parse(await readFile(this.sourceJsonPath(sourceKey), 'utf8'));
  }

  async sourceIsComplete(sourceKey, downloadMedia) {
    const entry = this.manifest.sources[sourceKey];
    if (!entry) return false;

    let source;
    try {
      source = JSON.parse(await readFile(this.sourceJsonPath(sourceKey), 'utf8'));
    } catch {
      return false;
    }

    if (source.crawl?.status !== 'success') return false;
    if (!downloadMedia) return true;

    const downloaded = [...(source.media?.images ?? []), ...(source.media?.videos ?? [])]
      .filter((item) => item.downloaded && item.local_path);

    for (const item of downloaded) {
      try {
        await access(path.join(this.sourceDirectory(sourceKey), item.local_path));
        if ((await stat(path.join(this.sourceDirectory(sourceKey), item.local_path))).size === 0) return false;
      } catch {
        return false;
      }
    }

    return true;
  }

  async materializeProducts(sourceKey, products, sourceResult) {
    for (const product of products) {
      const productKey = productKeyFor(product);
      const productDirectory = path.join(this.outputRoot, 'products', productKey);
      const sourceRelativePath = path.posix.join('..', '..', 'sources', sourceKey, 'source.json');
      const result = {
        product_id: product.product_id,
        sku: product.sku,
        product: {
          name: product.name,
          parent_id: product.parent_id,
          notes: product.notes
        },
        source_bundle: {
          key: sourceKey,
          path: sourceRelativePath
        },
        source: sourceResult.source,
        crawl: sourceResult.crawl,
        content: sourceResult.content,
        product_type: sourceResult.product_type ?? 'unknown',
        variants: sourceResult.variants ?? [],
        variant_discovery: sourceResult.variant_discovery ?? {
          attribute: 'size',
          status: 'unknown',
          selected_value: null,
          error: null
        },
        media_bundle: sourceResult.media_bundle ?? null,
        media: rewriteMediaPaths(sourceResult.media, sourceKey),
        raw: sourceResult.raw
      };

      await writeJsonAtomic(path.join(productDirectory, 'product.json'), result);
      this.manifest.products[productKey] = {
        product_id: product.product_id,
        sku: product.sku,
        parent_id: product.parent_id,
        source_key: sourceKey,
        product_path: path.posix.join('products', productKey, 'product.json'),
        status: sourceResult.crawl.status,
        error: sourceResult.crawl.error
      };
    }
  }

  async reconcileSourceStates() {
    let directories;
    try {
      directories = await readdir(path.join(this.outputRoot, 'sources'), { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }

    for (const directory of directories.filter((entry) => entry.isDirectory())) {
      let state;
      try {
        state = JSON.parse(await readFile(this.sourceStatePath(directory.name), 'utf8'));
      } catch {
        continue;
      }

      this.manifest.sources[directory.name] = {
        ...this.manifest.sources[directory.name],
        ...state
      };

      for (const productKey of state.product_keys ?? []) {
        if (!this.manifest.products[productKey]) continue;
        this.manifest.products[productKey] = {
          ...this.manifest.products[productKey],
          status: state.status,
          error: state.error
        };
      }
    }
  }
}

function rewriteMediaPaths(media, sourceKey) {
  const rewrite = (item) => ({
    ...item,
    local_path: item.local_path
      ? path.posix.join('..', '..', 'sources', sourceKey, item.local_path)
      : null
  });

  return {
    images: (media?.images ?? []).map(rewrite),
    videos: (media?.videos ?? []).map(rewrite)
  };
}

function summarize(manifest) {
  const sources = Object.values(manifest.sources);
  const products = Object.values(manifest.products);
  const statuses = ['queued', 'processing', 'success', 'partial', 'blocked', 'failed'];
  const sourceStatuses = Object.fromEntries(statuses.map((status) => [status, sources.filter((entry) => entry.status === status).length]));
  const productStatuses = Object.fromEntries(statuses.map((status) => [status, products.filter((entry) => entry.status === status).length]));

  return {
    sources: { total: sources.length, ...sourceStatuses },
    products: { total: products.length, ...productStatuses }
  };
}

function emptySummary() {
  return {
    sources: { total: 0, queued: 0, processing: 0, success: 0, partial: 0, blocked: 0, failed: 0 },
    products: { total: 0, queued: 0, processing: 0, success: 0, partial: 0, blocked: 0, failed: 0 }
  };
}
