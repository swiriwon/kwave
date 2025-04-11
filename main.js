import { Actor } from 'apify';
import { PuppeteerCrawler, log } from '@crawlee/puppeteer';
import { Parser } from 'json2csv';
import path from 'path';
import fs from 'fs';
const mismatchLogPath = '/home/myuser/app/output/mismatches.log';

function logMismatch(message) {
    fs.appendFileSync(mismatchLogPath, `${new Date().toISOString()} - ${message}\n`);
}
import fetch from 'node-fetch';
import { parse as csvParse } from 'csv-parse/sync';

await Actor.init();

const input = await Actor.getInput();
const PRODUCT_LIST_URL = input.productListUrl;

log.info('Starting scraper...');

// Define output folder path
const outputFolder = '/home/myuser/app/output/';
if (!fs.existsSync(outputFolder)) {
    log.info(`Creating directory: ${outputFolder}`);
    fs.mkdirSync(outputFolder, { recursive: true });
}

// Fetch and parse product list
log.info(`Fetching CSV from: ${PRODUCT_LIST_URL}`);
const response = await fetch(PRODUCT_LIST_URL);
const csvText = await response.text();
const records = csvParse(csvText, {
    columns: true,
    skip_empty_lines: true,
});
log.info(`CSV column headers: ${Object.keys(records[0]).join(', ')}`);

const productNames = [...new Set(records.map(r => r['Title']).filter(Boolean))];
log.info(`Parsed ${productNames.length} unique product names.`);

const startUrls = productNames.map(name => ({
    url: `https://global.oliveyoung.com/display/search?query=${encodeURIComponent(name)}`,
    userData: { label: 'SEARCH', productName: name }
}));

const FAKE_NAMES = [
    'Alice', 'Brian', 'Cara', 'Daniel', 'Ella', 'Frank', 'Grace', 'Hugo', 'Isla', 'Jack',
    'Katie', 'Leo', 'Maya', 'Noah', 'Olivia', 'Paul', 'Quinn', 'Rose', 'Sam', 'Tina',
    'Uma', 'Victor', 'Wendy', 'Xander', 'Yara', 'Zane', 'Anna', 'Ben', 'Chloe', 'Dylan',
    'Eva', 'Finn', 'Gina', 'Harry', 'Ivy', 'James', 'Kara', 'Liam', 'Mila', 'Nate',
    'Oscar', 'Pia', 'Riley', 'Sophie', 'Tom', 'Ursula', 'Vera', 'Will', 'Xena', 'Yuri',
    'Zoe', 'Amber', 'Blake', 'Cleo', 'Derek', 'Eliza', 'Felix', 'Gwen', 'Heidi', 'Ian'
];

const crawler = new PuppeteerCrawler({
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 120,
    navigationTimeoutSecs: 90,
    launchContext: {
        launchOptions: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--window-size=1280,1024',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
            ]
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
                const productName = request.url.split('query=')[1]?.replace(/%20/g, ' ');
                log.warning('No detail link found for product: ' + productName);
                logMismatch(`No product detail found for: ${productName}`);
            }
        }

        if (label === 'DETAIL') {
            try {
                await page.waitForSelector('.product-review-unit.isChecked', { timeout: 30000 });
                const reviews = await page.evaluate(({ productName, FAKE_NAMES }) => {
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
                        .replace(/\s*\/\s*/g, '-')  // replace space-slash-space with dash
                        .replace(/[()/]/g, '')      // remove parentheses and slashes
                        .replace(/\s+/g, '-')       // replace space with dash
                        .replace(/-+/g, '-');       // remove multiple dashes

                    return Array.from(reviewElems).slice(0, 10).map(el => {
                        const getText = (selector) => el.querySelector(selector)?.innerText?.trim() || null;

                        const nameRaw = getText('.product-review-unit-user-info .review-write-info-writer');
                        const name = nameRaw?.replace(/^by\.\s*/, '')?.includes('*') ? generateName() : nameRaw;

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
                            picture_urls: '',
                            product_id: '',
                            product_handle: ''
                        };
                    }).filter(r => r.body);
                }, { productName, FAKE_NAMES });

                log.info(`Extracted ${reviews.length} reviews`);

                const fields = ['title', 'body', 'rating', 'review_date', 'reviewer_name', 'reviewer_email', 'product_url', 'picture_urls', 'product_id', 'product_handle'];
                const parser = new Parser({ fields });
                const csv = parser.parse(reviews);
                const filePath = path.join(outputFolder, `scraping_data_${new Date().toISOString().split('T')[0]}.csv`);
                fs.writeFileSync(filePath, csv);
                log.info(`File saved to: ${filePath}`);
                await Actor.pushData(reviews);
            } catch (err) {
                log.error(`Error scraping reviews: ${err.message}`);
            }
        }
    }
});

await crawler.run(startUrls);
await Actor.exit();
