import { groupBySource, productKeyFor } from './source-identity.js';
import { MediaStore } from './media-store.js';
import { scrapeProduct } from './scrape-product.js';

const RETRYABLE_STATUSES = new Set(['failed', 'partial']);
export const EXTRACTOR_VERSION = 3;

export async function runCrawl({
  products,
  context,
  getContext = null,
  store,
  options,
  scrape = scrapeProduct,
  shouldStop = () => false,
  onProgress = () => {},
  wait = sleep
}) {
  const manifest = await store.load();
  const selected = selectProducts(products, manifest, options);
  const groups = groupBySource(selected);
  const mediaStore = new MediaStore(store.outputRoot);
  const run = { selected: selected.length, sources: groups.length, scraped: 0, skipped: 0, failed: 0, interrupted: false };
  let checkpointProgress = 0;

  queueGroups(manifest, groups);
  manifest.interrupted = false;
  await store.save(manifestSettings(options));

  for (let index = 0; index < groups.length; index += 1) {
    if (shouldStop()) {
      run.interrupted = true;
      break;
    }

    const group = groups[index];
    const previous = manifest.sources[group.sourceKey];
    const previousResult = previous
      ? await store.readSource(group.sourceKey).catch(() => null)
      : null;
    const settingsMatch = previous?.image_quality === options.imageQuality
      && previous?.download_media === options.downloadMedia
      && previous?.extractor_version === EXTRACTOR_VERSION;
    const canResume = !options.force
      && settingsMatch
      && await store.sourceIsComplete(group.sourceKey, options.downloadMedia);
    const skipPreviousFailure = !options.force
      && previous
      && previousResult
      && ['failed', 'partial', 'blocked'].includes(previous.status)
      && !options.retryFailed;

    onProgress({ type: 'source', index, total: groups.length, group, action: canResume ? 'resume' : skipPreviousFailure ? 'skip_failed' : 'scrape' });

    if (canResume || skipPreviousFailure) {
      if (previousResult) {
        await store.materializeProducts(group.sourceKey, group.products, previousResult);
        if (canResume) {
          manifest.sources[group.sourceKey] = {
            ...manifest.sources[group.sourceKey],
            status: previousResult.crawl.status,
            error: previousResult.crawl.error,
            started_at: previousResult.source.scraped_at,
            completed_at: previousResult.crawl.completed_at,
            recovered_at: new Date().toISOString()
          };
        }
      }
      run.skipped++;
      if (skipPreviousFailure) run.failed++;
      checkpointProgress++;
      if (checkpointProgress % options.checkpointEvery === 0) await store.save();
      continue;
    }

    let finalResult = null;
    for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
      const cumulativeAttempt = (manifest.sources[group.sourceKey]?.attempt_count ?? 0) + 1;
      const processingState = {
        ...manifest.sources[group.sourceKey],
        source_key: group.sourceKey,
        status: 'processing',
        attempt_count: cumulativeAttempt,
        image_quality: options.imageQuality,
        download_media: options.downloadMedia,
        extractor_version: EXTRACTOR_VERSION,
        error: null,
        started_at: new Date().toISOString(),
        product_keys: group.products.map(productKeyFor),
        source_path: `sources/${group.sourceKey}/source.json`
      };
      manifest.sources[group.sourceKey] = processingState;
      updateProductStatuses(manifest, group, 'processing', null);
      await store.writeSourceState(group.sourceKey, processingState);

      try {
        const activeContext = context ?? await getContext?.();
        finalResult = await scrape({
          context: activeContext,
          input: group.representative,
          outputDir: store.sourceDirectory(group.sourceKey),
          imageQuality: options.imageQuality,
          downloadAssets: options.downloadMedia,
          resolveMedia: (request) => mediaStore.resolve(request)
        });
      } catch (error) {
        finalResult = failedSourceResult(group.representative, error);
      }
      finalResult.crawl = {
        ...finalResult.crawl,
        attempt_count: cumulativeAttempt,
        completed_at: new Date().toISOString()
      };

      await store.writeSource(group.sourceKey, finalResult);
      manifest.sources[group.sourceKey] = {
        ...manifest.sources[group.sourceKey],
        status: finalResult.crawl.status,
        error: finalResult.crawl.error,
        completed_at: finalResult.crawl.completed_at
      };
      await store.materializeProducts(group.sourceKey, group.products, finalResult);
      await store.writeSourceState(group.sourceKey, manifest.sources[group.sourceKey]);

      if (finalResult.crawl.status === 'success' || finalResult.crawl.status === 'blocked') break;
      if (!RETRYABLE_STATUSES.has(finalResult.crawl.status) || attempt === options.maxAttempts) break;

      await wait(options.retryDelayMs * (2 ** (attempt - 1)));
    }

    run.scraped++;
    if (finalResult?.crawl.status !== 'success') run.failed++;
    checkpointProgress++;
    if (checkpointProgress % options.checkpointEvery === 0) await store.save();

    if (options.delayMs > 0 && index < groups.length - 1 && !shouldStop()) {
      await wait(options.delayMs);
    }
  }

  manifest.interrupted = run.interrupted;
  await store.save();
  return run;
}

