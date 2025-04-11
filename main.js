import { Actor } from 'apify';
import { PuppeteerCrawler, log } from '@crawlee/puppeteer';
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import fetch from 'node-fetch';

await Actor.init();

const PRODUCT_LIST_URL = 'https://raw.githubusercontent.com/swiriwon/kwave/main/resource/KWAVE_products_export-sample.csv';
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
    skip_empty_lines: true,
});

log.info(`CSV column headers: ${Object.keys(records[0]).join(', ')}`);

const titles = Array.from(new Set(records.map(row => row['Title']).filter(Boolean)));

log.info(`Parsed ${titles.length} unique product names.`);

function normalizeName(masked) {
    const firstChar = masked[0];
    return {
        's': 'Susan',
        'k': 'Karan',
        'h': 'Hanna',
        'j': 'James',
        'a': 'Alice',
        'b': 'Brian',
    }[firstChar.toLowerCase()] || 'Customer';
}

function sanitizeProductName(name) {
    return name
        .replace(/[\/()]/g, '')
        .replace(/\s+/g, '-')
        .toLowerCase();
}

const startUrls = titles.map(title => ({
    url: `https://global.oliveyoung.com/display/search?query=${encodeURIComponent(title)}`,
    userData: { title },
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

    async requestHandler({ request, page, enqueueLinks }) {
        if (request.label === 'DETAIL') {
            const { title } = request.userData;
            try {
                await page.waitForSelector('.product-review-unit.isChecked', { timeout: 30000 });
                const reviews = await page.evaluate(() => {
                    const reviewElems = document.querySelectorAll('.product-review-unit.isChecked');
                    return Array.from(reviewElems).slice(0, 10).map(el => {
                        const getText = (selector) => el.querySelector(selector)?.innerText?.trim() || null;

                        const nameMasked = getText('.product-review-unit-user-info .review-write-info-writer') || 'Su***';
                        const fullName = nameMasked.replace(/\*/g, '') + ' ' + normalizeName(nameMasked);

                        const stars = (() => {
                            const box = el.querySelector('.review-star-rating');
                            const lefts = box?.querySelectorAll('.wrap-icon-star .icon-star.left.filled').length || 0;
                            const rights = box?.querySelectorAll('.wrap-icon-star .icon-star.right.filled').length || 0;
                            return (lefts + rights) * 0.5 || null;
                        })();

                        return {
                            title: '',
                            body: getText('.review-unit-cont-comment'),
                            rating: stars,
                            review_date: getText('.product-review-unit-user-info .review-write-info-date'),
                            reviewer_name: fullName,
                            reviewer_email: '',
                            product_url: `https://kwave.ai/products/${sanitizeProductName(title)}`,
                            picture_urls: (() => {
                                const img = el.querySelector('.review-unit-media img');
                                return img ? (img.src.startsWith('/') ? `https://global.oliveyoung.com${img.src}` : img.src) : '';
                            })(),
                            product_id: '',
                            product_handle: sanitizeProductName(title),
                        };
                    });
                });

                const fileName = `${outputFolder}/scraping_data_${new Date().toISOString().split('T')[0]}.csv`;
                const orderedReviews = reviews.map(r => ({
                    title: r.title,
                    body: r.body,
                    rating: r.rating,
                    review_date: r.review_date,
                    reviewer_name: r.reviewer_name,
                    reviewer_email: r.reviewer_email,
                    product_url: r.product_url,
                    picture_urls: r.picture_urls,
                    product_id: r.product_id,
                    product_handle: r.product_handle
                }));

                fs.writeFileSync(fileName, JSON.stringify(orderedReviews, null, 2));
                log.info(`File saved to: ${fileName}`);

                await Actor.pushData(orderedReviews);
            } catch (err) {
                log.error(`Error scraping reviews: ${err.message}`);
            }
        } else {
            const detailUrl = await page.evaluate(() => {
                const el = document.querySelector('.prdt-unit a[href*="/product/detail?prdtNo="]');
                return el?.href || null;
            });

            if (detailUrl) {
                log.info('Found product detail link. Enqueuing...');
                await enqueueLinks({
                    urls: [detailUrl],
                    label: 'DETAIL',
                    userData: request.userData
                });
            } else {
                log.warning(`No detail link found for product: ${request.userData.title}`);
            }
        }
    }
});

await crawler.run(startUrls);
await Actor.exit();
