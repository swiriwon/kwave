import { Actor } from 'apify';
import { PuppeteerCrawler, log } from '@crawlee/puppeteer';

await Actor.init();

const input = await Actor.getInput();
const urls = input?.urls || [];
if (!urls.length) throw new Error('No URLs provided in input!');

const crawler = new PuppeteerCrawler({
    maxConcurrency: 1,
    requestHandlerTimeoutSecs: 180,
    async requestHandler({ page, request }) {
        log.info(`Scraping: ${request.url}`);

        // Click "MORE" until all products are loaded
        let loadMore = true;
        while (loadMore) {
            loadMore = await page.evaluate(() => {
                const moreBtn = document.querySelector('.btn-more');
                if (moreBtn && !moreBtn.classList.contains('disabled')) {
                    moreBtn.click();
                    return true;
                }
                return false;
            });
            if (loadMore) await page.waitForTimeout(2000);
        }

        // Extract brand and product name
        const products = await page.$$eval('.brand-info', elements => {
            return elements.map(el => {
                const brand = el.querySelector('dt')?.innerText.trim();
                const product = el.querySelector('dd')?.innerText.trim();
                return { brand, product };
            });
        });

        for (const item of products) {
            await Actor.pushData(item);
        }
    },
});

await crawler.run(urls.map(url => ({ url })));
await Actor.exit();
