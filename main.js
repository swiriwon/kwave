import { Actor } from 'apify';
import { PuppeteerCrawler, Dataset, log } from '@crawlee/puppeteer';
import fs from 'fs/promises';
import path from 'path';

await Actor.init();

const input = await Actor.getInput();
const products = input?.products || [];

const mismatched = [];
const results = [];

const crawler = new PuppeteerCrawler({
    maxConcurrency: 1,
    requestHandlerTimeoutSecs: 60,

    async requestHandler({ page, request, enqueueLinks }) {
        const { userData } = request;

        if (userData.label === 'DETAIL') {
            // Extract reviews
            try {
                await page.waitForSelector('.product-review-unit.isChecked', { timeout: 30000 });

                const reviews = await page.evaluate((productUrl, productHandle) => {
                    return Array.from(document.querySelectorAll('.product-review-unit.isChecked')).map((el) => {
                        const getText = (selector) => el.querySelector(selector)?.innerText?.trim() || '';
                        const stars = el.querySelectorAll('.wrap-icon-star .icon-star.filled').length * 0.5;
                        const imageEl = el.querySelector('.review-unit-media img');
                        const imageUrl = imageEl?.src?.startsWith('/') ? `https://global.oliveyoung.com${imageEl.src}` : imageEl?.src;

                        return {
                            title: getText('.review-unit-option span') || productHandle.replace(/-/g, ' '),
                            body: getText('.review-unit-cont-comment'),
                            rating: stars || '',
                            review_date: getText('.review-write-info-date'),
                            reviewer_name: getText('.review-write-info-writer') || 'Anonymous',
                            reviewer_email: '',
                            product_url: `https://kwave.ai/products/${productHandle}`,
                            picture_urls: imageUrl || '',
                            product_id: '',
                            product_handle: productHandle
                        };
                    });
                }, request.userData.originalUrl, request.userData.productHandle);

                if (reviews.length > 0) {
                    await Dataset.pushData(reviews);
                    results.push(...reviews);
                }
            } catch (err) {
                log.error(`Failed to extract reviews from ${request.url}: ${err.message}`);
            }
        } else {
            // Search for product and find detail link
            const productName = userData.productName;
            const searchFound = await page.evaluate(() => {
                const message = document.querySelector('.search-no-result');
                return !message;
            });

            if (!searchFound) {
                mismatched.push(productName);
                return;
            }

            const detail = await page.evaluate(() => {
                const product = document.querySelector('.prd_info a');
                const url = product?.href;
                const match = url?.match(/prdtNo=([^&]+)/);
                return match ? match[1] : null;
            });

            if (detail) {
                const productHandle = productName.toLowerCase().replace(/\s+/g, '-');
                const detailUrl = `https://global.oliveyoung.com/product/detail?prdtNo=${detail}`;
                await enqueueLinks({
                    urls: [detailUrl],
                    label: 'DETAIL',
                    userData: {
                        label: 'DETAIL',
                        productHandle,
                        originalUrl: productName
                    }
                });
            } else {
                mismatched.push(productName);
            }
        }
    },
});

await crawler.run(products.map(name => ({
    url: `https://global.oliveyoung.com/display/search?query=${encodeURIComponent(name)}`,
    userData: { label: 'SEARCH', productName: name }
})));

// Save mismatched products
if (mismatched.length > 0) {
    const text = mismatched.join('\n');
    await fs.writeFile(path.join('output', 'mismatched.txt'), text, 'utf8');
}

await Actor.exit();
