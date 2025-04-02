const Apify = require('apify');

Apify.main(async () => {
    const input = await Apify.getInput();
    const { productUrl } = input;

    const browser = await Apify.launchPuppeteer(); // ✅ works in 3.3.1
    const page = await browser.newPage();

    await page.goto(productUrl, { waitUntil: 'networkidle2' });

    await page.waitForSelector('#review-count', { timeout: 10000 });
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

    await Apify.setValue('OUTPUT', { productUrl, reviews });
    await browser.close();
});
