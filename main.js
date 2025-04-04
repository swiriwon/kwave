const { Actor } = require('apify');
const { PuppeteerCrawler } = require('@crawlee/puppeteer');
const { setTimeout } = require('node:timers/promises');

Actor.main(async () => {
    const input = await Actor.getInput();
    const startUrls = input?.startUrls || [];
    const productHandle = input?.productHandle;
    const shopDomain = input?.shopDomain || 'https://kwave.ai';
    const productUrl = `${shopDomain}/products/${productHandle}`;

    const allReviews = [];

    const generateFakeName = (maskedName) => {
        const cleaned = maskedName.replace(/\*/g, '').trim();
        if (!cleaned) return 'Anonymous';

        const fillers = 'aeioulnrstmd';
        let result = cleaned;

        while (result.length < 5) {
            result += fillers[Math.floor(Math.random() * fillers.length)];
        }

        return result.charAt(0).toUpperCase() + result.slice(1);
    };

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
            async ({ page }, gotoOptions) => {
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

                        const rawName = getText('.product-review-unit-user-info .review-write-info-writer') || '';
                        const date = getText('.product-review-unit-user-info .review-write-info-date') || '';
                        const text = getText('.review-unit-cont-comment') || '';

                        const imgEl = el.querySelector('.review-unit-media img');
                        const image = imgEl?.src?.startsWith('/')
                            ? `https://global.oliveyoung.com${imgEl.src}`
                            : imgEl?.src || '';

                        const ratingBox = el.querySelector('.review-star-rating');
                        const lefts = ratingBox?.querySelectorAll('.wrap-icon-star .icon-star.left.filled').length || 0;
                        const rights = ratingBox?.querySelectorAll('.wrap-icon-star .icon-star.right.filled').length || 0;
                        const stars = (lefts + rights) * 0.5 || '';

                        return {
                            rawName,
                            review_date: date,
                            body: text,
                            rating: stars,
                            picture_urls: image
                        };
                    }).filter(r => r.body && r.rating);
                });

                for (const r of reviews) {
                    allReviews.push({
                        title: '',
                        body: r.body || '',
                        rating: r.rating || '',
                        review_date: r.review_date || '',
                        reviewer_name: generateFakeName(r.rawName || ''),
                        reviewer_email: '', // Blank as required
                        product_url: productUrl,
                        picture_urls: r.picture_urls || '',
                        product_id: '', // Blank
                        product_handle: productHandle
                    });
                }

            } catch (err) {
                console.error(`Error scraping ${request.url}:`, err.message);
            }
        }
    });

    await crawler.run(startUrls);

    if (allReviews.length > 0) {
        for (const r of allReviews) {
            await Actor.pushData(r); // Push each row to dataset
        }
    } else {
        console.warn('No reviews found to push to dataset.');
    }
});
