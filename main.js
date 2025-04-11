import { Actor } from 'apify';
import { PuppeteerCrawler, log } from '@crawlee/puppeteer';
import fs from 'fs';
import path from 'path';
import { createObjectCsvWriter } from 'csv-writer';

await Actor.init();

const input = await Actor.getInput();
const startUrls = input?.startUrls || [];

const outputFolder = '/home/myuser/app/output/';
if (!fs.existsSync(outputFolder)) {
    log.info(`Creating directory: ${outputFolder}`);
    fs.mkdirSync(outputFolder, { recursive: true });
}

const formattedReviews = [];
const mismatched = [];

const crawler = new PuppeteerCrawler({
    maxRequestRetries: 2,
    requestHandlerTimeoutSecs: 60,
    navigationTimeoutSecs: 60,

    async requestHandler({ request, page, enqueueLinks }) {
        const searchKeyword = request.userData.productName;
        log.info(`Searching for: ${searchKeyword}`);

        if (request.label === 'DETAIL') {
            try {
                await page.waitForSelector('.product-review-unit.isChecked', { timeout: 15000 });

                const reviews = await page.evaluate(() => {
                    const elements = document.querySelectorAll('.product-review-unit.isChecked');
                    return Array.from(elements).slice(0, 10).map(el => {
                        const getText = sel => el.querySelector(sel)?.innerText?.trim() || '';
                        const getImage = () => {
                            const img = el.querySelector('.review-unit-media img');
                            return img ? (img.src.startsWith('/') ? `https://global.oliveyoung.com${img.src}` : img.src) : '';
                        };
                        const stars = () => {
                            const left = el.querySelectorAll('.icon-star.left.filled').length;
                            const right = el.querySelectorAll('.icon-star.right.filled').length;
                            return (left + right) * 0.5;
                        };
                        return {
                            title: getText('.review-unit-tit') || 'Review',
                            body: getText('.review-unit-cont-comment'),
                            rating: stars(),
                            review_date: getText('.review-write-info-date'),
                            reviewer_name: getText('.review-write-info-writer') || 'Anonymous',
                            reviewer_email: '',
                            product_url: window.location.href,
                            picture_urls: getImage(),
                            product_id: '',
                            product_handle: '',
                        };
                    });
                });

                formattedReviews.push(...reviews);
            } catch (err) {
                log.warning(`Failed to get reviews: ${err.message}`);
            }
        } else {
            // Result page search
            const result = await page.evaluate(() => {
                const el = document.querySelector('.prdt-unit a[href*="product/detail?prdtNo="]');
                return el ? el.href : '';
            });

            if (result) {
                await enqueueLinks({ urls: [result], label: 'DETAIL', userData: request.userData });
            } else {
                log.warning(`No match for: ${searchKeyword}`);
                mismatched.push({ productName: searchKeyword });
            }
        }
    }
});

const requests = startUrls.map(({ url }) => ({
    url: `https://global.oliveyoung.com/display/search?query=${encodeURIComponent(url)}`,
    userData: { productName: url },
}));
await crawler.run(requests);

const date = new Date().toISOString().split('T')[0];
const reviewFilePath = path.join(outputFolder, `scraped_reviews_${date}.csv`);
const mismatchFilePath = path.join(outputFolder, `mismatched_products_${date}.csv`);

const csvWriter = createObjectCsvWriter({
    path: reviewFilePath,
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
    ],
});
await csvWriter.writeRecords(formattedReviews);

if (mismatched.length) {
    const mismatchWriter = createObjectCsvWriter({
        path: mismatchFilePath,
        header: [{ id: 'productName', title: 'productName' }],
    });
    await mismatchWriter.writeRecords(mismatched);
}

log.info(`Scraping complete. Reviews saved to: ${reviewFilePath}`);
await Actor.exit();
