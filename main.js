const { Actor } = require('apify');
const { PuppeteerCrawler, log } = require('@crawlee/puppeteer');

Actor.main(async () => {
    const input = await Actor.getInput();
    const searchTerm = input?.searchTerm;
    const productHandle = input?.productHandle;
    const shopDomain = input?.shopDomain || 'https://kwave.ai';
    const shopProductUrl = `${shopDomain}/products/${productHandle}`;

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
        maxRequestRetries: 2,
        requestHandlerTimeoutSecs: 90,
        navigationTimeoutSecs: 60,
        launchContext: {
            launchOptions: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        },
        async requestHandler({ page }) {
            try {
                // Step 1: Search on OliveYoung
                const searchUrl = `https://global.oliveyoung.com/display/search?query=${searchTerm}`;
                await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

                // Step 2: Find first matching product and navigate
                const productLink = await page.evaluate((searchTerm) => {
                    const items = Array.from(document.querySelectorAll('.prd_info a.name'));
                    const termLower = searchTerm.toLowerCase();
                    for (const item of items) {
                        const name = item.textContent.trim().toLowerCase();
                        if (name.includes(termLower)) return item.href;
                    }
                    return items[0]?.href || null;
                }, searchTerm);

                if (!productLink) {
                    log.warning('No matching product found');
                    return;
                }

                await page.goto(productLink, { waitUntil: 'networkidle2', timeout: 60000 });
                await page.waitForSelector('.product-review-unit.isChecked', { timeout: 30000 });

                // Step 3: Extract reviews
                const reviews = await page.evaluate(() => {
                    const reviewElems = document.querySelectorAll('.product-review-unit.isChecked');
                    return Array.from(reviewElems).slice(0, 10).map(el => {
                        const getText = (selector) => el.querySelector(selector)?.innerText?.trim() || '';

                        const rawName = getText('.product-review-unit-user-info .review-write-info-writer');
                        const date = getText('.product-review-unit-user-info .review-write-info-date');
                        const text = getText('.review-unit-cont-comment');

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
                        reviewer_email: '',
                        product_url: shopProductUrl,
                        picture_urls: r.picture_urls || '',
                        product_id: '',
                        product_handle: productHandle
                    });
                }

            } catch (err) {
                log.error('Failed to scrape product reviews:', err.message);
            }
        }
    });

    await crawler.run([{ url: 'https://global.oliveyoung.com' }]); // dummy seed

    if (allReviews.length > 0) {
        for (const review of allReviews) {
            await Actor.pushData(review);
        }
    } else {
        log.warning('No reviews extracted.');
    }
});
