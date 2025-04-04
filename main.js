import { Actor } from 'apify';
import { PuppeteerCrawler, log } from '@crawlee/puppeteer';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

Actor.main(async () => {
    const input = await Actor.getInput();
    const startUrls = input?.startUrls || [];

    log.info('Starting scraper...');

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
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                });
                gotoOptions.timeout = 90000;
                gotoOptions.waitUntil = 'networkidle2';
            }
        ],
        async requestHandler({ page, request, crawler }) {
            log.info(`Processing: ${request.url}`);
            const isSearchPage = request.url.includes('/display/search');

            if (isSearchPage) {
                await page.waitForSelector('.prdt-unit', { timeout: 30000 });

                const productLinks = await page.$$eval('.prdt-unit a', links =>
                    [...new Set(links.map(link => link.href).filter(href => href.includes('/product/detail')))]
                );

                log.info(`Found ${productLinks.length} product links, enqueuing...`);
                for (const link of productLinks) {
                    await crawler.addRequests([link]);
                }
                return;
            }

            // Product page logic
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

                    const stars = (() => {
                        const box = el.querySelector('.review-star-rating');
                        const lefts = box?.querySelectorAll('.wrap-icon-star .icon-star.left.filled').length || 0;
                        const rights = box?.querySelectorAll('.wrap-icon-star .icon-star.right.filled').length || 0;
                        return (lefts + rights) * 0.5 || null;
                    })();

                    const features = {};
                    el.querySelectorAll('.list-review-evlt li').forEach((li) => {
                        const label = li.querySelector('span')?.innerText?.trim();
                        const count = li.querySelectorAll('.wrap-icon-star .icon-star.filled').length * 0.5;
                        if (label) features[label] = count;
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
            if (reviews.length) {
                const outputPath = path.join(__dirname, 'output', `reviews-${Date.now()}.json`);
                await mkdir(path.dirname(outputPath), { recursive: true });
                await writeFile(outputPath, JSON.stringify(reviews, null, 2));
                await Actor.pushData(reviews);
                log.info(`Saved to: ${outputPath}`);
            } else {
                log.warning('No reviews found on product page');
            }
        }
    });

    await crawler.run(startUrls);
});
