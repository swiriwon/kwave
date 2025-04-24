// FILE: kwave/type-search/main.js
import { Actor } from 'apify';
import { PuppeteerCrawler, log } from '@crawlee/puppeteer';
import fs from 'fs';
import path from 'path';

await Actor.init();
const input = await Actor.getInput();

const urls = input.urls;
if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error('Input must include a "urls" array.');
}

log.info('Starting scraper...');

const outputFolder = '/home/myuser/app/output/';
if (!fs.existsSync(outputFolder)) {
    log.info(`Creating directory: ${outputFolder}`);
    fs.mkdirSync(outputFolder, { recursive: true });
}

const outputFile = path.join(outputFolder, 'type_search_results.csv');

const crawler = new PuppeteerCrawler({
    maxRequestRetries: 2,
    requestHandlerTimeoutSecs: 120,
    launchContext: {
        launchOptions: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    },
    async requestHandler({ page, request, enqueueLinks }) {
        const allResults = [];

        while (true) {
            const items = await page.$$eval('.prd_info .brand-info', elements => {
                return elements.map(el => {
                    const brand = el.querySelector('dt')?.innerText?.trim() || '';
                    const name = el.querySelector('dd')?.innerText?.trim() || '';
                    return { brand, name };
                });
            });

            allResults.push(...items);

            const hasMore = await page.$('.btnMore');
            if (!hasMore) break;
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle0' }),
                page.click('.btnMore')
            ]);
        }

        log.info(`Extracted ${allResults.length} products from: ${request.url}`);

        // Save to file and Apify dataset
        const rows = allResults.map(r => `${r.brand},${r.name}`).join('\n');
        const header = 'brand,product_name';
        const content = `${header}\n${rows}`;

        fs.writeFileSync(outputFile, content);
        await Actor.pushData(allResults);

        log.info(`Saved file to: ${outputFile}`);
    }
});

const startUrls = urls.map(url => ({ url, userData: { label: 'CATEGORY' } }));
await crawler.run(startUrls);
await Actor.exit();
