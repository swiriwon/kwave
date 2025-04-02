import { Actor } from 'apify';
import { PuppeteerCrawler } from '@crawlee/puppeteer';

await Actor.init();

// ⬇️ Get input data from Apify
const input = await Actor.getInput();
const startUrls = input?.startUrls || [];

const crawler = new PuppeteerCrawler({
    async requestHandler({ page, request }) {
        console.log(`Scraping: ${request.url}`);
        // your scraping logic
    },
});

// ⬇️ Add requests using valid format
await crawler.run(startUrls);
await Actor.exit();
