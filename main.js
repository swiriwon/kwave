import { Actor } from 'apify';
import { PuppeteerCrawler } from '@crawlee/puppeteer';

await Actor.init();

// Get input from Apify (JSON input from input tab)
const input = await Actor.getInput();
const startUrls = input?.startUrls || [];

const crawler = new PuppeteerCrawler({
    async requestHandler({ page, request }) {
        console.log(`Scraping: ${request.url}`);

        // Wait for reviews section
        await page.waitForSelector('.review_list'); // example selector

        // Extract reviews (modify as needed)
        const reviews = await page.$$eval('.review_list .review_cont', (nodes) =>
            nodes.map((el) => ({
                text: el.innerText,
            }))
        );

        console.log('Extracted Reviews:', reviews);

        // You can also save data
        await Actor.pushData({ url: request.url, reviews });
    },
});

await crawler.run(startUrls);
await Actor.exit();
