import { Actor } from 'apify';
import { PuppeteerCrawler, log } from '@crawlee/puppeteer';
import { writeFile } from 'fs/promises';
import path from 'path';
import { createObjectCsvWriter } from 'csv-writer';

// Define the output path
const outputFolder = path.join(__dirname, 'output');

// Ensure output folder exists (optional, depending on your setup)
await writeFile(outputFolder, '', { flag: 'w' });

Actor.main(async () => {
    // Get the input data
    const input = await Actor.getInput();
    const startUrls = input?.startUrls || [];
    const products = input?.products || [];

    log.info('Starting scraper...');

    // Initialize the crawler
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
        async requestHandler({ page, request }) {
            log.info(`Processing: ${request.url}`);

            // Scrape product review information
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

                        const title = getText('.review-title') || 'No Title'; // Use product name as fallback
                        const body = getText('.review-unit-cont-comment') || 'No review body';
                        const rating = (el.querySelector('.review-star-rating')?.childElementCount || 0) * 0.5 || 0;
                        const reviewDate = getText('.review-write-info-date');
                        const reviewerName = getText('.product-review-unit-user-info .review-write-info-writer') || 'Anonymous';
                        const reviewerEmail = 'example@example.com'; // Modify as per requirement (static or dynamic)
                        const productUrl = window.location.href;

                        const imgEl = el.querySelector('.review-unit-media img');
                        const pictureUrls = imgEl ? imgEl.src : null;

                        const productId = window.location.pathname.split('?prdtNo=')[1];

                        return {
                            title, 
                            body,
                            rating, 
                            reviewDate, 
                            reviewerName, 
                            reviewerEmail,
                            productUrl, 
                            pictureUrls, 
                            productId, 
                            productHandle: productId,
                        };
                    }).filter(r => r.body); // Ensure there is some review text
                });

                log.info(`Extracted ${reviews.length} reviews`);

                // Store reviews in a CSV format
                const csvWriter = createObjectCsvWriter({
                    path: path.join(outputFolder, `scraping_data_${Date.now()}.csv`),
                    header: [
                        { id: 'title', title: 'title' },
                        { id: 'body', title: 'body' },
                        { id: 'rating', title: 'rating' },
                        { id: 'reviewDate', title: 'review_date' },
                        { id: 'reviewerName', title: 'reviewer_name' },
                        { id: 'reviewerEmail', title: 'reviewer_email' },
                        { id: 'productUrl', title: 'product_url' },
                        { id: 'pictureUrls', title: 'picture_urls' },
                        { id: 'productId', title: 'product_id' },
                        { id: 'productHandle', title: 'product_handle' }
                    ]
                });

                await csvWriter.writeRecords(reviews);
                log.info('CSV file written to: ' + path.join(outputFolder, `scraping_data_${Date.now()}.csv`));

                // Push the data back to Apify's storage
                await Actor.pushData(reviews);

            } catch (error) {
                log.error('Scraping failed:', error.message);
                throw error;
            }
        }
    });

    // Run the crawler
    await crawler.run(startUrls);
});
