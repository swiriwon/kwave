// kwave/type-search/main.js
import { Actor } from 'apify';
import { PuppeteerCrawler, log } from '@crawlee/puppeteer';

await Actor.init();
const input = await Actor.getInput();
const startUrls = input.startUrls || [];

log.info('Starting type-search crawler...');

const crawler = new PuppeteerCrawler({
    maxConcurrency: 5,
    requestHandlerTimeoutSecs: 120,
    launchContext: {
        launchOptions: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
    },
    async requestHandler({ page, request, enqueueLinks }) {
        log.info(`Processing: ${request.url}`);

        // Click "MORE" until hidden
        while (await page.$eval('#moreBtnWrap', el => el.style.display !== 'none').catch(() => false)) {
            log.info('Clicking MORE...');
            await Promise.all([
                page.click('#moreBtnWrap button'),
                page.waitForTimeout(2000),
            ]);
        }

        const items = await page.evaluate(() => {
            const data = [];
            document.querySelectorAll('.prd-list li').forEach(item => {
                const brand = item.querySelector('.brand-info dt')?.innerText?.trim();
                const name = item.querySelector('.brand-info dd')?.innerText?.trim();
                const url = item.querySelector('a')?.href?.trim();

                if (brand && name && url) {
                    data.push({ brand, name, url });
                }
            });
            return data;
        });

        log.info(`Found ${items.length} products.`);
        for (const item of items) {
            await Actor.pushData(item);
        }
    },
});

await crawler.run(startUrls);
await Actor.exit();
