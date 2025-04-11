import { Actor } from 'apify';
import { PuppeteerCrawler, log } from '@crawlee/puppeteer';
import { writeFile } from 'fs';
import path from 'path';
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import fetch from 'node-fetch';

await Actor.init();

const PRODUCT_LIST_URL = 'https://raw.githubusercontent.com/swiriwon/kwave/main/resource/KWAVE_products_export-sample.csv';
log.info(`Fetching CSV from: ${PRODUCT_LIST_URL}`);
const response = await fetch(PRODUCT_LIST_URL);
const csvText = await response.text();
const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
});
const productNames = [...new Set(records.map(row => row['title']).filter(Boolean))];
log.info(`Parsed ${productNames.length} unique product names.`);

const startUrls = productNames.map(name => ({
    url: `https://global.oliveyoung.com/display/search?query=${encodeURIComponent(name)}`,
    userData: { label: 'SEARCH', productName: name }
}));

const outputFolder = '/home/myuser/app/output/';
if (!fs.existsSync(outputFolder)) {
    log.info(`Creating directory: ${outputFolder}`);
    fs.mkdirSync(outputFolder, { recursive: true });
}

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
    preNavigationHooks: [
        async (context, gotoOptions) => {
            const { page } = context;
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9',
            });
            gotoOptions.timeout = 90000;
            gotoOptions.waitUntil = 'networkidle2';
        }
    ],
    async requestHandler({ page, request, enqueueLinks }) {
        log.info(`Processing: ${request.url}`);

        if (request.userData.label === 'DETAIL') {
            try {
                await page.waitForSelector('.product-review-unit.isChecked', { timeout: 30000 });
                const reviews = await page.evaluate(() => {
                    const reviewElems = document.querySelectorAll('.product-review-unit.isChecked');
                    return Array.from(reviewElems).slice(0, 10).map(el => {
                        const getText = (selector) => el.querySelector(selector)?.innerText?.trim() || null;
                        const name = getText('.product-review-unit-user-info .review-write-info-writer') || 'Anonymous';
                        const date = getText('.product-review-unit-user-info .review-write-info-date');
                        const text = getText('.review-unit-cont-comment');
                        const option = getText('.review-unit-option span');
                        const image = (() => {
                            const imgEl = el.querySelector('.review-unit-media img');
                            if (!imgEl) return null;
                            return imgEl.src.startsWith('/')
                                ? `https://global.oliveyoung.com${imgEl.src}`
                                : imgEl.src;
                        })();
                        const stars = (() => {
                            const box = el.querySelector('.review-star-rating');
                            const lefts = box?.querySelectorAll('.wrap-icon-star .icon-star.left.filled').length || 0;
                            const rights = box?.querySelectorAll('.wrap-icon-star .icon-star.right.filled').length || 0;
                            return (lefts + rights) * 0.5 || null;
                        })();
                        const features = {};
                        el.querySelectorAll('.list-review-evlt li').forEach(li => {
                            const label = li.querySelector('span')?.innerText?.trim();
                            const count = li.querySelectorAll('.wrap-icon-star .icon-star.filled').length * 0.5;
                            if (label) features[label] = count;
                        });
                        const likeCount = getText('.btn-likey-count');

                        return {
                            id: `review-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                            name,
                            date,
                            text,
                            option,
                            image,
                            stars,
                            features,
                            likeCount,
                            productUrl: window.location.href
                        };
                    }).filter(r => r.text);
                });

                log.info(`Extracted ${reviews.length} reviews`);
                const fileName = `${outputFolder}/scraping_data_${new Date().toISOString().split('T')[0]}.csv`;
                await writeFile(fileName, JSON.stringify(reviews, null, 2), (err) => {
                    if (err) {
                        log.error("Failed to save the file", err);
                    } else {
                        log.info(`File saved to: ${fileName}`);
                    }
                });

                await Actor.pushData(reviews);
            } catch (err) {
                log.error(`Failed to extract reviews: ${err.message}`);
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
                    label: 'DETAIL'
                });
            } else {
                log.warning(`No detail link found for product: ${request.userData.productName}`);
            }
        }
    }
});

await crawler.run(startUrls);
await Actor.exit();
