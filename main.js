import { Actor } from 'apify';
import { PuppeteerCrawler, log } from '@crawlee/puppeteer';
import { Parser } from 'json2csv';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { parse as csvParse } from 'csv-parse/sync';
import assert from 'assert';

await Actor.init();

const input = await Actor.getInput();
const PRODUCT_LIST_URL = input.productListUrl;

log.info('Starting scraper...');

const outputFolder = '/home/myuser/app/output/';
const mismatchLogPath = path.join(outputFolder, 'mismatches.log');

if (!fs.existsSync(outputFolder)) {
    log.info(`Creating directory: ${outputFolder}`);
    fs.mkdirSync(outputFolder, { recursive: true });
}

function logMismatch(message) {
    fs.appendFileSync(mismatchLogPath, `${new Date().toISOString()} - ${message}\n`);
}

log.info(`Fetching CSV from: ${PRODUCT_LIST_URL}`);
const response = await fetch(PRODUCT_LIST_URL);
const csvText = await response.text();
const records = csvParse(csvText, { columns: true, skip_empty_lines: true });
log.info(`CSV column headers: ${Object.keys(records[0]).join(', ')}`);

const productNames = [...new Set(records.map(r => r['Title']).filter(Boolean))];
log.info(`Parsed ${productNames.length} unique product names.`);

const startUrls = productNames.map(name => ({
    url: `https://global.oliveyoung.com/display/search?query=${encodeURIComponent(name)}`,
    userData: { label: 'SEARCH', productName: name }
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
        const { label, productName } = request.userData;

        if (label === 'SEARCH') {
            const productUrl = await page.evaluate(() => {
                const linkEl = document.querySelector('.prdt-unit a[href*="/product/detail?prdtNo="]');
                return linkEl ? linkEl.href : null;
            });
            if (productUrl) {
                log.info('Found product detail link. Enqueuing...');
                await enqueueLinks({
                    urls: [productUrl],
                    label: 'DETAIL',
                    userData: { productName }
                });
            } else {
                log.warning(`No detail link found for product: ${productName}`);
                logMismatch(`Missing detail link for: ${productName}`);
            }
        }

        if (label === 'DETAIL') {
            try {
                await page.waitForSelector('.product-review-unit.isChecked', { timeout: 30000 });
                const reviews = await page.evaluate(({ productName }) => {
                    const FAKE_NAMES = [
                        'Emma', 'Olivia', 'Ava', 'Isabella', 'Sophia', 'Charlotte', 'Amelia', 'Mia', 'Harper', 'Evelyn',
                        'Liam', 'Noah', 'Oliver', 'Elijah', 'James', 'William', 'Benjamin', 'Lucas', 'Henry', 'Alexander',
                        'Chloe', 'Ella', 'Grace', 'Lily', 'Zoe', 'Nora', 'Scarlett', 'Hannah', 'Aria', 'Layla',
                        'Jack', 'Logan', 'Jackson', 'Levi', 'Sebastian', 'Mateo', 'David', 'Joseph', 'Carter', 'Owen',
                        'Penelope', 'Riley', 'Victoria', 'Madison', 'Eleanor', 'Hazel', 'Aurora', 'Natalie', 'Lucy', 'Savannah',
                        'Leo', 'Wyatt', 'Dylan', 'Isaac', 'Gabriel', 'Julian', 'Lincoln', 'Anthony', 'Hudson', 'Ezra'
                    ];
                    const reviewElems = document.querySelectorAll('.product-review-unit.isChecked');
                    const usedNames = new Set();

                    const generateName = () => {
                        let name;
                        do {
                            name = FAKE_NAMES[Math.floor(Math.random() * FAKE_NAMES.length)];
                        } while (usedNames.has(name));
                        usedNames.add(name);
                        return name;
                    };

                    const sanitize = str => str.toLowerCase()
                        .replace(/\s*\/\s*/g, '-')
                        .replace(/[(),/]/g, '')
                        .replace(/\s+/g, '-')
                        .replace(/-+/g, '-');

                    return Array.from(reviewElems).slice(0, 10).map(el => {
                        const getText = (selector) => el.querySelector(selector)?.innerText?.trim() || null;
                        const getImages = () => Array.from(el.querySelectorAll('img')).map(img => img.src).join(',');

                        const nameRaw = getText('.product-review-unit-user-info .review-write-info-writer');
                        const name = (!nameRaw || nameRaw.includes('*') || nameRaw.trim() === '') ? generateName() : nameRaw;

                        const date = getText('.product-review-unit-user-info .review-write-info-date');
                        const text = getText('.review-unit-cont-comment');
                        const stars = (() => {
                            const box = el.querySelector('.review-star-rating');
                            const lefts = box?.querySelectorAll('.wrap-icon-star .icon-star.left.filled').length || 0;
                            const rights = box?.querySelectorAll('.wrap-icon-star .icon-star.right.filled').length || 0;
                            return (lefts + rights) * 0.5 || null;
                        })();

                        const productUrl = `https://kwave.ai/products/${sanitize(productName)}`;

                        return {
                            title: productName,
                            body: text,
                            rating: stars,
                            review_date: date,
                            reviewer_name: name,
                            reviewer_email: '',
                            product_url: productUrl,
                            picture_urls: getImages(),
                            product_id: '',
                            product_handle: ''
                        };
                    }).filter(r => r.body);
                }, { productName });

                log.info(`Extracted ${reviews.length} reviews`);

                const fields = ['title', 'body', 'rating', 'review_date', 'reviewer_name', 'reviewer_email', 'product_url', 'picture_urls', 'product_id', 'product_handle'];
                const parser = new Parser({ fields });

                // Reordered Reviews to ensure columns are in the exact order
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
                
                const csvRows = orderedReviews.map(r => fields.map(f => r[f]).join(',')); // Ensure columns are in the desired order
                
                const csvHeader = fields.join(',');
                const csvContent = [csvHeader, ...csvRows].join(',');  // Keep the join(',') for proper CSV formatting
                
                // Write the CSV file
                fs.writeFileSync(filePath, csvContent);
                
                    // Validate column order in CSV
                    const expectedOrder = fields.join(',');
                    const actualOrder = csvContent.split('\n')[0].replace(/"/g, '');  // Strip quotes for validation
                    assert.strictEqual(actualOrder, expectedOrder);
                    log.info('✅ CSV column order verified by unit test.');
                } catch (err) {
                    log.error(`Error while writing CSV or validating column order: ${err.message}`);
                    logMismatch('CSV generation or column order validation failed.');
                }
                
                // Log file save
                log.info(`File saved to: ${filePath}`);
                
                // Push data to Apify's Actor output
                await Actor.pushData(reviews);

            }
        }
    }
});

await crawler.run(startUrls);
await Actor.exit();
