import path from 'node:path';
import { collectMediaCandidates, downloadMedia } from './media.js';
import { ensureDir, safeName, writeJson } from './utils.js';

export async function scrapeProduct({ context, input, outputRoot }) {
  const key = safeName(input.sku || input.product_id || 'product');
  const productDir = path.join(outputRoot, key);
  await ensureDir(productDir);

  const page = await context.newPage();
  const capturedMediaUrls = new Set();
  const startedAt = new Date().toISOString();

  page.on('response', async (response) => {
    const contentType = (response.headers()['content-type'] || '').toLowerCase();
    const url = response.url();

    if (
      contentType.startsWith('image/') ||
      contentType.startsWith('video/') ||
      /\.m3u8(?:[?#]|$)/i.test(url)
    ) {
      capturedMediaUrls.add(url);
    }
  });

  const baseResult = {
    product_id: input.product_id ?? null,
    sku: input.sku ?? null,
    source: {
      url: input.url,
      scraped_at: startedAt
    },
    crawl: {
      status: 'processing',
      error: null
    },
    content: {
      title: null,
      short_description: null,
      description: null,
      specifications: {}
    },
    media: {
      images: [],
      videos: []
    },
    raw: {
      json_ld: null
    }
  };

  try {
    await page.goto(input.url, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000
    });

    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});

    const blockReason = await detectBlock(page);
    if (blockReason) {
      throw new Error(`Page blocked or unavailable: ${blockReason}`);
    }

    await expandUsefulSections(page);

    const jsonLd = await extractProductJsonLd(page);
    const extracted = await extractProductContent(page, jsonLd);
    const mediaCandidates = await collectMediaCandidates(page, jsonLd, [...capturedMediaUrls]);
    const media = await downloadMedia({
      context,
      sourceUrl: input.url,
      outputDir: productDir,
      candidates: mediaCandidates
    });

    const result = {
      ...baseResult,
      source: {
        ...baseResult.source,
        final_url: page.url()
      },
      crawl: {
        status: 'success',
        error: null
      },
      content: extracted,
      media,
      raw: {
        json_ld: jsonLd
      }
    };

    await writeJson(path.join(productDir, 'product.json'), result);
    return result;
  } catch (error) {
    const result = {
      ...baseResult,
      source: {
        ...baseResult.source,
        final_url: page.url() || input.url
      },
      crawl: {
        status: 'failed',
        error: error.message
      }
    };

    await writeJson(path.join(productDir, 'product.json'), result);
    return result;
  } finally {
    await page.close();
  }
}

async function detectBlock(page) {
  const title = (await page.title().catch(() => ''))?.toLowerCase() || '';
  const bodyText = (await page.locator('body').innerText({ timeout: 5_000 }).catch(() => ''))?.toLowerCase() || '';
  const haystack = `${title}\n${bodyText.slice(0, 10_000)}`;

  const markers = [
    'captcha',
    'verify you are human',
    'unusual traffic',
    'access denied',
    'page not found'
  ];

  return markers.find((marker) => haystack.includes(marker)) || null;
}

async function expandUsefulSections(page) {
  const labels = ['Read More', 'View More'];

  for (const label of labels) {
    const locator = page.getByText(label, { exact: true });
    const count = Math.min(await locator.count().catch(() => 0), 5);

    for (let index = 0; index < count; index += 1) {
      await locator.nth(index).click({ timeout: 1_500 }).catch(() => {});
    }
  }
}

async function extractProductJsonLd(page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const candidates = [];

  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block);
      collectJsonLdProducts(parsed, candidates);
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }

  return candidates[0] || null;
}

function collectJsonLdProducts(value, products) {
  if (!value) return;

  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdProducts(item, products);
    return;
  }

  if (typeof value !== 'object') return;

  const type = value['@type'];
  if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) {
    products.push(value);
  }

  if (value['@graph']) collectJsonLdProducts(value['@graph'], products);
}

async function extractProductContent(page, jsonLd) {
  const dom = await page.evaluate(() => {
    const clean = (value) => value?.replace(/\s+/g, ' ').trim() || null;
    const textOf = (node) => clean(node?.textContent || '');

    const title = textOf(document.querySelector('h1'));
    const metaDescription = document.querySelector('meta[name="description"]')?.content || null;

    const sections = [...document.querySelectorAll('div, section')];

    const findHeadingContainer = (label) => {
      const heading = [...document.querySelectorAll('h1,h2,h3,h4,h5,div,span')]
        .find((node) => textOf(node)?.toLowerCase() === label.toLowerCase());

      if (!heading) return null;

      let node = heading.parentElement;
      for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
        const text = textOf(node);
        if (text && text.length > label.length + 20 && text.length < 12_000) return node;
      }

      return heading.parentElement;
    };

    const highlightsRoot = findHeadingContainer('Highlights');
    const highlights = highlightsRoot
      ? [...highlightsRoot.querySelectorAll('li')].map(textOf).filter(Boolean)
      : [];

    const descriptionRoot = findHeadingContainer('Description');
    let description = null;
    if (descriptionRoot) {
      const pieces = [...descriptionRoot.querySelectorAll('p,div')]
        .map(textOf)
        .filter((text) => text && text.toLowerCase() !== 'description' && text.length > 30);
      description = pieces.sort((a, b) => b.length - a.length)[0] || null;
    }

    const pairs = {};
    const addPair = (key, value) => {
      key = clean(key);
      value = clean(value);
      if (!key || !value || key === value || key.length > 100 || value.length > 1_000) return;
      if (!pairs[key]) pairs[key] = value;
    };

    for (const row of document.querySelectorAll('table tr')) {
      const cells = [...row.querySelectorAll('th,td')].map(textOf).filter(Boolean);
      if (cells.length >= 2) addPair(cells[0], cells.slice(1).join(' '));
    }

    for (const dt of document.querySelectorAll('dt')) {
      addPair(textOf(dt), textOf(dt.nextElementSibling));
    }

    const specsRoot = findHeadingContainer('Specifications');
    if (specsRoot) {
      for (const node of specsRoot.querySelectorAll('div')) {
        const directChildren = [...node.children].map(textOf).filter(Boolean);
        if (directChildren.length === 2) addPair(directChildren[0], directChildren[1]);
      }
    }

    // Fallback: inspect compact two-column rows across the page. Flipkart frequently
    // renders specifications using nested divs rather than semantic tables.
    if (Object.keys(pairs).length < 3) {
      for (const node of sections) {
        const directChildren = [...node.children].map(textOf).filter(Boolean);
        if (directChildren.length === 2) addPair(directChildren[0], directChildren[1]);
      }
    }

    return {
      title,
      meta_description: clean(metaDescription),
      highlights,
      description,
      specifications: pairs
    };
  });

  const jsonDescription = normalizeText(jsonLd?.description);
  const highlights = dom.highlights.length ? dom.highlights : [];

  return {
    title: normalizeText(jsonLd?.name) || dom.title,
    short_description: highlights.length
      ? highlights.join('\n')
      : dom.meta_description || jsonDescription,
    description: dom.description || jsonDescription || dom.meta_description,
    specifications: dom.specifications
  };
}

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  return value.replace(/\s+/g, ' ').trim() || null;
}
