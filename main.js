import { Actor } from 'apify';
import { PuppeteerCrawler, log } from '@crawlee/puppeteer';
import { writeFile } from 'fs/promises';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { parse } from 'csv-parse/sync';

await Actor.init();

log.info('Starting scraper...');

// URL to the KWAVE CSV product list on GitHub
const PRODUCT_LIST_URL = 'https://raw.githubusercontent.com/swiriwon/kwave/main/resource/KWAVE_products_export-sample.csv';

// Fetch and parse the CSV
log.info(`Fetching CSV from: ${PRODUCT_LIST_URL}`);
const response = await new Promise((resolve, reject) => {
    https.get(PRODUCT_LIST_URL, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
    }).on('error', reject);
});

const records = parse(response, {
    columns: true,
    skip_empty_lines: true
});

console.log('CSV column headers:', Object.keys(records[0] || {}));
const productNames = [...new Set(records.map(r => r["Title"]?.trim()).filter(Boolean))];
log.info(`Parsed ${productNames.length} unique product names.`);

const startUrls = productNames.map(name => ({
    url: `https://global.oliveyoung.com/display/search?query=${encodeURIComponent(name)}`,
    userData: { name }
}));

// Create output folder
const outputFolder = '/home/myuser/app/output/';
if (!fs.existsSync(outputFolder)) {
    log.info(`Creating directory: ${outputFolder}`);
    fs.mkdirSync(outputFolder, { recursive: true });
}

// Setup crawler
const crawler = new PuppeteerCrawler({
    maxRequestRetries: 2,
    requestHandlerTimeoutSecs: 120,
    navigationTimeoutSecs: 90,

    launchContext: {
        launchOptions: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    },

    preNavigationHooks: [
        async (context, gotoOptions) => {
            const { page } = context;
            await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
            gotoOptions.waitUntil = 'networkidle2';
        }
    ],

    async requestHandler({ page, request, enqueueLinks }) {
        const { name } = request.userData;
        log.info(`Processing: ${request.url}`);

        if (request.label === 'DETAIL') {
            // --- SCRAPE REVIEWS ---
            await page.waitForSelector('.product-review-unit.isChecked', { timeout: 15000 });

            const reviews = await page.evaluate(() => {
                const reviewElems = document.querySelectorAll('.product-review-unit.isChecked');
                return Array.from(reviewElems).slice(0, 10).map(el => {
                    const getText = sel => el.querySelector(sel)?.innerText?.trim() || '';

                    const nameRaw = getText('.review-write-info-writer');
                    const name = nameRaw.includes('***') ? nameRaw.replace(/\*+/g, 'a') : nameRaw;

                    const date = getText('.review-write-info-date');
                    const text = getText('.review-unit-cont-comment');
                    const stars = el.querySelectorAll('.icon-star.filled').length * 0.5;

                    const img = el.querySelector('.review-unit-media img');
                    const imageUrl = img ? (img.src.startsWith('/') ? `https://global.oliveyoung.com${img.src}` : img.src) : '';

                    return {
                        title: '',
                        body: text,
                        rating: stars,
                        review_date: date,
                        reviewer_name: name,
                        reviewer_email: '',
                        product_url: '',  // set later
                        product_id: '',
                        product_handle: ''
                    };
                });
            });

            for (const r of reviews) {
                const kwaveUrl = `https://kwave.shop/products/${name.toLowerCase().replace(/ /g, '-')}`;
                r.product_url = kwaveUrl;
                r.product_handle = name.toLowerCase().replace(/ /g, '-');
            }

            const filePath = path.join(outputFolder, `scraping_data_${new Date().toISOString().split('T')[0]}.csv`);
            const csvContent = [
                'title,body,rating,review_date,reviewer_name,reviewer_email,product_url,product_id,product_handle',
                ...reviews.map(r => `"${r.title}","${r.body}","${r.rating}","${r.review_date}","${r.reviewer_name}","${r.reviewer_email}","${r.product_url}","${r.product_id}","${r.product_handle}"`)
            ].join('\n');

            await writeFile(filePath, csvContent);
            log.info(`Saved reviews to CSV: ${filePath}`);
            await Actor.pushData(reviews);

        } else {
            // --- FIND PRODUCT LINK ---
            const productUrl = await page.evaluate(() => {
                const el = document.querySelector('.prdt-unit a[href*="/product/detail?prdtNo="]');
                return el ? el.href : null;
            });

            if (productUrl) {
                log.info(`Found product detail link. Enqueuing...`);
                await enqueueLinks({ urls: [productUrl], label: 'DETAIL', userData: request.userData });
            } else {
                log.warning(`No detail link found for product: ${name}`);
            }
        }
    }
});

await crawler.run(startUrls);
await Actor.exit();
