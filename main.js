import { Actor } from 'apify';
import { PuppeteerCrawler, log } from '@crawlee/puppeteer';
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import path from 'path';
import { finished } from 'stream/promises';
import { createObjectCsvWriter } from 'csv-writer';

await Actor.init();

const PRODUCT_LIST_URL = 'https://raw.githubusercontent.com/swiriwon/kwave/main/resource/KWAVE_products_export-sample.csv';
log.info(`Fetching CSV from: ${PRODUCT_LIST_URL}`);
const response = await fetch(PRODUCT_LIST_URL);
const csvText = await response.text();

const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true
});

const productNames = [...new Set(records.map(row => row.title).filter(Boolean))];
log.info(`Parsed ${productNames.length} unique product names.`);

// Prepare initial URLs to search each product on Olive Young
const startUrls = productNames.map(name => ({
    url: `https://global.oliveyoung.com/display/search?query=${encodeURIComponent(name)}`,
    userData: { productName: name }
}));

const outputFolder = '/home/myuser/app/output/';
if (!fs.existsSync(outputFolder)) {
    log.info(`Creating directory: ${outputFolder}`);
    fs.mkdirSync(outputFolder, { recursive: true });
}

const outputFile = path.join(outputFolder, `scraping_data_${new Date().toISOString().split('T')[0]}.csv`);
const csvWriter = createObjectCsvWriter({
    path: outputFile,
    header: [
        { id: 'title', title: 'title' },
        { id: 'body', title: 'body' },
        { id: 'rating', title: 'rating' },
        { id: 'review_date', title: 'review_date' },
        { id: 'reviewer_name', title: 'reviewer_name' },
        { id: 'reviewer_email', title: 'reviewer_email' },
        { id: 'product_url', title: 'product_url' },
        { id: 'product_id', title: 'product_id' },
        { id: 'product_handle', title: 'product_handle' }
    ]
});

const crawler = new PuppeteerCrawler({
    maxRequestRetries: 2,
    requestHandlerTimeoutSecs: 90,
    navigationTimeoutSecs: 60,

    launchContext: {
        launchOptions: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    },

    async requestHandler({ page, request, enqueueLinks }) {
        const { productName } = request.userData;

        if (request.label === 'DETAIL') {
            try {
                await page.waitForSelector('.product-review-unit.isChecked', { timeout: 30000 });
                const reviews = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('.product-review-unit.isChecked')).slice(0, 10).map(el => {
                        const getText = sel => el.querySelector(sel)?.innerText?.trim() || '';
                        const name = getText('.review-write-info-writer').replace(/\*+/, '***') || 'Anonymous';
                        const date = getText('.review-write-info-date');
                        const body = getText('.review-unit-cont-comment');
                        const stars = el.querySelectorAll('.wrap-icon-star .icon-star.filled').length * 0.5;
                        return { name, date, body, stars };
                    }).filter(r => r.body);
                });

                const prdtNo = new URL(request.url).searchParams.get('prdtNo') || '';
                const productHandle = productName.toLowerCase().replace(/\s+/g, '-');
                const productUrl = `https://global.oliveyoung.com/product/detail?prdtNo=${prdtNo}`;

                const formatted = reviews.map(r => ({
                    title: '',
                    body: r.body,
                    rating: r.stars,
                    review_date: r.date,
                    reviewer_name: r.name.replace(/\*+/, 'a'),
                    reviewer_email: '',
                    product_url: productUrl,
                    product_id: '',
                    product_handle: productHandle
                }));

                await csvWriter.writeRecords(formatted);
                await Actor.pushData(formatted);
                log.info(`Saved ${formatted.length} reviews for ${productName}`);
            } catch (err) {
                log.warning(`Failed to scrape detail page: ${err.message}`);
            }

        } else {
            const productUrl = await page.evaluate(() => {
                const linkEl = document.querySelector('.prdt-unit a[href*="/product/detail?prdtNo="]');
                return linkEl ? linkEl.href : null;
            });

            if (productUrl) {
                log.info(`Found product detail link. Enqueuing...`);
                await enqueueLinks({
                    urls: [productUrl],
                    userData: request.userData,
                    label: 'DETAIL'
                });
            } else {
                log.warn(`No detail link found for product: ${productName}`);
            }
        }
    }
});

await crawler.run(startUrls);
await Actor.exit();
