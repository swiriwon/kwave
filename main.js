const { Actor } = require('apify');
const { PuppeteerCrawler, log } = require('@crawlee/puppeteer');
const { setTimeout } = require('node:timers/promises');

Actor.main(async () => {
    const input = await Actor.getInput();
    const startUrls = input?.startUrls || [];

    log.info('Starting scraper with optimized review extraction...');

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

        async preNavigationHooks(crawlingContext, gotoOptions) {
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
        },

        async requestHandler({ page, request }) {
            log.info(`Processing: ${request.url}`);

            try {
                await page.setDefaultNavigationTimeout(90000);
                await page.setDefaultTimeout(60000);

                await page.waitForSelector('.product-detail-wrap', { timeout: 30000 });

                // Click on review tab if exists
                const reviewTab = await page.$('#tab-reviews');
                if (reviewTab) {
                    await reviewTab.click();
                    await page.waitForTimeout(2000);
                }

                // Wait for review list to load
                await page.waitForSelector('.list-product-review-unit, .product-detail-review', { timeout: 10000 });

                // Extract reviews
                const reviews = await page.evaluate(() => {
                    const reviewElems = document.querySelectorAll('.list-product-review-unit, .review-unit, .review-item');
                    return Array.from(reviewElems).slice(0, 10).map(el => {
                        const getText = (selArr) => {
                            for (const sel of selArr) {
                                const elNode = el.querySelector(sel);
                                if (elNode?.innerText?.trim()) return elNode.innerText.trim();
                            }
                            return null;
                        };

                        const name = getText(['.review-write-info-writer', '.review-author', '.user-name']) || 'Anonymous';
                        const date = getText(['.review-write-info-date', '.review-date', '.date']);
                        const text = getText(['.review-unit-cont-comment', '.review-unit-cont', '.review-content', '.review-text']);
                        const imgEl = el.querySelector('.review-unit-media img, .review-image img, .review-photo img');
                        const image = imgEl?.src?.startsWith('/') ? `https://global.oliveyoung.com${imgEl.src}` : imgEl?.src;

                        let stars = null;
                        const styleStars = el.querySelector('[style*="width"]');
                        if (styleStars) {
                            const match = styleStars.getAttribute('style')?.match(/width:\s*([\d.]+)%/);
                            if (match) stars = Math.round((parseFloat(match[1]) / 100) * 5 * 10) / 10;
                        }

                        const id = `review-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                        return { id, name, date, stars, text, image, productUrl: window.location.href };
                    }).filter(r => r.text);
                });

                if (reviews.length > 0) {
                    log.info(`Extracted ${reviews.length} reviews`);
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
