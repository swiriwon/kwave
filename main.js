import { createObjectCsvWriter } from 'csv-writer';
import { PuppeteerCrawler, log } from '@crawlee/puppeteer';

const outputFolder = './output'; // Ensure this folder exists

const csvWriter = createObjectCsvWriter({
    path: `${outputFolder}/scraping_data_${new Date().toISOString().split('T')[0]}.csv`,
    header: [
        { id: 'title', title: 'Title' },
        { id: 'body', title: 'Body' },
        { id: 'rating', title: 'Rating' },
        { id: 'review_date', title: 'Review Date' },
        { id: 'reviewer_name', title: 'Reviewer Name' },
        { id: 'reviewer_email', title: 'Reviewer Email' },
        { id: 'product_url', title: 'Product URL' },
        { id: 'picture_urls', title: 'Picture URLs' },
        { id: 'product_id', title: 'Product ID' },
        { id: 'product_handle', title: 'Product Handle' }
    ]
});

const crawler = new PuppeteerCrawler({
    launchContext: {
        launchOptions: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    },
    requestHandler: async ({ page, request }) => {
        log.info(`Processing: ${request.url}`);

        try {
            // Step 1: Search for the product by name
            await page.goto(request.url);
            await page.waitForSelector('.product-list'); // Wait for the product list to load

            // Step 2: Extract product ID
            const productIds = await page.evaluate(() => {
                const products = Array.from(document.querySelectorAll('.product-item'));
                return products.map(product => {
                    const productLink = product.querySelector('a');
                    return productLink ? productLink.href.split('prdtNo=')[1] : null;
                }).filter(id => id !== null);
            });

            if (productIds.length > 0) {
                // Step 3: Construct final product URL with ID and scrape reviews
                const finalProductUrl = `https://global.oliveyoung.com/product/detail?prdtNo=${productIds[0]}`;
                log.info(`Found product with ID: ${productIds[0]}`);
                await page.goto(finalProductUrl);

                // Wait for the reviews section to load
                await page.waitForSelector('.product-review-unit.isChecked', { timeout: 60000 });

                // Extract reviews
                const reviews = await page.evaluate(() => {
                    const reviewElems = document.querySelectorAll('.product-review-unit.isChecked');
                    return Array.from(reviewElems).map(el => {
                        const getText = (selector) => {
                            const elNode = el.querySelector(selector);
                            return elNode ? elNode.innerText.trim() : '';
                        };

                        const title = getText('.product-review-title') || 'No Title';
                        const body = getText('.review-unit-cont-comment') || 'No Comment';
                        const rating = parseFloat(getText('.review-star-rating .filled')) || 0;
                        const review_date = getText('.review-write-info-date') || 'Unknown Date';
                        const reviewer_name = getText('.review-write-info-writer') || 'Anonymous';
                        const reviewer_email = 'anonymous@kwave.ai'; // Placeholder email
                        const picture_urls = Array.from(el.querySelectorAll('.review-unit-media img')).map(img => img.src).join(',');

                        return {
                            title,
                            body,
                            rating,
                            review_date,
                            reviewer_name,
                            reviewer_email,
                            product_url: window.location.href,
                            picture_urls,
                            product_id: window.location.href.split('prdtNo=')[1],
                            product_handle: window.location.href.split('/').pop() // Handle extracted from the URL
                        };
                    });
                });

                // Save reviews to CSV
                await csvWriter.writeRecords(reviews);
                log.info('Reviews saved to CSV');
            } else {
                log.warning('No products found on this page');
            }
        } catch (error) {
            log.error(`Scraping failed: ${error.message}`);
        }
    }
});

// Add the search URLs for the products to scrape
crawler.addRequests([
    { url: 'https://global.oliveyoung.com/display/search?query=Medicube%20PDRN%20Pink%20Peptide%20Ampoule%2030ml%20Double%20Pack' },
    { url: 'https://global.oliveyoung.com/display/search?query=Green%20Finger%20Forest%20Multi%20Defense%20Sun%20Stick%2019g' }
]);

await crawler.run();
