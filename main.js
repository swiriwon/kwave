// Importing required modules
const Apify = require('apify');
const fs = require('fs');
const path = require('path');
const slugify = require('slugify'); // To create URLs from product names

// Function to generate CSV file for the reviews
const writeCsv = (data, fileName) => {
    const filePath = path.join(__dirname, 'output', fileName); // Path to output folder
    const headers = ['title', 'body', 'rating', 'review_date', 'reviewer_name', 'reviewer_email', 'product_url', 'picture_urls', 'product_id', 'product_handle'];

    const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(fieldName => row[fieldName]).join(','))
    ].join('\n');

    // Create directory if it doesn't exist
    if (!fs.existsSync(path.join(__dirname, 'output'))) {
        fs.mkdirSync(path.join(__dirname, 'output'));
    }

    // Write CSV to the file
    fs.writeFileSync(filePath, csvContent);
    console.log('CSV file saved to:', filePath);
};

// Main function to scrape reviews
Apify.main(async () => {
    // Define the product search term and handle
    const searchTerm = 'Green Finger Forest Multi Defense Sun Stick 19g';
    const productHandle = 'green-finger-forest-multi-defense-sun-stick-19g';
    const shopDomain = 'https://kwave.ai'; // Replace with your shop's URL (if needed)

    // Prepare the search URL for OliveYoung
    const searchUrl = `https://global.oliveyoung.com/display/search?query=${slugify(searchTerm, { lower: true })}`;

    console.log('Searching for product:', searchTerm);

    // Create Apify crawler
    const crawler = new Apify.PuppeteerCrawler({
        requestQueue: await Apify.openRequestQueue(),
        maxRequestsPerCrawl: 1, // Limit to 1 request
        handlePageFunction: async ({ page }) => {
            // Navigate to the search results
            console.log('Navigating to search URL');
            await page.goto(searchUrl);
            await page.waitForSelector('.prdt-unit');

            // Extract product detail URL from the search results
            const productLinks = await page.$$eval('.prdt-unit a', links => links.map(link => link.href));

            if (productLinks.length === 0) {
                console.log('No products found!');
                return;
            }

            // Extract product number and details page link
            const productNumber = productLinks[0].split('prdtNo=')[1]; // Extract product number from the URL
            const productDetailUrl = `https://global.oliveyoung.com/product/detail?prdtNo=${productNumber}&dataSource=search_result`;

            console.log('Navigating to product detail page:', productDetailUrl);

            // Navigate to product detail page
            await page.goto(productDetailUrl);
            await page.waitForSelector('.product-review');

            // Extract reviews
            const reviews = await page.$$eval('.product-review .review-unit', reviews => {
                return reviews.map(review => {
                    const title = review.querySelector('.review-title') ? review.querySelector('.review-title').innerText : '';
                    const body = review.querySelector('.review-body') ? review.querySelector('.review-body').innerText : '';
                    const rating = review.querySelector('.review-rating') ? review.querySelector('.review-rating').innerText : '';
                    const reviewDate = review.querySelector('.review-date') ? review.querySelector('.review-date').innerText : '';
                    const reviewerName = review.querySelector('.reviewer-name') ? review.querySelector('.reviewer-name').innerText : '';
                    const reviewerEmail = ''; // As email is not available publicly, we leave it blank
                    const productUrl = productDetailUrl;
                    const pictureUrls = ''; // Handle picture URL extraction if needed
                    const productId = productNumber;
                    const productHandle = productHandle;

                    return {
                        title, body, rating, reviewDate, reviewerName, reviewerEmail,
                        productUrl, pictureUrls, productId, productHandle
                    };
                });
            });

            console.log(`Found ${reviews.length} reviews for product: ${productHandle}`);

            // Write the reviews to a CSV file
            writeCsv(reviews, `${productHandle}_reviews.csv`);
        },
        handleFailedRequestFunction: async ({ request }) => {
            console.log('Request failed:', request.url);
        }
    });

    // Add initial request to queue
    await crawler.addRequests([{ url: searchUrl }]);

    // Run the crawler
    await crawler.run();
});
