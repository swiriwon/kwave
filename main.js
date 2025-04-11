import { Actor } from 'apify';
import { PuppeteerCrawler } from '@crawlee/puppeteer';
import { log } from 'apify';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { createObjectCsvWriter } from 'csv-writer';

await Actor.init();

// Load the product list from the CSV on GitHub
const PRODUCT_LIST_URL = 'https://raw.githubusercontent.com/swiriwon/kwave/main/resource/KWAVE_products_export-sample.csv';
const response = await fetch(PRODUCT_LIST_URL);
const csvContent = await response.text();
const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
});

const uniqueTitles = [...new Set(records.map(row => row['2. column2']).filter(Boolean))];
log.info(`Loaded ${uniqueTitles.length} unique product names.`);

const failedSearches = [];
const scrapedReviews = [];

const crawler = new PuppeteerCrawler({
    launchContext: {
        launchOptions: {
            args: ['--no-sandbox', '--disable-setuid-sandbox'], // ✅ Fix for sandbox issue
        },
    },
    async requestHandler({ request, page }) {
        const searchTerm = request.userData.searchTerm;
        log.info(`Searching for: ${searchTerm}`);

        const noResultsSelector = '.result_no';
        const productLinkSelector = '.prd_info a.name';

        // Wait and detect if product exists
        const hasResults = await page.waitForSelector(`${noResultsSelector}, ${productLinkSelector}`, { timeout: 10000 });
        const noResults = await page.$(noResultsSelector);

        if (noResults) {
            failedSearches.push(searchTerm);
            return;
        }

        const firstProduct = await page.$(productLinkSelector);
        const productHref = await page.evaluate(el => el.getAttribute('href'), firstProduct);
        const match = productHref.match(/prdtNo=([A-Z0-9]+)/);
        if (!match) {
            failedSearches.push(searchTerm);
            return;
        }

        const productId = match[1];
        const productDetailUrl = `https://global.oliveyoung.com/product/detail?prdtNo=${productId}`;

        log.info(`Found product ID: ${productId} — ${productDetailUrl}`);
        await page.goto(productDetailUrl, { waitUntil: 'networkidle2' });

        const reviews = await page.$$eval('.review_list .atc', nodes =>
            nodes.map((node, index) => ({
                product_title: document.querySelector('.prd_info .name')?.innerText?.trim() || '',
                body: node.innerText?.trim() || '',
                rating: 5,
                reviewer_name: 'Anonymous',
                reviewer_email: '',
                created_at: new Date().toISOString(),
                picture_url: '',
                product_id: '',
            }))
        );

        scrapedReviews.push(...reviews);
    },
});

await crawler.run(
    uniqueTitles.map(title => ({
        url: `https://global.oliveyoung.com/display/search?query=${encodeURIComponent(title)}`,
        userData: { searchTerm: title },
    }))
);

// Save matched reviews
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputFilePath = path.join('output', `scraped_reviews_${timestamp}.csv`);
const csvWriter = createObjectCsvWriter({
    path: outputFilePath,
    header: [
        { id: 'product_title', title: 'product_title' },
        { id: 'body', title: 'body' },
        { id: 'rating', title: 'rating' },
        { id: 'reviewer_name', title: 'reviewer_name' },
        { id: 'reviewer_email', title: 'reviewer_email' },
        { id: 'created_at', title: 'created_at' },
        { id: 'picture_url', title: 'picture_url' },
        { id: 'product_id', title: 'product_id' },
    ],
});
await csvWriter.writeRecords(scrapedReviews);
log.info(`Scraped reviews saved to ${outputFilePath}`);

// Save failed/mismatched searches
if (failedSearches.length > 0) {
    const mismatchedPath = path.join('output', `mismatched_${timestamp}.csv`);
    fs.writeFileSync(mismatchedPath, ['Product Name', ...failedSearches].join('\n'), 'utf-8');
    log.info(`Mismatched entries saved to ${mismatchedPath}`);
}

await Actor.exit();
