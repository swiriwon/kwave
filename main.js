import { Actor } from 'apify';
import { PuppeteerCrawler } from 'crawlee';

await Actor.init();

const input = await Actor.getInput();
const { productUrl } = input;

const crawler = new PuppeteerCrawler({
    async requestHandler({ page, request, log }) {
        log.info(`Scraping: ${request.url}`);

        await page.goto(request.url, { waitUntil: 'networkidle2' });

        // Click the review tab
        await page.click('#review-count');
        await page.waitForTimeout(3000);

        const reviews = await page.$$eval('.review-list-wrap .list > li', (items) => {
            return items.slice(0, 15).map((el) => {
                const name = el.querySelector('.user-name')?.textContent?.trim() || 'Anonymous';
                const ratingStyle = el.querySelector('.score .score-star')?.getAttribute('style') || '';
                const stars = ratingStyle ? parseInt(ratingStyle.match(/width:\\s*(\\d+)/)?.[1]) / 20 : 0;
                const text = el.querySelector('.review-desc')?.textContent?.trim();
                const image = el.querySelector('.photo img')?.src || null;

                return {
                    reviewer_name: name,
                    rating: stars,
                    review_text: text,
                    image_url: image,
                };
            });
        });

        await Actor.setValue('OUTPUT', {
            productUrl: request.url,
            reviews,
        });
    },
});

await crawler.run([{ url: productUrl }]);

await Actor.exit();
