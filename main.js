const { Actor } = require('apify');
const { PuppeteerCrawler } = require('@crawlee/puppeteer');

Actor.main(async () => {
    const input = await Actor.getInput();
    const startUrls = input?.startUrls || [];

    const crawler = new PuppeteerCrawler({
        async requestHandler({ page, request }) {
            console.log(`Scraping: ${request.url}`);

            await page.waitForSelector('.list-product-review-unit', { timeout: 60000 });

            const reviews = await page.$$eval('.review_list .review_cont', (nodes) =>
                nodes.map((el) => ({
                    text: el.innerText,
                }))
            );

            console.log('Extracted Reviews:', reviews);
            await Actor.pushData({ url: request.url, reviews });
        },
    });

    await crawler.run(startUrls);
});
