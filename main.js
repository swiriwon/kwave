import { createObjectCsvWriter } from 'csv-writer';
import { PuppeteerCrawler, log } from '@crawlee/puppeteer';

const outputFolder = './output'; // Ensure that this folder exists
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
            // Increase the wait time for the page to load
            await page.setDefaultNavigationTimeout(60000); // 60 seconds
            await page.waitForSelector('.product-review-unit.isChecked', { timeout: 60000 });

            // Extract the reviews data
            const reviews = await page.evaluate(() => {
                const reviewElems = document.querySelectorAll('.product-review-unit.isChecked');
                return Array.from(reviewElems).map(el => {
                    const getText = (selector) => {
                        const elNode = el.querySelector(selector);
                        return elNode ? elNode.innerText.trim() : '';
                    };

                    const title = getText('.product-review-title') || 'No Title'; // Use product name as title
                    const body = getText('.review-unit-cont-comment') || 'No Comment';
                    const rating = parseFloat(getText('.review-star-rating .filled')) || 0;
                    const review_date = getText('.review-write-info-date') || 'Unknown Date';
                    const reviewer_name = getText('.review-write-info-writer') || 'Anonymous';
                    const reviewer_email = 'anonymous@kwave.ai'; // Placeholder email (if not available)
                    const product_url = window.location.href;
                    const picture_urls = Array.from(el.querySelectorAll('.review-unit-media img')).map(img => img.src).join(',');

                    return {
                        title,
                        body,
                        rating,
                        review_date,
                        reviewer_name,
                        reviewer_email,
                        product_url,
                        picture_urls,
                        product_id: window.location.href.split('prdtNo=')[1], // Assuming the product ID is in the URL
                        product_handle: window.location.href.split('/').pop() // Get the product handle from the URL
                    };
                });
            });

            // Save the reviews to CSV
            await csvWriter.writeRecords(reviews);
            log.info('Reviews saved to CSV');
        } catch (error) {
            log.error(`Scraping failed: ${error.message}`);
        }
    }
});

// Add your product URLs to test
crawler.addRequests([
    { url: 'https://global.oliveyoung.com/display/search?query=Green%20Finger%20Forest%20Multi%20Defense%20Sun%20Stick%2019g' },
    { url: 'https://global.oliveyoung.com/display/search?query=Medicube%20PDRN%20Pink%20Peptide%20Ampoule%2030ml%20Double%20Pack' }
]);

await crawler.run();
