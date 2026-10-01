import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateProductOutput(product) {
  const errors = [];
  const variants = Array.isArray(product?.variants) ? product.variants : null;
  const discovery = product?.variant_discovery;

  if (!['simple', 'variable', 'unknown'].includes(product?.product_type)) {
    errors.push('product_type must be simple, variable, or unknown');
  }
  if (!variants) errors.push('variants must be an array');
  if (!discovery || discovery.attribute !== 'size') {
    errors.push('variant_discovery.attribute must be size');
  }

  if (product?.product_type === 'simple') {
    if (variants?.length !== 0) errors.push('simple products must not contain variants');
    if (discovery?.status !== 'not_applicable') errors.push('simple products must use variant_discovery.status not_applicable');
  }

  if (product?.product_type === 'variable') {
    if (discovery?.status !== 'complete') errors.push('variable products must have complete variant discovery');
    if (!variants?.length) errors.push('variable products must contain at least one variant');

    const pids = new Set();
    let selectedCount = 0;
    for (const [index, variant] of (variants ?? []).entries()) {
      if (typeof variant.size !== 'string' || !variant.size.trim()) errors.push(`variants[${index}].size is required`);
      if (typeof variant.pid !== 'string' || !variant.pid.trim()) errors.push(`variants[${index}].pid is required`);
      if (pids.has(variant.pid)) errors.push(`duplicate variant PID: ${variant.pid}`);
      pids.add(variant.pid);
      if (typeof variant.available !== 'boolean') errors.push(`variants[${index}].available must be boolean`);
      if (typeof variant.selected !== 'boolean') errors.push(`variants[${index}].selected must be boolean`);
      if (variant.selected) selectedCount++;

      try {
        const url = new URL(variant.url);
        if (!/(^|\.)flipkart\.com$/i.test(url.hostname)) throw new Error('not Flipkart');
        if (url.searchParams.get('pid')?.toUpperCase() !== variant.pid.toUpperCase()) {
          errors.push(`variants[${index}].url PID does not match ${variant.pid}`);
        }
      } catch {
        errors.push(`variants[${index}].url must be a valid Flipkart URL`);
      }
    }
    if (selectedCount !== 1) errors.push(`variable products must contain exactly one selected variant; found ${selectedCount}`);
  }

  if (product?.product_type === 'unknown' && !['incomplete', 'failed', 'pending'].includes(discovery?.status)) {
    errors.push('unknown products must have incomplete, failed, or pending variant discovery');
  }

  if (product?.crawl?.status !== 'success') {
    errors.push(`crawl status is ${product?.crawl?.status ?? 'missing'}${product?.crawl?.error ? `: ${product.crawl.error}` : ''}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    summary: {
      product_type: product?.product_type ?? null,
      discovery_status: discovery?.status ?? null,
      variant_count: variants?.length ?? 0,
      sizes: variants?.map((variant) => variant.size) ?? [],
      crawl_status: product?.crawl?.status ?? null
    }
  };
}

async function main(target) {
  if (!target) throw new Error('Usage: npm run validate:output -- <output-directory|product.json>');

  const resolved = path.resolve(target);
  const targetStat = await stat(resolved);
  const productPaths = targetStat.isDirectory()
    ? await productPathsFromManifest(resolved)
    : [resolved];
  const reports = [];

  for (const productPath of productPaths) {
    const product = JSON.parse(await readFile(productPath, 'utf8'));
    reports.push({ product_path: productPath, ...validateProductOutput(product) });
  }

  console.log(JSON.stringify(reports, null, 2));
  if (reports.some((report) => !report.valid)) process.exitCode = 1;
}

async function productPathsFromManifest(outputRoot) {
  const manifest = JSON.parse(await readFile(path.join(outputRoot, 'manifest.json'), 'utf8'));
  const productPaths = Object.values(manifest.products ?? {})
    .map((entry) => entry.product_path)
    .filter(Boolean)
    .map((productPath) => path.join(outputRoot, productPath));
  if (productPaths.length === 0) throw new Error(`No product outputs found in ${outputRoot}`);
  return productPaths;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv[2]);
}
