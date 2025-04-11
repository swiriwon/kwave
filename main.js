import { Actor } from 'apify';
import { PuppeteerCrawler, log } from '@crawlee/puppeteer';
import { writeFile } from 'fs';
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';
import { parse } from 'csv-parse/sync';

await Actor.init();

const input = await Actor.getInput();
const PRODUCT_LIST_URL = input?.productListUrl || 'https://raw.githubusercontent.com/swiriwon/kwave/main/resource/KWAVE_products_export-sample.csv';
const outputFolder = '/home/myuser/app/output/';

if (!fs.existsSync(outputFolder)) {
    log.info(`Creating directory: ${outputFolder}`);
    fs.mkdirSync(outputFolder, { recursive: true });
}

log.info('Starting scraper...');
log.info(`Fetching CSV from: ${PRODUCT_LIST_URL}`);

const response = await fetch(PRODUCT_LIST_URL);
const csvText = await response.text();

const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true
});

log.info(`CSV column headers: ${Object.keys(records[0]).join(', ')}`);

const productNames = [...new Set(records.map(r => r['Title']).filter(Boolean))];
log.info(`Parsed ${productNames.length} unique product names.`);

const startUrls = productNames.map(name => ({
    url: `https://global.oliveyoung.com/display/search?query=${encodeURIComponent(name)}`,
    userData: { label: 'SEARCH', title: name }
}));

const crawler = new PuppeteerCrawler({
    maxRequestRetries: 3,
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
            gotoOptions.timeout = 90000;
            gotoOptions.waitUntil = 'networkidle2';
        }
    ],
    async requestHandler({ page, request, enqueueLinks }) {
        const { label, title } = request.userData;

        if (label === 'DETAIL') {
            try {
                await page.waitForSelector('.product-review-unit.isChecked', { timeout: 30000 });
                
                const reviews = await page.evaluate((productTitle) => {
                    const sanitize = (str) =>
                        str.toLowerCase()
                            .replace(/[\s\/]+/g, '-')
                            .replace(/[()]/g, '')
                            .replace(/[^a-z0-9\-]/g, '');
                
                    const fakeNames = [
                        'Ariana', 'Blake', 'Carter', 'Daisy', 'Elias', 'Fiona', 'Gavin', 'Hazel',
                        'Ian', 'Jade', 'Karan', 'Lana', 'Milo', 'Nora', 'Owen', 'Paige', 'Quincy', 'Riley',
                        'Sophie', 'Troy', 'Uma', 'Vera', 'Wyatt', 'Xena', 'Yara', 'Zane',
                        'Alexis', 'Bryce', 'Chloe', 'Derek', 'Ella', 'Felix', 'Grace', 'Hunter',
                        'Isla', 'Jake', 'Kylie', 'Liam', 'Maya', 'Noah', 'Olivia', 'Piper',
                        'Quinn', 'Ryder', 'Stella', 'Theo', 'Uriel', 'Violet', 'Wes', 'Xavier', 'Yasmine', 'Zara'
                    ];
                
                    const getFakeName = (prefix) => {
                        const seed = prefix.toLowerCase().split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
                        return fakeNames[seed % fakeNames.length];
                    };
                
                    const reviewElems = document.querySelectorAll('.product-review-unit.isChecked');
                    return Array.from(reviewElems).slice(0, 10).map(el => {
                        const getText = (sel) => el.querySelector(sel)?.innerText?.trim() || '';
                        const masked = getText('.product-review-unit-user-info .review-write-info-writer').replace(/^by\.\s*/i, '');
                        const prefix = masked.replace(/\*/g, '').slice(0, 2);
                        const reviewerName = getFakeName(prefix || 'xx');
                
                        const stars = (() => {
                            const box = el.querySelector('.review-star-rating');
                            const lefts = box?.querySelectorAll('.wrap-icon-star .icon-star.left.filled').length || 0;
                            const rights = box?.querySelectorAll('.wrap-icon-star .icon-star.right.filled').length || 0;
                            return (lefts + rights) * 0.5 || null;
                        })();
                
                        return {
                            title: productTitle,
                            body: getText('.review-unit-cont-comment'),
                            rating: stars,
                            review_date: getText('.product-review-unit-user-info .review-write-info-date'),
                            reviewer_name: reviewerName,
                            reviewer_email: '',
                            product_url: `https://kwave.ai/products/${sanitize(productTitle)}`,
                            picture_urls: (() => {
                                const img = el.querySelector('.review-unit-media img');
                                return img ? (img.src.startsWith('/') ? `https://global.oliveyoung.com${img.src}` : img.src) : '';
                            })(),
                            product_id: '',
                            product_handle: sanitize(productTitle),
                        };
                    }).filter(r => r.body);
                }, title);

                log.info(`Extracted ${reviews.length} reviews`);

                const fileName = `${outputFolder}/scraping_data_${new Date().toISOString().split('T')[0]}.csv`;
                const headers = ['title', 'body', 'rating', 'review_date', 'reviewer_name', 'reviewer_email', 'product_url', 'picture_urls', 'product_id', 'product_handle'];
                const rows = [headers.join(',')].concat(reviews.map(r =>
                    headers.map(h => `"${(r[h] || '').toString().replace(/"/g, '""')}"`).join(',')
                ));

                await writeFile(fileName, rows.join('\n'), (err) => {
                    if (err) log.error("Failed to save the file", err);
                    else log.info(`File saved to: ${fileName}`);
                });

                await Actor.pushData(reviews);
            } catch (err) {
                log.error(`Error scraping reviews: ${err.message}`);
            }
        } else {
            const productUrl = await page.evaluate(() => {
                const el = document.querySelector('.prdt-unit a[href*="/product/detail?prdtNo="]');
                return el ? el.href : null;
            });

            if (productUrl) {
                log.info(`Found product detail link. Enqueuing...`);
                await enqueueLinks({
                    urls: [productUrl],
                    label: 'DETAIL',
                    userData: { label: 'DETAIL', title }
                });
            } else {
                log.warning(`No detail link found for product: ${title}`);
            }
        }
    }
});

await crawler.run(startUrls);
await Actor.exit();
