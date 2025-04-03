const { Actor } = require('apify');
const { PuppeteerCrawler } = require('@crawlee/puppeteer');

Actor.main(async () => {
    const input = await Actor.getInput();
    const startUrls = input?.startUrls || [];

    const crawler = new PuppeteerCrawler({
        async requestHandler({ page, request }) {
            console.log(`Scraping: ${request.url}`);

            await page.waitForSelector('.list-product-review-unit', { timeout: 60000 });
            await new Promise(resolve => setTimeout(resolve, 2000));

            const reviews = await page.$$eval('.list-product-review-unit', (elements) => {
                return elements.map((el) => {
                    const text = el.querySelector('.review-unit-cont-comment')?.innerText?.trim() || null;
                    const name = el.querySelector('.review-write-info-writer')?.innerText?.trim() || null;
                    const date = el.querySelector('.review-write-info-date')?.innerText?.trim() || null;
                    const stars = el.querySelectorAll('.product-review-unit-header .icon-star.filled').length;
                    const image = el.querySelector('img')?.src || null;

                    return { name, date, stars, text, image };
                }).filter(r => r.text);
            });

            console.log('Extracted Reviews:', reviews);
            await Actor.pushData(reviews);

        },
    });

    await crawler.run(startUrls);
});
