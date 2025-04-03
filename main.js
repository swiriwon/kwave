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

            // Scroll multiple times to try loading more reviews
            for (let i = 0; i < 5; i++) {
                await page.evaluate(() => window.scrollBy(0, window.innerHeight));
                await setTimeout(1500);
            }

            const reviews = await page.$$eval('.list-product-review-unit', (elements) => {
                return elements.slice(0, 10).map((el) => {
                    const name = el.querySelector('.review-write-info-writer')?.innerText?.trim() || null;
                    const date = el.querySelector('.review-write-info-date')?.innerText?.trim() || null;
                    const text = el.querySelector('.review-unit-cont-comment')?.innerText?.trim() || null;
                    const image = el.querySelector('.review-unit-media img')?.getAttribute('src') || null;

                    // Extract width from style="width: 94%" to calculate star rating
                    const starEl = el.querySelector('.review-product-star-rating span[style*="width"]');
                    let stars = null;
                    if (starEl) {
                        const match = starEl.style.width.match(/([\d.]+)%/);
                        if (match) {
                            const widthNum = parseFloat(match[1]);
                            stars = Math.round((widthNum / 100) * 5 * 10) / 10;
                        }
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
