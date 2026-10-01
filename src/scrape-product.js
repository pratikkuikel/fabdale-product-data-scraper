import { collectMediaCandidates, downloadMedia } from './media.js';
import { ensureDir } from './utils.js';

export async function scrapeProduct({
  context,
  input,
  outputDir,
  imageQuality = 100,
  downloadAssets = true,
  resolveMedia = null
}) {
  await ensureDir(outputDir);

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
    product_type: 'unknown',
    variants: [],
    variant_discovery: {
      attribute: 'size',
      status: 'pending',
      selected_value: null,
      error: null
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
    const variantDiscovery = await extractProductVariants(page);
    const mediaCandidates = await collectMediaCandidates(page, jsonLd, [...capturedMediaUrls]);
    const resolvedMedia = resolveMedia
      ? await resolveMedia({
        candidates: mediaCandidates,
        imageQuality,
        enabled: downloadAssets,
        download: (mediaOutputDir, selectedCandidates = mediaCandidates) => downloadMedia({
          context,
          sourceUrl: input.url,
          outputDir: mediaOutputDir,
          candidates: selectedCandidates,
          imageQuality,
          enabled: downloadAssets
        })
      })
      : {
        bundle: null,
        media: await downloadMedia({
          context,
          sourceUrl: input.url,
          outputDir,
          candidates: mediaCandidates,
          imageQuality,
          enabled: downloadAssets
        })
      };
    const media = resolvedMedia.media;
    const mediaFailures = [...media.images, ...media.videos]
      .filter((item) => !item.downloaded && !['streaming_manifest', 'media_disabled'].includes(item.reason));
    const errors = [];
    if (mediaFailures.length > 0) errors.push(`${mediaFailures.length} media asset(s) failed to download`);
    if (variantDiscovery.status === 'incomplete') errors.push(variantDiscovery.error);

    const result = {
      ...baseResult,
      source: {
        ...baseResult.source,
        final_url: page.url()
      },
      crawl: {
        status: errors.length > 0 ? 'partial' : 'success',
        error: errors.length > 0 ? errors.join('; ') : null
      },
      content: extracted.content,
      product_type: variantDiscovery.product_type,
      variants: variantDiscovery.variants,
      variant_discovery: {
        attribute: 'size',
        status: variantDiscovery.status,
        selected_value: variantDiscovery.selected_value,
        error: variantDiscovery.error
      },
      media,
      media_bundle: resolvedMedia.bundle,
      raw: {
        json_ld: jsonLd,
        dom: extracted.raw
      }
    };

    return result;
  } catch (error) {
    const result = {
      ...baseResult,
      source: {
        ...baseResult.source,
        final_url: page.url() || input.url
      },
      crawl: {
        status: /page blocked or unavailable/i.test(error.message) ? 'blocked' : 'failed',
        error: error.message
      }
    };

    return result;
  } finally {
    await page.close();
  }
}

