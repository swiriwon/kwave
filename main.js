import { Actor } from 'apify';
import { PuppeteerCrawler, log } from '@crawlee/puppeteer';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { createObjectCsvWriter } from 'csv-writer';
import fetch from 'node-fetch';

await Actor.init();

const OUTPUT_DIR = path.resolve('./output');
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR);
}

const PRODUCT_CSV_URL = 'https://raw.githubusercontent.com/swiriwon/kwave/main/resource/KWAVE_products_export-sample.csv';

const fetchProductNames = async () => {
    const response = await fetch(PRODUCT_CSV_URL);
    const csvText = await response.text();
    const records = parse(csvText, { columns: true, skip_empty_lines: true });
    const productNames = [...new Set(records.map(row => row['Title']).filter(Boolean))];
    return productNames;
};

const productNames = await fetchProductNames();

const reviews = [];

const crawler = new PuppeteerCrawler({
    maxConcurrency: 1,
    maxRequestRetries: 2,
    async requestHandler({ page, request }) {
        log.info(`Searching for: ${request.userData.productName}`);
        await page.waitForSelector('.sch-prod-list-wrap');

        const foundProduct = await page.evaluate((productName) => {
            const nodes = Array.from(document.querySelectorAll('.prd-info'));
            for (const node of nodes) {
                const name = node.querySelector('.prd-name')?.innerText?.trim();
                const url = node.querySelector('a')?.href;
                if (name?.toLowerCase() === productName.toLowerCase() && url?.includes('prdtNo=')) {
                    const match = url.match(/prdtNo=(GA[0-9]+)/);
                    return match ? match[1] : null;
                }
            }
            return null;
        }, request.userData.productName);

        if (foundProduct) {
            const detailUrl = `https://global.oliveyoung.com/product/detail?prdtNo=${foundProduct}`;
            log.info(`Product found. Navigating to detail page: ${detailUrl}`);
            await crawler.addRequests([{ url: detailUrl, userData: { ...request.userData, label: 'DETAIL', productId: foundProduct } }]);
        } else {
            log.warning(`No product found for: ${request.userData.productName}`);
            const noMatchFile = path.join(OUTPUT_DIR, `mismatched_${new Date().toISOString().split('T')[0]}.csv`);
            fs.appendFileSync(noMatchFile, `${request.userData.productName}\n`);
        }
    },
    async failedRequestHandler({ request }) {
        log.error(`Request failed: ${request.url}`);
    },
});

const detailCrawler = new PuppeteerCrawler({
    maxConcurrency: 1,
    async requestHandler({ page, request }) {
        const reviewsOnPage = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.product-review-unit.isChecked')).map(el => ({
                body: el.querySelector('.review-unit-cont-comment')?.innerText.trim(),
                rating: el.querySelectorAll('.wrap-icon-star .icon-star.filled').length * 0.5,
                review_date: el.querySelector('.review-write-info-date')?.innerText.trim(),
                reviewer_name: el.querySelector('.review-write-info-writer')?.innerText.trim() || 'Anonymous',
                picture_urls: el.querySelector('.review-unit-media img')?.src || '',
            }));
        });

        const productHandle = request.userData.productName.toLowerCase().replace(/\s+/g, '-');
        const productUrl = `https://kwave.ai/products/${productHandle}`;

        for (const r of reviewsOnPage) {
            reviews.push({
                title: request.userData.productName,
                body: r.body,
                rating: r.rating || '',
                review_date: r.review_date || '',
                reviewer_name: r.reviewer_name,
                reviewer_email: '',
                product_url: productUrl,
                picture_urls: r.picture_urls,
                product_id: '',
                product_handle: productHandle,
            });
        }
    },
});

await crawler.run(productNames.map(name => ({
    url: `https://global.oliveyoung.com/display/search?query=${encodeURIComponent(name)}`,
    userData: { productName: name }
})));

await detailCrawler.run([]);

const outputPath = path.join(OUTPUT_DIR, `scraped_reviews_${new Date().toISOString().split('T')[0]}.csv`);
const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: [
        { id: 'title', title: 'title' },
        { id: 'body', title: 'body' },
        { id: 'rating', title: 'rating' },
        { id: 'review_date', title: 'review_date' },
        { id: 'reviewer_name', title: 'reviewer_name' },
        { id: 'reviewer_email', title: 'reviewer_email' },
        { id: 'product_url', title: 'product_url' },
        { id: 'picture_urls', title: 'picture_urls' },
        { id: 'product_id', title: 'product_id' },
        { id: 'product_handle', title: 'product_handle' },
    ]
});
await csvWriter.writeRecords(reviews);
log.info(`Scraped reviews saved to ${outputPath}`);

await Actor.exit();
