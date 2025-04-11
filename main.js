import { Actor } from 'apify';
import { PuppeteerCrawler, log } from 'crawlee';
import puppeteer from 'puppeteer';
import { parse } from 'csv-parse/sync';
import fs from 'fs/promises';

const PRODUCT_LIST_URL = 'https://raw.githubusercontent.com/swiriwon/kwave/main/resource/KWAVE_products_export-sample.csv';

await Actor.init();

// Fetch and parse the product list CSV
const response = await fetch(PRODUCT_LIST_URL);
const csvText = await response.text();
const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true
});

// Extract unique product names from the second column
const productNames = [...new Set(records.map(row => row['2. column2']).filter(Boolean))];

// Prepare output
const scrapedReviews = [];

// Set up PuppeteerCrawler
const crawler = new PuppeteerCrawler({
    async requestHandler({ page, request }) {
        const productName = request.userData.productName;
        log.info(`Searching for: ${productName}`);
        
        // Visit search page
        await page.goto(`https://global.oliveyoung.com/display/search?query=${encodeURIComponent(productName)}`, {
            waitUntil: 'domcontentloaded'
        });

        // Check if no result
        const noResult = await page.$eval('.page_title', el => el.textContent.includes('no search results')).catch(() => false);
        if (noResult) {
            log.warning(`No results found for: ${productName}`);
            return;
        }

        // Find first matched product with ID
        const productLink = await page.$eval('.prd_info a', el => el.getAttribute('href')).catch(() => null);
        if (!productLink || !productLink.includes('prdtNo=')) {
            log.warning(`Product ID not found for: ${productName}`);
            return;
        }

        const productId = productLink.split('prdtNo=')[1];
        const detailUrl = `https://global.oliveyoung.com/product/detail?prdtNo=${productId}`;
        log.info(`Found product ID ${productId} for ${productName}`);

        // Go to detail page
        await page.goto(detailUrl, { waitUntil: 'domcontentloaded' });

        // Simulate fetching reviews
        const reviews = await page.$$eval('.review_list li', nodes =>
            nodes.map(node => ({
                review_title: '',
                review_content: node.querySelector('.review_cont')?.textContent.trim() || '',
                review_rating: node.querySelector('.rating_star .on')?.getAttribute('style')?.match(/\d+/)?.[0] || '',
                review_date: node.querySelector('.date')?.textContent.trim() || '',
                reviewer_name: node.querySelector('.id')?.textContent.trim() || '',
                reviewer_email: '',
                picture_url: node.querySelector('img')?.src || '',
                product_id: '',
                product_link: `https://kwavego.com/products/${productName.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')}`
            }))
        );

        log.info(`Scraped ${reviews.length} reviews for ${productName}`);
        scrapedReviews.push(...reviews);
    },

    async failedRequestHandler({ request }) {
        log.error(`Request ${request.url} failed multiple times.`);
    },

    maxRequestsPerCrawl: productNames.length,
    launchContext: {
        launchOptions: {
            headless: true,
            args: ['--no-sandbox']
        }
    }
});

// Add search requests
for (const productName of productNames) {
    await crawler.addRequests([
        {
            url: `https://global.oliveyoung.com/display/search?query=${encodeURIComponent(productName)}`,
            userData: { productName }
        }
    ]);
}

// Start the crawler
await crawler.run();

// Save to dataset
for (const review of scrapedReviews) {
    await Actor.pushData(review);
}

log.info('Scraping complete. Reviews saved to dataset.');
await Actor.exit();
