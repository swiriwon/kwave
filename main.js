const { Actor } = require('apify');
const { PuppeteerCrawler, log } = require('@crawlee/puppeteer');
const { setTimeout } = require('node:timers/promises');

Actor.main(async () => {
    const input = await Actor.getInput();
    const startUrls = input?.startUrls || [];

    log.info('Starting scraper with accurate rating extraction...');

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
                        const option = getText('.review-unit-option span');

                        const imgEl = el.querySelector('.review-unit-media img');
                        const image = imgEl?.src?.startsWith('/')
                            ? `https://global.oliveyoung.com${imgEl.src}`
                            : imgEl?.src;

                        // ✅ Main star rating logic: scoped to .review-star-rating only
                        const stars = (() => {
                            const ratingBox = el.querySelector('.review-star-rating');
                            if (!ratingBox) return null;

                            const lefts = ratingBox.querySelectorAll('.wrap-icon-star .icon-star.left.filled').length;
                            const rights = ratingBox.querySelectorAll('.wrap-icon-star .icon-star.right.filled').length;
                            return (lefts + rights) * 0.5 || null;
                        })();

                        // 🌟 Feature-specific ratings
                        const features = {};
                        el.querySelectorAll('.list-review-evlt li').forEach((li) => {
                            const label = li.querySelector('span')?.innerText?.trim();
                            const starCount = li.querySelectorAll('.wrap-icon-star .icon-star.filled').length * 0.5;
                            if (label) features[label] = starCount;
                        });

                        const likeCount = getText('.btn-likey-count');

                        return {
                            id: `review-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                            name,
                            date,
                            text,
                            option,
                            image,
                            stars,
                            features,
                            likeCount,
                            productUrl: window.location.href
                        };
                    }).filter(r => r.text);
                });

                log.info(`Extracted ${reviews.length} reviews`);

                if (reviews.length > 0) {
                    await Actor.pushData(reviews);
                } else {
                    log.warning('No reviews found on this page');
                    const html = await page.content();
                    await Actor.setValue(`no-reviews-${Date.now()}.html`, html, { contentType: 'text/html' });
                    await Actor.pushData([{ url: request.url, status: 'NO_REVIEWS', timestamp: new Date().toISOString() }]);
                }

            } catch (error) {
                log.error('Scraping failed:', error.message);
                try {
                    const screenshot = await page.screenshot({ fullPage: true });
                    const key = `error-${Date.now()}.png`;
                    await Actor.setValue(key, screenshot, { contentType: 'image/png' });
                } catch (screenshotErr) {
                    log.error('Screenshot capture failed', screenshotErr);
                }
                throw error;
            }
        }
    });

    await crawler.run(startUrls);
});