export async function extractProductVariants(page, pageUrl = null) {
  return page.evaluate((requestedPageUrl) => {
    const clean = (value) => value?.replace(/\s+/g, ' ').trim() || '';
    const currentUrl = new URL(requestedPageUrl || window.location.href);
    const currentPid = currentUrl.searchParams.get('pid')?.toUpperCase() || null;
    const currentPath = currentUrl.pathname.replace(/\/$/, '');
    const selectedLabel = [...document.querySelectorAll('div,span')]
      .find((node) => /^selected\s+size\s*:?$/i.test(clean(node.textContent)));
    const selectedValue = clean(selectedLabel?.nextElementSibling?.textContent) || null;
    const rawCandidates = [];

    for (const anchor of document.querySelectorAll('a[href]')) {
      const rawHref = anchor.getAttribute('href')?.trim() || '';
      if (!rawHref || rawHref.startsWith('#')) continue;

      const size = clean(anchor.textContent);
      if (!size || size.length > 30 || /^size chart$/i.test(size)) continue;

      let url;
      try {
        url = new URL(anchor.href, currentUrl);
      } catch {
        continue;
      }

      const pid = url.searchParams.get('pid')?.toUpperCase() || null;
      const sameProductPath = url.pathname.replace(/\/$/, '') === currentPath;
      if (!pid || !sameProductPath) continue;

      const unavailableText = [
        anchor.getAttribute('aria-label'),
        anchor.getAttribute('title'),
        anchor.getAttribute('data-tooltip'),
        anchor.parentElement?.getAttribute('aria-label'),
        anchor.parentElement?.getAttribute('title'),
        anchor.className,
        anchor.parentElement?.className
      ].map(clean).join(' ');
      const explicitlyDisabled = anchor.hasAttribute('disabled')
        || anchor.getAttribute('aria-disabled') === 'true'
        || anchor.parentElement?.getAttribute('aria-disabled') === 'true'
        || /(?:out\s*of\s*stock|unavailable|disabled)/i.test(unavailableText);

      rawCandidates.push({
        size,
        pid,
        url: url.toString(),
        available: !explicitlyDisabled,
        selected: pid === currentPid || Boolean(selectedValue && size.toLowerCase() === selectedValue.toLowerCase())
      });
    }

    const variants = [];
    const seenPids = new Set();
    for (const candidate of rawCandidates) {
      if (seenPids.has(candidate.pid)) continue;
      seenPids.add(candidate.pid);
      variants.push(candidate);
    }

    const hasSizeSelector = Boolean(selectedLabel) || variants.length > 1;
    if (!hasSizeSelector) {
      return {
        product_type: 'simple',
        variants: [],
        status: 'not_applicable',
        selected_value: null,
        error: null
      };
    }

    if (variants.length === 0) {
      return {
        product_type: 'unknown',
        variants: [],
        status: 'incomplete',
        selected_value: selectedValue,
        error: 'A size selector was visible, but no size-specific product URLs could be extracted'
      };
    }

    return {
      product_type: 'variable',
      variants,
      status: 'complete',
      selected_value: selectedValue || variants.find((variant) => variant.selected)?.size || null,
      error: null
    };
  }, pageUrl);
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
  const labels = ['Read More', 'View More', 'more'];

  for (const label of labels) {
    const locator = page.getByText(label, { exact: true });
    const count = Math.min(await locator.count().catch(() => 0), 20);

    for (let index = 0; index < count; index += 1) {
      await locator.nth(index).click({ force: true, timeout: 1_500 }).catch(() => {});
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

    const addPair = (pairs, key, value) => {
      key = clean(key);
      value = clean(value);
      if (!key || !value || key === value || key.length > 100 || value.length > 200) return;
      if (['specifications', 'manufacturer info', 'general', 'general details'].includes(key.toLowerCase())) return;
      if (!pairs[key]) pairs[key] = value;
    };

    const rawSpecifications = {};

    for (const row of document.querySelectorAll('table tr')) {
      const cells = [...row.querySelectorAll('th,td')].map(textOf).filter(Boolean);
      if (cells.length >= 2) addPair(rawSpecifications, cells[0], cells.slice(1).join(' '));
    }

    for (const dt of document.querySelectorAll('dt')) {
      addPair(rawSpecifications, textOf(dt), textOf(dt.nextElementSibling));
    }

    const specsRoot = findHeadingContainer('Specifications');
    if (specsRoot) {
      for (const node of specsRoot.querySelectorAll('div')) {
        const directChildren = [...node.children].map(textOf).filter(Boolean);
        if (directChildren.length === 2) addPair(rawSpecifications, directChildren[0], directChildren[1]);
      }
    }

    const productHighlights = {};
    const productHighlightsRoot = findHeadingContainer('Product highlights');
    if (productHighlightsRoot) {
      for (const node of productHighlightsRoot.querySelectorAll('div')) {
        const directChildren = [...node.children].map(textOf).filter(Boolean);
        if (directChildren.length === 2) addPair(productHighlights, directChildren[0], directChildren[1]);
      }
    }

    const exactTextNode = (label) => [...document.querySelectorAll('div,span,h1,h2,h3,h4,h5')]
      .find((node) => textOf(node)?.toLowerCase() === label.toLowerCase());
    const allDetailsLabel = exactTextNode('All details');
    const ratingsLabel = exactTextNode('Ratings and reviews');
    const descriptionSections = [];
    const descriptionSectionKeys = new Set();

    if (allDetailsLabel) {
      for (const node of document.querySelectorAll('div')) {
        const followsAllDetails = Boolean(
          allDetailsLabel.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING
        );
        const precedesRatings = ! ratingsLabel || Boolean(
          node.compareDocumentPosition(ratingsLabel) & Node.DOCUMENT_POSITION_FOLLOWING
        );

        if (! followsAllDetails || ! precedesRatings) continue;

        const directChildren = [...node.children].map(textOf).filter(Boolean);
        if (directChildren.length !== 2) continue;

        const [heading, rawBody] = directChildren;
        const body = rawBody.replace(/\.\.\.more$/i, '…');
        if (heading.length < 3 || heading.length > 80 || body.length < 40 || body.length > 1_500) continue;
        if (
          ['all details', 'showcase', 'specifications', 'description', 'manufacturer info', 'ratings and reviews', 'general']
            .some((label) => heading.toLowerCase().includes(label))
        ) continue;
        if (/verified buyers|show all reviews|questions and answers/i.test(body)) continue;

        const key = `${heading}\n${body}`;
        if (descriptionSectionKeys.has(key)) continue;

        descriptionSectionKeys.add(key);
        descriptionSections.push({ heading, body });
      }
    }

    return {
      title,
      meta_description: clean(metaDescription),
      highlights,
      description,
      product_highlights: productHighlights,
      raw_specifications: rawSpecifications,
      description_sections: descriptionSections
    };
  });

  const jsonDescription = normalizeText(jsonLd?.description);
  return buildProductContent(dom, { ...jsonLd, description: jsonDescription });
}

