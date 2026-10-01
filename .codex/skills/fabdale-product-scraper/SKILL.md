---
name: fabdale-product-scraper
description: Scrape one supplied Flipkart product URL into validated Batuly-ready JSON and media, including automatic simple-versus-size-variable classification and exact per-size URLs. Also use when the user asks to prepare or create that scraped product in Fabdale Batuly through the connected browser, with NPR pricing supplied or approved by the user.
---

# Fabdale Product Scraper

Use the repository containing this skill as the scraper root. Scraping always produces local JSON and media first. Import into Batuly only when the user explicitly asks for it.

## Run a product scrape

Require one public `flipkart.com` product URL. Accept optional Batuly product ID, SKU, and output directory without inventing missing values.

From the repository root, ensure dependencies and the bundled Chromium browser exist, then run:

```bash
npm run scrape -- \
  --url "<flipkart-url>" \
  --output "<output-directory>" \
  --product-id "<optional-product-id>" \
  --sku "<optional-sku>"
```

Omit optional flags when values were not provided. Add `--no-media` when the user requests JSON only; otherwise retain media extraction. Use a new output directory for a logically new product. An existing output directory is persistent crawl state, so reuse it only to resume that same scrape. Add `--force` only when the user asks to refresh an existing successful result.

If dependencies are absent, run `npm ci`. If Playwright reports a missing browser executable, run `npm run install:browsers` and retry once.

## Verify the result

Run the deterministic validator:

```bash
npm run validate:output -- "<output-directory>"
```

Do not report a ready result when validation fails. A successful variable product must contain a complete size mapping with one selected variant and exact Flipkart URLs/PIDs. A successful simple product must have no variants and `variant_discovery.status` equal to `not_applicable`.

Never construct or guess variant URLs. Preserve the URLs extracted from Flipkart. If the page exposes a size selector but links cannot be extracted, keep the result `unknown`/`partial`, report the discovery error, and do not reinterpret it as a simple product.

Use browser inspection only to diagnose a blocked page, changed selector, or failed validation. Do not manually replace a failed structured result with an unverified JSON transcription.

Read [references/output-schema.md](references/output-schema.md) when interpreting the JSON for Batuly or explaining how variant notes should be populated.

## Prepare or create the product in Batuly

When Batuly entry is requested, read [references/batuly-browser-import.md](references/batuly-browser-import.md) before operating the browser. Use the current beta create/edit form, not legacy pages.

Do not invent commercial data. Flipkart prices are INR while Batuly prices are NPR. Report the source price and a direct conversion only as a reference, then obtain the user's chosen selling price, MRP, purchase price, opening stock, and SKU scheme before saving. Category choices may be proposed from the scraped data, but call out ambiguous mappings.

Prepare the form completely before asking for the required action-time confirmation to click **Create Product** or save edits. After confirmation, submit once and verify the saved product, variant count, images, and variant notes in Batuly.

## Learn user-directed behavior

Treat every user correction or newly stated workflow rule as an instruction to update this skill, not merely as a one-run adjustment. After applying the correction to the current product, encode the reusable behavior in this `SKILL.md` or the appropriate file under `references/`, then validate the skill again.

Examples include pricing formulas, INR-to-NPR conversion and rounding, purchase-price rules, naming conventions, category mappings, preferred specs, SKU generation, stock defaults, visibility, image grouping, and the point at which the workflow must pause for user input.

Persist the rule at the most precise useful scope. A rule declared for all future imports is global; a rule limited to a brand, category, or product type must keep that condition. Do not generalize a one-product value into a standing rule unless the user states it as one. Never write passwords, session tokens, personal data, or other secrets into the skill.

## Report

Return the absolute product JSON path, crawl status, product type, discovered sizes and PIDs, and whether media was downloaded. If an import was requested, also report the Batuly product result, chosen NPR pricing, variant count, image count, and any fields left unresolved.
