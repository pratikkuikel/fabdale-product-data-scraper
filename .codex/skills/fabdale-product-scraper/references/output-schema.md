# Fabdale single-product output

The product artifact is stored at `products/<product-id-or-source-key>/product.json` beneath the selected output directory.

## Classification

- `product_type: "simple"`: no size selector was found. `variants` is empty and `variant_discovery.status` is `not_applicable`.
- `product_type: "variable"`: size-specific product links were found. `variant_discovery.status` is `complete`.
- `product_type: "unknown"`: the page failed before classification or exposed a size selector whose links could not be extracted. Do not import this result as a simple product.

## Size variants

Every variable-product entry has:

- `size`: Flipkart's displayed size label.
- `pid`: the exact PID from that size link.
- `url`: the actual absolute Flipkart link captured from the page.
- `available`: false only when the page explicitly marks the link disabled or unavailable; otherwise true.
- `selected`: true for the variant represented by the supplied/current product URL.

PIDs are unique within `variants`, and exactly one entry should be selected in a valid variable-product result.

## Batuly mapping

Match each `variants[].size` to the corresponding Batuly child variant. Store that entry's `url` in the child variant's notes. Shared descriptions and media may be reused across sizes. The scraper does not perform this database update.

Use `source.url` and `source.final_url` as provenance for the scraped page. Do not substitute these family/source URLs for a child variant's exact `variants[].url`.
