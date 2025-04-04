import { Actor } from 'apify';
import { PuppeteerCrawler, log, Dataset } from '@crawlee/puppeteer';
import { writeFile } from 'fs';
import { createObjectCsvWriter } from 'csv-writer';
import path from 'path';

await Actor.init();

const input = await Actor.getInput();
const startUrls = input?.startUrls || [];

log.info('Starting scraper...');

const getRandomName = () => {
    const names = [
        'Linda', 'John', 'Emma', 'James', 'Sophia', 'Liam', 'Olivia', 'Benjamin', 'Charlotte', 'Lucas', 
        'Amelia', 'Elijah', 'Mia', 'Harper', 'Aiden', 'Evelyn', 'Jackson', 'Avery', 'Isaac', 'Scarlett'
    ];
    const randomName = names[Math.floor(Math.random() * names.length)];
    return randomName + '****'; // Generate a fake name by appending asterisks to simulate privacy
};

const outputFolder = '/mnt/data/'; // Ensure the folder exists inside the container for file saving

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
            });
            gotoOptions.timeout = 90000;
            gotoOptions.waitUntil = 'networkidle2';
        }
    ],

    async requestHandler({ page, request, enqueueLinks }) {
        log.info(`Processing: ${request.url}`);

        if (request.label === 'DETAIL') {
            // 🟢 Scrape reviews from product detail page
            try {
                await page.waitForSelector('.product-review-unit.isChecked', { timeout: 30000 });

                const reviews = await page.evaluate(() => {
                    const reviewElems = document.querySelectorAll('.product-review-unit.isChecked');
                    return Array.from(reviewElems).slice(0, 10).map(el => {
                        const getText = (selector) => el.querySelector(selector)?.innerText?.trim() || null;

                        const name = getText('.product-review-unit-user-info .review-write-info-writer') || getRandomName(); // Fake name if not available
                        const date = getText('.product-review-unit-user-info .review-write-info-date');
                        const text = getText('.review-unit-cont-comment');
                        const option = getText('.review-unit-option span');
                        const image = (() => {
                            const imgEl = el.querySelector('.review-unit-media img');
                            if (!imgEl) return null;
                            return imgEl.src.startsWith('/')
                                ? `https://global.oliveyoung.com${imgEl.src}`
                                : imgEl.src;
                        })();
                        const stars = (() => {
                            const box = el.querySelector('.review-star-rating');
                            const lefts = box?.querySelectorAll('.wrap-icon-star .icon-star.left.filled').length || 0;
                            const rights = box?.querySelectorAll('.wrap-icon-star .icon-star.right.filled').length || 0;
                            return (lefts + rights) * 0.5 || null;
                        })();
                        const features = {};
                        el.querySelectorAll('.list-review-evlt li').forEach(li => {
                            const label = li.querySelector('span')?.innerText?.trim();
                            const count = li.querySelectorAll('.wrap-icon-star .icon-star.filled').length * 0.5;
                            if (label) features[label] = count;
                        });

                        const likeCount = getText('.btn-likey-count');

                        return {
                            title: name,  // Use name as title (as there is no title in OliveYoung reviews)
                            body: text,
                            rating: stars,
                            review_date: date,
                            reviewer_name: name,
                            reviewer_email: 'fake-email@kwave.com', // You can replace this with a generator if needed
                            product_url: window.location.href,
                            picture_urls: image,
                            product_id: window.location.href.split('prdtNo=')[1], // Assuming prdtNo is in the URL
                            product_handle: window.location.href.split('prdtNo=')[1] // You can modify the logic if needed
                        };
                    }).filter(r => r.text);
                });

                log.info(`Extracted ${reviews.length} reviews`);

                // Save the reviews to a CSV file
                const currentDate = new Date().toISOString().split('T')[0]; // Format YYYY-MM-DD
                const fileName = `scraping_data_${currentDate}.csv`; // Save with the desired filename
                const filePath = `${outputFolder}${fileName}`;

                const csv = createObjectCsvWriter({
                    path: filePath,
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
                        { id: 'product_handle', title: 'product_handle' }
                    ]
                });

                await csv.writeRecords(reviews);  // Writing to CSV
                log.info(`CSV file saved to ${filePath}`);
                await Actor.pushData(reviews); // Push to Apify dataset

            } catch (err) {
                log.error(`Failed to extract reviews: ${err.message}`);
            }

        } else {
            // 🟡 Search page – extract detail page URL and enqueue it
            const productUrl = await page.evaluate(() => {
                const linkEl = document.querySelector('.prdt-unit a[href*="/product/detail?prdtNo="]');
                return linkEl ? linkEl.href : null;
            });

            if (productUrl) {
                log.info(`Found 1 product links, enqueuing...`);
                await enqueueLinks({
                    urls: [productUrl],
                    label: 'DETAIL'
                });
            } else {
                log.warning('No product detail link found on search page.');
            }
        }
    }
});

await crawler.run(startUrls);
await Actor.exit();
