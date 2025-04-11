import { Actor } from 'apify';
import { PuppeteerCrawler, log } from '@crawlee/puppeteer';
import { writeFileSync } from 'fs';
import path from 'path';
import fs from 'fs';

await Actor.init();

const input = await Actor.getInput();
const startUrls = input?.startUrls || [];

log.info('Starting scraper...');

const outputFolder = '/home/myuser/app/output/';
if (!fs.existsSync(outputFolder)) {
    log.info(`Creating directory: ${outputFolder}`);
    fs.mkdirSync(outputFolder, { recursive: true });
} else {
    log.info(`Directory exists: ${outputFolder}`);
}

const crawler = new PuppeteerCrawler({
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 120,
    navigationTimeoutSecs: 90,

    launchContext: {
        launchOptions: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--window-size=1280,1024',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
            ]
        }
    },

    preNavigationHooks: [
        async (context, gotoOptions) => {
            const { page } = context;
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9',
            });
            gotoOptions.timeout = 90000;
            gotoOptions.waitUntil = 'networkidle2';
        }
    ],

    async requestHandler({ page, request, enqueueLinks }) {
        log.info(`Processing: ${request.url}`);

        if (request.label === 'DETAIL') {
            try {
                await page.waitForSelector('.product-review-unit.isChecked', { timeout: 30000 });

                const reviews = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('.product-review-unit.isChecked')).slice(0, 10).map(el => {
                        const getText = (sel) => el.querySelector(sel)?.innerText?.trim() || null;
                        const name = getText('.product-review-unit-user-info .review-write-info-writer') || 'Anonymous';
                        const date = getText('.product-review-unit-user-info .review-write-info-date');
                        const text = getText('.review-unit-cont-comment');
                        const stars = el.querySelectorAll('.wrap-icon-star .icon-star.filled').length * 0.5;
                        return { name, date, text, stars };
                    }).filter(r => r.text);
                });

                const productUrl = request.url;
                const productHandle = request.url.split('query=')[1]?.toLowerCase().replace(/\s+/g, '-') || 'unknown';

                const formatted = reviews.map(r => ({
                    title: '',
                    body: r.text,
                    rating: r.stars,
                    review_date: r.date,
                    reviewer_name: r.name.replace(/\*+/, 'a'),
                    reviewer_email: '',
                    product_url: productUrl,
                    product_id: '',
                    product_handle: productHandle
                }));

                const csvHeader = "title,body,rating,review_date,reviewer_name,reviewer_email,product_url,product_id,product_handle\n";
                const csvRows = formatted.map(row =>
                    `"${row.title}","${row.body.replace(/"/g, '""')}","${row.rating}","${row.review_date}","${row.reviewer_name}","${row.reviewer_email}","${row.product_url}","${row.product_id}","${row.product_handle}"`
                );

                const fileName = `${outputFolder}/scraping_data_${new Date().toISOString().split('T')[0]}.csv`;
                const csvData = csvHeader + csvRows.join("\n");
                writeFileSync(fileName, csvData);

                log.info(`File saved to: ${fileName}`);
                await Actor.pushData(formatted);
            } catch (err) {
                log.error(`Failed to extract reviews: ${err.message}`);
            }
        } else {
            const productUrl = await page.evaluate(() => {
                const linkEl = document.querySelector('.prdt-unit a[href*="/product/detail?prdtNo="]');
                return linkEl ? linkEl.href : null;
            });

            if (productUrl) {
                log.info(`Found product detail link. Enqueuing...`);
                await enqueueLinks({
                    urls: [productUrl],
                    label: 'DETAIL'
                });
            } else {
                log.warning('No product detail link found on search page.');
            }
        }
    }
});

await crawler.run(startUrls);
await Actor.exit();
