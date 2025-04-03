const { Actor } = require('apify');
const { PuppeteerCrawler } = require('@crawlee/puppeteer');
const { setTimeout } = require('node:timers/promises');

Actor.main(async () => {
    const input = await Actor.getInput();
    const startUrls = input?.startUrls || [];

    const crawler = new PuppeteerCrawler({
        async requestHandler({ page, request }) {
            console.log(`Scraping: ${request.url}`);

            // Wait for the review container to be visible
            await page.waitForSelector('.list-product-review-unit', { visible: true, timeout: 60000 });

            // Optional: Scroll to bottom to trigger full review load
            await page.evaluate(() => {
                window.scrollBy(0, window.innerHeight);
            });

            // Pause execution for 3 seconds to allow content to load
            await setTimeout(3000);

            const reviews = await page.$$eval('.list-product-review-unit', (elements) => {
                return elements.slice(0, 10).map((el) => {
                    const name = el.querySelector('.review-write-info-writer')?.innerText?.trim() || null;
                    const date = el.querySelector('.review-write-info-date')?.innerText?.trim() || null;
                    const text = el.querySelector('.review-unit-cont-comment')?.innerText?.trim() || null;
                    const image = el.querySelector('.review-unit-media img')?.src || null;

                    // Extract width from style, e.g., "width: 94%"
                   const starBar = el.querySelector('.product-review-unit-header .icon-star');
                    let stars = null;

                    if (starBar && starBar.style?.width) {
                    const widthStr = starBar.style.width.replace('%', '');
                    const widthNum = parseFloat(widthStr);
                    stars = Math.round((widthNum / 20) * 10) / 10; // 100% width = 5 stars
                }

                    return { name, date, stars, text, image };
                }).filter(r => r.text);
            });

            console.log('Extracted Reviews:', reviews);
            await Actor.pushData(reviews);
        },
    });

    await crawler.run(startUrls);
});
