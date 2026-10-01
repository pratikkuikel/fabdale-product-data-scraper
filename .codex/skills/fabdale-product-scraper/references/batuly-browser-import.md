# Batuly beta browser import

Use the connected browser and the current Batuly beta product editor at `/pos/products/editor`. Treat the scraped JSON as source data and Batuly's dropdowns as the authority for available catalog values.

## Continuous workflow learning

When the user changes how an import should behave, apply that change to the active draft and record it in the skill before concluding the task. This includes any rule for calculating selling price, purchase price, or MRP; conversion rate and rounding; field/category mapping; descriptions; specs; SKU format; inventory defaults; visibility; media assignment; variant notes; and review/save sequencing.

Record reusable rules with their stated scope and precedence. A later explicit user correction supersedes an older conflicting rule. Keep one-off product facts in the scrape or current draft rather than turning them into defaults. Do not persist credentials, authentication material, or sensitive personal information.

## Before form entry

1. Validate the scrape and reject `product_type: unknown` or incomplete variant discovery.
2. Read the product JSON and downloaded media manifest. Prefer `raw.dom.specifications` when normalized specs are sparse.
3. Identify the source INR selling price and, when useful, show the direct INR-to-NPR conversion as a reference. Never silently use that reference as Batuly's selling price.
4. Obtain or confirm selling price, MRP, purchase price, opening stock, and SKU scheme. Values may be common to all variants or supplied per variant.
5. Select the closest existing Batuly category. Ask only when the mapping is materially ambiguous.

## Product fields

- Use a concise catalog name containing the product type and primary color when that improves disambiguation.
- Rewrite source copy into a clean factual description and short description. Do not include Flipkart marketing language, INR prices, ratings, or shipping promises.
- Select `Stock` and unit `pcs` unless the user specifies otherwise.
- Keep POS/Ecommerce visibility on unless the user asks to hide the product.
- If no sizes were discovered, create a Simple Product and preserve the supplied Flipkart URL in product-level notes when available.
- If sizes were discovered, create Product with Variants. Use `Color` and `Size` axes when both are present, even when there is only one color. Let Batuly generate the matrix.

## Specs and images

- Add shared non-variant characteristics as Specs using existing Batuly attribute/value dropdowns. Useful apparel examples include Fabric, Pattern, Neck, Sleeve Length, Dupatta Included, Top Type, Bottom Type, and Gender.
- Skip a spec when Batuly has no accurate value. Never select a near-looking but incorrect brand or attribute value.
- Group catalog images by Color for color-bearing products.
- Upload the downloaded images to the matching color group. Verify each upload says `Upload complete` and remains visible in the list.
- Upload a size chart only when the scrape includes a genuine size-chart asset.

## Variant matrix

For each child row, map the displayed size to the matching `variants[].size` entry. Put the exact `variants[].url` in that row's Advanced fields → Notes. Do not use the family URL for all rows and do not synthesize URLs.

Use the bulk editor when price and stock values are common. Generate SKUs from the user's prefix only when requested; otherwise enter their exact SKUs. Confirm that every required selling price and SKU is populated and that each variant remains visible unless instructed otherwise.

## Save and verify

Creating or editing the catalog item changes the user's live business data. Prepare and review the complete form first, then ask for action-time confirmation immediately before clicking **Create Product** or the final save control.

After submission, verify the browser visibly shows a successful saved state or saved product page. Check:

- correct product name and category;
- Simple versus Product with Variants;
- expected variant count and size labels;
- NPR prices, stock, and SKUs;
- catalog image count and color grouping;
- exact per-size Flipkart URLs in variant notes.

If submission fails, keep the form open, report the visible validation error, correct only supported fields, and retry only after the form is again ready for final save.
