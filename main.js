import { Actor } from 'apify';
import { PuppeteerCrawler, log } from '@crawlee/puppeteer';
import { writeFileSync } from 'fs';
import path from 'path';
import fs from 'fs';
import https from 'https';
import parse from 'csv-parse/lib/sync';

await Actor.init();

log.info('Starting scraper...');

const PRODUCT_LIST_URL = 'https://raw.githubusercontent.com/swiriwon/kwave/main/resource/KWAVE_products_export-sample.csv';
log.info(`Fetching CSV from: ${PRODUCT_LIST_URL}`);

const csvContent = await new Promise((resolve, reject) => {
    https.get(PRODUCT_LIST_URL, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
    }).on('error', err => reject(err));
});

const records = parse(csvContent, { columns: true });
log.info(`CSV column headers: ${Object.keys(records[0])}`);

const titleColumn = 'Title';
const productNames = [...new Set(records.map(r => r[titleColumn]?.trim()).filter(Boolean))];
log.info(`Parsed ${productNames.length} unique product names.`);

const startUrls = productNames.map(name => ({
    url: `https://global.oliveyoung.com/display/search?query=${encodeURIComponent(name)}`,
    userData: { originalName: name }
}));

const outputFolder = '/home/myuser/app/output/';
if (!fs.existsSync(outputFolder)) {
    log.info(`Creating directory: ${outputFolder}`);
    fs.mkdirSync(outputFolder, { recursive: true });
}

const expandName = (short) => {
    const clean = short.replace(/[^a-zA-Z]/g, '').toLowerCase();
    const map = {
        su: 'Susan',
        ka: 'Karan',
        mi: 'Michael',
        an: 'Anna',
        so: 'Sophie',
        da: 'Daniel'
    };
    return map[clean.slice(0, 2)] || (clean.charAt(0).toUpperCase() + clean.slice(1) + 'son');
};

const cleanProductHandle = (name) => {
    return name
        .toLowerCase()
        .replace(/[()]/g, '')
        .replace(/ \/ /g, '-') // space-slash-space to dash
        .replace(/\s*\/\s*/g, '-') // single slash with optional space to dash
        .replace(/\s+/g, '-') // spaces to dash
        .replace(/--+/g, '-'); // collapse multiple dashes
};

const crawler = new PuppeteerCrawler({
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 120,
    navigationTimeoutSecs: 90,

    launchContext: {
        launchOptions: {
            headless: true,
            args: ['--no-sandbox']
        }
    },

    async requestHandler({ page, request, enqueueLinks }) {
        const { originalName } = request.userData;
        log.info(`Processing: ${request.url}`);

        if (request.label === 'DETAIL') {
            try {
                await page.waitForSelector('.product-review-unit.isChecked', { timeout: 30000 });

                const reviews = await page.evaluate(() => {
                    const reviewElems = document.querySelectorAll('.product-review-unit.isChecked');
                    return Array.from(reviewElems).slice(0, 10).map(el => {
                        const getText = (selector) => el.querySelector(selector)?.innerText?.trim() || '';

                        const rawName = getText('.product-review-unit-user-info .review-write-info-writer');
                        const date = getText('.product-review-unit-user-info .review-write-info-date');
                        const text = getText('.review-unit-cont-comment');
                        const image = (() => {
                            const imgEl = el.querySelector('.review-unit-media img');
                            return imgEl?.src?.startsWith('/')
                                ? `https://global.oliveyoung.com${imgEl.src}`
                                : imgEl?.src || '';
                        })();
                        const stars = (() => {
                            const box = el.querySelector('.review-star-rating');
                            const lefts = box?.querySelectorAll('.wrap-icon-star .icon-star.left.filled').length || 0;
                            const rights = box?.querySelectorAll('.wrap-icon-star .icon-star.right.filled').length || 0;
                            return (lefts + rights) * 0.5 || null;
                        })();

                        return {
                            title: '',
                            body: text,
                            rating: stars,
                            review_date: date,
                            reviewer_name: rawName,
                            reviewer_email: '',
                            product_url: window.location.href,
                            picture_urls: image,
                            product_id: '',
                            product_handle: ''
                        };
                    }).filter(r => r.body);
                });

                reviews.forEach(r => {
                    r.reviewer_name = expandName(r.reviewer_name?.replace(/^by\s*/i, ''));
                    r.product_handle = cleanProductHandle(originalName);
                    r.product_url = `https://kwave.ai/products/${r.product_handle}`;
                });

                const filePath = path.join(outputFolder, `scraped_reviews_${new Date().toISOString().split('T')[0]}.json`);
                writeFileSync(filePath, JSON.stringify(reviews, null, 2));
                log.info(`File saved to: ${filePath}`);

                await Actor.pushData(reviews);
            } catch (err) {
                log.error(`Error scraping reviews: ${err.message}`);
            }
        } else {
            const productUrl = await page.evaluate(() => {
                const linkEl = document.querySelector('.prdt-unit a[href*="/product/detail?prdtNo="]');
                return linkEl ? linkEl.href : null;
            });

            if (productUrl) {
                log.info(`Found product detail link. Enqueuing...`);
                await enqueueLinks({ urls: [productUrl], label: 'DETAIL' });
            } else {
                log.warn(`No detail link found for product: ${originalName}`);
            }
        }
    }
});

await crawler.run(startUrls);
await Actor.exit();
