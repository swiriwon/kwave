const { Actor } = require('apify');
const { PuppeteerCrawler, log } = require('@crawlee/puppeteer');
const { setTimeout } = require('node:timers/promises');
const { createObjectCsvWriter } = require('csv-writer');

Actor.main(async () => {
    const input = await Actor.getInput();
    const startUrls = input?.startUrls || [];
    const productHandle = input?.productHandle || 'default-product';
    const shopifyProductUrl = input?.productUrl || 'https://yourshopifydomain.com/products/' + productHandle;

    const allReviews = [];

    log.info('Starting scraper in Judge.me format...');

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
            async (crawlingContext, gotoOptions) => {
                const { page } = crawlingContext;
                await page.setExtraHTTPHeaders({
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                    'sec-ch-ua': '"Google Chrome";v="121", " Not;A Brand";v="99"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"Windows"',
                    'Upgrade-Insecure-Requests': '1'
                });
                gotoOptions.timeout = 90000;
                gotoOptions.waitUntil = 'networkidle2';
            }
        ],

        async requestHandler({ page, request }) {
            log.info(`Processing: ${request.url}`);

            try {
                await page.setDefaultNavigationTimeout(90000);
                await page.setDefaultTimeout(60000);
                await page.waitForSelector('.product-review-unit.isChecked', { timeout: 30000 });

                const reviews = await page.evaluate(() => {
                    const reviewElems = document.querySelectorAll('.product-review-unit.isChecked');
                    return Array.from(reviewElems).slice(0, 10).map(el => {
                        const getText = (selector) => {
                            const elNode = el.querySelector(selector);
                            return elNode?.innerText?.trim() || null;
                        };

                        const name = getText('.product-review-unit-user-info .review-write-info-writer') || 'Anonymous';
                        const date = getText('.product-review-unit-user-info .review-write-info-date');
                        const text = getText('.review-unit-cont-comment');

                        const imgEl = el.querySelector('.review-unit-media img');
                        const image = imgEl?.src?.startsWith('/')
                            ? `https://global.oliveyoung.com${imgEl.src}`
                            : imgEl?.src;

                        const ratingBox = el.querySelector('.review-star-rating');
                        const lefts = ratingBox?.querySelectorAll('.wrap-icon-star .icon-star.left.filled').length || 0;
                        const rights = ratingBox?.querySelectorAll('.wrap-icon-star .icon-star.right.filled').length || 0;
                        const stars = (lefts + rights) * 0.5 || null;

                        return {
                            title: null,
                            body: text,
                            rating: stars,
                            review_date: date,
                            reviewer_name: name,
                            reviewer_email: 'anon@example.com',
                            product_url: null, // will be injected later
                            picture_urls: image ? image : '',
                            product_id: null,
                            product_handle: null, // will be injected later
                        };
                    }).filter(r => r.body && r.rating);
                });

                for (const r of reviews) {
                    r.product_handle = productHandle;
                    r.product_url = shopifyProductUrl;
                    allReviews.push(r);
                }

                log.info(`Extracted ${reviews.length} reviews`);

            } catch (err) {
                log.error('Error scraping reviews:', err.message);
            }
        }
    });

    await crawler.run(startUrls);

    if (allReviews.length > 0) {
        const fs = require('fs');
        const path = '/mnt/data/OUTPUT.csv';
        const headers = [
            'title',
            'body',
            'rating',
            'review_date',
            'reviewer_name',
            'reviewer_email',
            'product_url',
            'picture_urls',
            'product_id',
            'product_handle'
        ];
        const csvData = allReviews.map(r => {
            const row = {};
            for (const h of headers) row[h] = r[h] || '';
            return row;
        });

        const csvWriter = require('csv-writer').createObjectCsvWriter({
            path,
            header: headers.map(h => ({ id: h, title: h }))
        });

        await csvWriter.writeRecords(csvData);
        await Actor.setValue('OUTPUT.csv', fs.readFileSync(path), { contentType: 'text/csv' });
        log.info('✅ CSV export complete: OUTPUT.csv');
    } else {
        log.warning('No reviews extracted, CSV not created.');
    }
});
