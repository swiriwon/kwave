const { Actor } = require('apify');
const { PuppeteerCrawler, Dataset, log } = require('crawlee');
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const slugify = require('slugify');
const path = require('path');

(async () => {
    await Actor.init();
    const input = await Actor.getInput();

    const { searchTerm, productHandle, shopDomain } = input;
    const productUrl = `${shopDomain}/products/${productHandle}`;
    const searchUrl = `https://global.oliveyoung.com/display/search?query=${encodeURIComponent(searchTerm)}`;

    const results = [];

    const crawler = new PuppeteerCrawler({
        requestHandler: async ({ page, request }) => {
            log.info(`Processing: ${request.url}`);

            await page.waitForSelector('ul#productUl2 li.prdt-unit input[name="prdtNo"]', { timeout: 15000 });

            const productId = await page.$$eval('ul#productUl2 li.prdt-unit', items => {
                const first = items[0];
                if (!first) return null;
                return first.querySelector('input[name="prdtNo"]')?.value;
            });

            if (!productId) {
                log.warning('No matching product found');
                return;
            }

            const detailUrl = `https://global.oliveyoung.com/product/detail?prdtNo=${productId}&dataSource=search_result`;
            log.info(`Navigating to detail page: ${detailUrl}`);
            await page.goto(detailUrl, { waitUntil: 'domcontentloaded' });

            await page.waitForSelector('.review-section-container', { timeout: 20000 });
            const reviews = await page.$$eval('.product-review-unit.isChecked', items => {
                return items.slice(0, 10).map(el => {
                    const text = el.querySelector('.txt-review')?.innerText?.trim() || '';
                    const date = el.querySelector('.date')?.innerText?.trim() || '';
                    let name = el.querySelector('.info-user')?.innerText?.trim() || '';
                    const starIcons = el.querySelectorAll('.wrap-icon-star .icon-star.coral-50.left.filled');
                    const rating = starIcons.length;

                    if (name.includes('*')) {
                        const revealed = name.replace(/\*/g, '');
                        name = revealed + 'ia';
                    }

                    return {
                        title: '',
                        body: text,
                        rating,
                        review_date: date,
                        reviewer_name: name,
                        reviewer_email: '',
                        product_url: '',
                        picture_urls: '',
                        product_id: '',
                        product_handle: '',
                    };
                });
            });

            reviews.forEach(r => {
                r.product_url = productUrl;
                r.product_handle = productHandle;
            });

            results.push(...reviews);
        },
        maxRequestsPerCrawl: 1,
    });

    await crawler.run([{ url: searchUrl }]);

    const dirPath = '/mnt/data';
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

    const csvWriter = createCsvWriter({
        path: path.join(dirPath, 'JUDGEME_OUTPUT.csv'),
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

    await csvWriter.writeRecords(results);
    log.info('✅ Reviews saved to JUDGEME_OUTPUT.csv');
    await Actor.exit();
})();
