const { Actor } = require('apify');
const { PuppeteerCrawler } = require('@crawlee/puppeteer');

Actor.main(async () => {
    const input = await Actor.getInput();
    const startUrls = input?.startUrls || [];

    const crawler = new PuppeteerCrawler({
        async requestHandler({ page, request }) {
            console.log(`Scraping: ${request.url}`);

            await page.waitForSelector('.list-product-review-unit', { visible: true });
            await page.waitForFunction(() => document.readyState === 'complete');
            
            // Scroll a bit to trigger rendering (helps with lazy-loaded content)
            await page.evaluate(() => {
                window.scrollBy(0, window.innerHeight);
            });
            import { setTimeout } from 'node:timers/promises';
            // Pause execution for 3 seconds
            await setTimeout(3000);

            const reviews = await page.$$eval('.list-product-review-unit', (elements) => {
                return elements.slice(0, 10).map((el) => {
                    const name = el.querySelector('.review-write-info-writer')?.innerText?.trim() || null;
                    const date = el.querySelector('.review-write-info-date')?.innerText?.trim() || null;
                    const text = el.querySelector('.review-unit-cont-comment')?.innerText?.trim() || null;
                    const image = el.querySelector('.review-unit-media img')?.src || null;

                    // Count the number of filled stars only inside this review
                    const stars = el.querySelectorAll('.icon-star.filled').length;

                    return { name, date, stars, text, image };
                }).filter(r => r.text); // Filter out empty reviews
            });

            console.log('Extracted Reviews:', reviews);
            await Actor.pushData(reviews);
        },
    });

    await crawler.run(startUrls);
});
