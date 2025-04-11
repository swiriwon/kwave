import { Actor } from 'apify';
import { PuppeteerCrawler, Dataset, log } from 'crawlee';
import { parse } from 'csv-parse/sync';
import fetch from 'node-fetch';

await Actor.init();

const input = await Actor.getInput();
const PRODUCT_LIST_URL = input.productListUrl;

if (!PRODUCT_LIST_URL) {
    throw new Error('No product list URL provided in input.');
}

log.info(`Fetching CSV from: ${PRODUCT_LIST_URL}`);
const response = await fetch(PRODUCT_LIST_URL);
const csvText = await response.text();

// ✅ Replace column title with correct one if different
const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
});

// 🔧 Use a console log to inspect column names if needed
const firstRow = records[0];
log.info('Column keys in first row:', Object.keys(firstRow));

const productNames = [...new Set(records.map(row => row['title']).filter(Boolean))];
log.info(`Parsed ${productNames.length} unique product names.`);

const startUrls = productNames.map(name => ({
    url: `https://global.oliveyoung.com/display/search?query=${encodeURIComponent(name)}`,
    userData: { searchName: name },
}));

const crawler = new PuppeteerCrawler({
    async requestHandler({ page, request, enqueueLinks }) {
        const { searchName } = request.userData;
        log.info(`Searching for: ${searchName}`);

        const bodyText = await page.content();
        if (bodyText.includes("There are no search results")) {
            log.warning(`No result for: ${searchName}`);
            return;
        }

        const productLinks = await page.$$eval('ul.prd_list_type1 > li > a', links =>
            links.map(link => ({
                title: link.innerText,
                href: link.getAttribute('href'),
            }))
        );

        const match = productLinks.find(p => p.title.includes(searchName));
        if (!match || !match.href) {
            log.warning(`No matching product for: ${searchName}`);
            return;
        }

        const url = new URL(match.href, 'https://global.oliveyoung.com');
        const productId = url.searchParams.get('prdtNo');

        if (!productId) {
            log.warning(`Product ID not found for: ${searchName}`);
            return;
        }

        const productUrl = `https://global.oliveyoung.com/product/detail?prdtNo=${productId}`;
        log.info(`Enqueuing product detail page: ${productUrl}`);

        await request.queue.addRequest({
            url: productUrl,
            userData: { searchName, productId },
            label: 'DETAIL'
        });
    },

    async failedRequestHandler({ request }) {
        log.error(`Failed to process: ${request.url}`);
    },

    requestHandler: async ({ request, page }) => {
        if (request.label !== 'DETAIL') return;

        const { searchName, productId } = request.userData;

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
