import { Actor } from 'apify';
import { PuppeteerCrawler, Dataset, log } from 'crawlee';
import { parse } from 'csv-parse/sync';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

await Actor.init();

const input = await Actor.getInput();
const PRODUCT_LIST_URL = input.productListUrl;

if (!PRODUCT_LIST_URL) {
    throw new Error('No product list URL provided in input.');
}

log.info(`Fetching CSV from: ${PRODUCT_LIST_URL}`);
const response = await fetch(PRODUCT_LIST_URL);
const csvText = await response.text();
const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
});

const productNames = [...new Set(records.map(row => row['2. column 2']).filter(Boolean))];
log.info(`Parsed ${productNames.length} unique product names.`);

const startUrls = productNames.map(name => ({
    url: `https://global.oliveyoung.com/display/search?query=${encodeURIComponent(name)}`,
    userData: { searchName: name },
}));

const crawler = new PuppeteerCrawler({
    async requestHandler({ page, request, enqueueLinks }) {
        const { searchName } = request.userData;
        log.info(`Searching for: ${searchName}`);

        const noResult = await page.$eval('body', el => el.innerText.includes("There are no search results"));
        if (noResult) {
            log.warning(`No result for: ${searchName}`);
            return;
        }

        const productLinks = await page.$$eval('ul.prd_list_type1 > li > a', (links) =>
            links.map(link => ({
                title: link.innerText,
                href: link.getAttribute('href'),
            }))
        );

        const matchingLink = productLinks.find(p => p.title.includes(searchName));
        if (!matchingLink || !matchingLink.href) {
            log.warning(`No matching link found for: ${searchName}`);
            return;
        }

        const url = new URL(matchingLink.href, 'https://global.oliveyoung.com');
        const productId = url.searchParams.get('prdtNo');

        if (!productId) {
            log.warning(`No product ID found for: ${searchName}`);
            return;
        }

        const productUrl = `https://global.oliveyoung.com/product/detail?prdtNo=${productId}`;
        log.info(`Enqueuing product page: ${productUrl}`);
        await request.queue.addRequest({ url: productUrl, userData: { productId, searchName }, label: 'DETAIL' });
    },

    async requestHandlerTimeout({ page, request }) {
        log.warning(`Request timed out: ${request.url}`);
    },

    async requestHandlerFailed({ request }) {
        log.warning(`Request failed: ${request.url}`);
    },

    async failedRequestHandler({ request }) {
        log.error(`Failed after retries: ${request.url}`);
    },

    requestHandler: async ({ request, page }) => {
        if (request.label !== 'DETAIL') return;

        const { productId, searchName } = request.userData;

        const reviews = await page.$$eval('.review_list ul li', nodes => {
            return nodes.map((el, i) => ({
                id: `${productId}-${i + 1}`,
                title: el.querySelector('.review_tit')?.innerText || '',
                body: el.querySelector('.review_txt')?.innerText || '',
                rating: el.querySelector('.rating span')?.innerText || '',
                author: el.querySelector('.id')?.innerText || '',
                created_at: el.querySelector('.date')?.innerText || '',
                picture_url: el.querySelector('img')?.src || '',
            }));
        });

        for (const review of reviews) {
            await Dataset.pushData({
                reviewer_name: review.author,
                reviewer_email: '',
                rating: review.rating,
                title: review.title,
                body: review.body,
                picture_url: review.picture_url,
                product_id: '',
                created_at: review.created_at,
                url: `https://kwave.kr/products/${searchName.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')}`,
            });
        }

        log.info(`Scraped ${reviews.length} reviews for: ${searchName}`);
    },
});

await crawler.run(startUrls);

log.info('Scraping complete. Reviews saved to dataset.');
await Actor.exit();