export function buildProductContent(dom, jsonLd = null) {
  const jsonDescription = normalizeText(jsonLd?.description);
  const shortDescription = formatHighlights(dom.highlights, dom.product_highlights);
  const longDescription = formatDescriptionSections(dom.description_sections);

  return {
    content: {
      title: normalizeText(jsonLd?.name) || dom.title,
      short_description: shortDescription || dom.meta_description || jsonDescription,
      description: longDescription || dom.description || jsonDescription || dom.meta_description,
      specifications: dom.product_highlights
    },
    raw: {
      meta_description: dom.meta_description,
      highlights: dom.highlights,
      description: dom.description,
      description_sections: dom.description_sections,
      product_highlights: dom.product_highlights,
      specifications: dom.raw_specifications
    }
  };
}

export function formatHighlights(highlights, specifications) {
  if (highlights.length > 0) return highlights.join('\n');

  const priority = [
    'color',
    'fabric',
    'pattern',
    'type',
    'ideal for',
    'fit',
    'sleeve',
    'occasion',
    'style code',
    'brand'
  ];
  const entries = Object.entries(specifications).sort(([left], [right]) => {
    const leftIndex = priority.indexOf(left.toLowerCase());
    const rightIndex = priority.indexOf(right.toLowerCase());
    return (leftIndex === -1 ? priority.length : leftIndex)
      - (rightIndex === -1 ? priority.length : rightIndex);
  });

  return entries
    .slice(0, 8)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n') || null;
}

export function formatDescriptionSections(sections) {
  return sections
    .map(({ heading, body }) => `${heading}\n${body}`)
    .join('\n\n') || null;
}

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  return value.replace(/\s+/g, ' ').trim() || null;
}
