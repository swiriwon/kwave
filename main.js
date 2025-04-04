
const { Actor } = require('apify');
const { PuppeteerCrawler } = require('@crawlee/puppeteer');
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const slugify = require('slugify');

Actor.main(async () => {
    const input = await Actor.getInput();
    const searchTerm = input?.searchTerm?.trim();
    const productHandle = input?.productHandle?.trim();
    const shopDomain = input?.shopDomain?.trim().replace(/\/$/, '');

    if (!searchTerm || !productHandle || !shopDomain) {
        throw new Error('Missing input: searchTerm, productHandle, and shopDomain are required.');
    }

    const reviews = [];
    const searchUrl = `https://global.oliveyoung.com/display/search?query=${encodeURIComponent(searchTerm)}`;

    const crawler = new PuppeteerCrawler({
        async requestHandler({ page, request }) {
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('.prdt-unit', { timeout: 15000 });

            const productDetailUrl = await page.$$eval('.prdt-unit', (products, searchTerm) => {
                for (const product of products) {
                    const nameInput = product.querySelector('input[name="prdtName"]');
                    const prdtNoInput = product.querySelector('input[name="prdtNo"]');
                    if (nameInput && prdtNoInput && nameInput.value.trim().toLowerCase() === searchTerm.toLowerCase()) {
                        return `/product/detail?prdtNo=${prdtNoInput.value}&dataSource=search_result`;
                    }
                }
                return null;
            }, searchTerm);

            if (!productDetailUrl) {
                console.warn('No matching product found');
                return;
            }

            const fullProductUrl = `https://global.oliveyoung.com${productDetailUrl}`;
            await page.goto(fullProductUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('.product-review-unit.isChecked', { timeout: 15000 });

            const extractedReviews = await page.$$eval('.product-review-unit.isChecked', (nodes) =>
                nodes.slice(0, 10).map((el) => {
                    const title = '';
                    const body = el.querySelector('.review-cont > p')?.innerText?.trim() || '';
                    const reviewer = el.querySelector('.name')?.innerText?.trim() || '';
                    const nameStub = reviewer.replace(/\*/g, '');
                    const fakeName = nameStub.padEnd(5, 'a').slice(0, 5).replace(/^./, m => m.toUpperCase());

                    const stars = el.querySelectorAll('.wrap-icon-star .icon-star.coral-50.right.filled').length;
                    const rating = stars || 5;
                    const reviewDate = el.querySelector('.date')?.innerText?.trim() || '';
                    const imageUrls = Array.from(el.querySelectorAll('.review-thumb-list img')).map(img => img.src).join(', ');

                    return {
                        title: title,
                        body: body,
                        rating: rating,
                        review_date: reviewDate,
                        reviewer_name: fakeName,
                        reviewer_email: '',
                        product_url: `${shopDomain}/products/${productHandle}`,
                        picture_urls: imageUrls,
                        product_id: '',
                        product_handle: productHandle,
                    };
                })
            );

            reviews.push(...extractedReviews);
        }
    });

    await crawler.run([{ url: searchUrl }]);

    const csvWriter = createCsvWriter({
        path: '/mnt/data/JUDGEME_OUTPUT.csv',
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

    await csvWriter.writeRecords(reviews);
});
