import { Actor } from 'apify';
import { PuppeteerCrawler, log } from '@crawlee/puppeteer';
import fs from 'fs';
import path from 'path';
import { createObjectCsvWriter } from 'csv-writer';

await Actor.init();

const input = await Actor.getInput();
const startUrls = input?.startUrls || [];

const outputFolder = '/home/myuser/app/output';
if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder, { recursive: true });
}

const outputFilename = `scraping_data_${new Date().toISOString().split('T')[0]}.csv`;
const filePath = path.join(outputFolder, outputFilename);

const csvWriter = createObjectCsvWriter({
    path: filePath,
    header: [
        { id: 'title', title: 'title' },
        { id: 'body', title: 'body' },
        { id: 'rating', title: 'rating' },
        { id: 'review_date', title: 'review_date' },
        { id: 'reviewer_name', title: 'reviewer_name' },
        { id: 'reviewer_email', title: 'reviewer_email' },
        { id: 'product_url', title: 'product_url' },
        { id: 'picture_urls', title: 'picture_urls' },
        { id: 'product_id', title: 'product_id' },
        { id: 'product_handle', title: 'product_handle' },
    ]
});

const mismatchedNames = [];

const crawler = new PuppeteerCrawler({
    maxRequestRetries: 2,
    requestHandlerTimeoutSecs: 90,
    navigationTimeoutSecs: 60,

    launchContext: {
        launchOptions: {
            headless: true,
            args: ['--no-sandbox', '--disable-gpu']
        }
    },

    async requestHandler({ request, page, enqueueLinks }) {
        const productName = request.userData.productName || '';
        const handle = request.userData.handle || '';
        log.info(`Searching for product: ${productName}`);

        if (request.label === 'SEARCH') {
            const noResults = await page.$eval('.search-no-result', el => el.textContent.includes('There are no search results')).catch(() => false);
            if (noResults) {
                mismatchedNames.push({ productName, handle });
                return;
            }

            const productUrl = await page.evaluate(() => {
                const link = document.querySelector('.prdt-unit a[href*="/product/detail?prdtNo="]');
                return link ? link.href : null;
            });

            if (productUrl) {
                await enqueueLinks({
                    urls: [productUrl],
                    label: 'DETAIL',
                    userData: { productName, handle }
                });
            } else {
                mismatchedNames.push({ productName, handle });
            }

        } else if (request.label === 'DETAIL') {
            try {
                await page.waitForSelector('.product-review-unit.isChecked', { timeout: 30000 });

                const productUrl = page.url();
                const productIdMatch = productUrl.match(/prdtNo=(\w+)/);
                const productId = productIdMatch ? productIdMatch[1] : '';

                const reviews = await page.evaluate(() => {
                    return [...document.querySelectorAll('.product-review-unit.isChecked')].map(el => {
                        const text = el.querySelector('.review-unit-cont-comment')?.innerText?.trim() || '';
                        const rating = (el.querySelectorAll('.wrap-icon-star .icon-star.filled')?.length || 0) * 0.5;
                        const date = el.querySelector('.review-write-info-date')?.innerText?.trim() || '';
                        const name = el.querySelector('.review-write-info-writer')?.innerText?.trim() || 'Anonymous';
                        const image = el.querySelector('.review-unit-media img')?.src || '';

                        return { text, rating, date, name, image };
                    });
                });

                const formatted = reviews.map(r => ({
                    title: request.userData.productName,
                    body: r.text,
                    rating: r.rating,
                    review_date: r.date,
                    reviewer_name: r.name,
                    reviewer_email: '',
                    product_url: `https://kwave.ai/products/${request.userData.handle}`,
                    picture_urls: r.image,
                    product_id: productId,
                    product_handle: request.userData.handle,
                }));

                await csvWriter.writeRecords(formatted);
                await Actor.pushData(formatted);
            } catch (err) {
                log.error(`Error extracting detail: ${err.message}`);
            }
        }
    }
});

const initialRequests = startUrls.map(item => ({
    url: item.url,
    label: 'SEARCH',
    userData: {
        productName: item.productName,
        handle: item.handle
    }
}));

await crawler.run(initialRequests);

// Save mismatched names to a separate log
const mismatchedPath = path.join(outputFolder, `mismatched_${new Date().toISOString().split('T')[0]}.json`);
fs.writeFileSync(mismatchedPath, JSON.stringify(mismatchedNames, null, 2));
log.info(`Saved mismatched names to: ${mismatchedPath}`);

await Actor.exit();