export function selectProducts(products, manifest, options) {
  const productIds = new Set(options.productIds ?? []);
  const statuses = new Set(options.statuses ?? []);
  let selected = products;

  if (productIds.size > 0) {
    selected = selected.filter((product) => productIds.has(String(product.product_id)));
  }

  if (statuses.size > 0) {
    selected = selected.filter((product) => {
      const status = manifest.products[productKeyFor(product)]?.status ?? 'queued';
      return statuses.has(status);
    });
  }

  return selected.slice(options.offset, options.limit == null ? undefined : options.offset + options.limit);
}

function queueGroups(manifest, groups) {
  for (const group of groups) {
    if (!manifest.sources[group.sourceKey]) {
      manifest.sources[group.sourceKey] = {
        source_key: group.sourceKey,
        status: 'queued',
        attempt_count: 0,
        error: null,
        product_keys: group.products.map(productKeyFor),
        source_path: `sources/${group.sourceKey}/source.json`
      };
    } else {
      manifest.sources[group.sourceKey].product_keys = [
        ...new Set([...manifest.sources[group.sourceKey].product_keys, ...group.products.map(productKeyFor)])
      ];
    }

    updateProductStatuses(manifest, group, manifest.sources[group.sourceKey].status, manifest.sources[group.sourceKey].error);
  }
}

function updateProductStatuses(manifest, group, status, error) {
  for (const product of group.products) {
    const productKey = productKeyFor(product);
    manifest.products[productKey] = {
      ...manifest.products[productKey],
      product_id: product.product_id,
      sku: product.sku,
      parent_id: product.parent_id,
      source_key: group.sourceKey,
      product_path: `products/${productKey}/product.json`,
      status,
      error
    };
  }
}

function manifestSettings(options) {
  return {
    image_quality: options.imageQuality,
    download_media: options.downloadMedia,
    max_attempts_per_run: options.maxAttempts,
    delay_ms: options.delayMs,
    retry_delay_ms: options.retryDelayMs,
    extractor_version: EXTRACTOR_VERSION
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function failedSourceResult(input, error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    source: {
      url: input.url,
      final_url: input.url,
      scraped_at: new Date().toISOString()
    },
    crawl: {
      status: 'failed',
      error: message
    },
    content: {
      title: null,
      short_description: null,
      description: null,
      specifications: {}
    },
    product_type: 'unknown',
    variants: [],
    variant_discovery: {
      attribute: 'size',
      status: 'failed',
      selected_value: null,
      error: message
    },
    media: {
      images: [],
      videos: []
    },
    media_bundle: null,
    raw: {
      json_ld: null,
      dom: null
    }
  };
}
