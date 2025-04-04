import { Apify } from 'apify';
import { writeFileSync } from 'fs';
import puppeteer from 'puppeteer-core';
import { CSVWriter } from 'csv-writer';

// Function to scrape product details from the search page
async function fetchProductData(query) {
    const searchUrl = `https://global.oliveyoung.com/display/search?query=${encodeURIComponent(query)}`;

    // Launching Puppeteer
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(searchUrl, { waitUntil: 'load' });

    // Extract product details
    const products = await page.evaluate(() => {
        const productElements = Array.from(document.querySelectorAll('.prdt-unit'));
        return productElements.map(product => {
            const productId = product.querySelector('input[name="prdtNo"]')?.value;
            const productName = product.querySelector('input[name="prdtName"]')?.value;
            return { productId, productName };
        });
    });

    await browser.close();
    return products;
}

// Function to scrape reviews for a specific product
async function fetchProductReviews(productId) {
    const productUrl = `https://global.oliveyoung.com/product/detail?prdtNo=${productId}&dataSource=search_result`;

    // Launch Puppeteer again for detailed page scraping
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(productUrl, { waitUntil: 'load' });

    // Scrape reviews (assuming reviews are within some review elements)
    const reviews = await page.evaluate(() => {
        const reviewElements = Array.from(document.querySelectorAll('.review-container')); // Update with actual review selectors
        return reviewElements.map(review => {
            const reviewerName = review.querySelector('.reviewer-name')?.textContent.trim() || 'Anonymous';
            const reviewText = review.querySelector('.review-text')?.textContent.trim() || 'No text';
            return { reviewerName, reviewText };
        });
    });

    await browser.close();
    return reviews;
}

// Function to generate and write CSV file for reviews
async function generateCSVFile(reviews, fileName) {
    const createCsvWriter = CSVWriter.createObjectCsvWriter;
    const csvWriter = createCsvWriter({
        path: fileName,
        header: [
            { id: 'productId', title: 'Product ID' },
            { id: 'productName', title: 'Product Name' },
            { id: 'reviewerName', title: 'Reviewer Name' },
            { id: 'reviewText', title: 'Review' },
        ],
    });

    await csvWriter.writeRecords(reviews);
    console.log(`CSV file written to ${fileName}`);
}

// Main crawling function
Apify.main(async () => {
    const query = 'Green Finger Forest Multi Defense Sun Stick 19g'; // Example search term
    const products = await fetchProductData(query);

    const allReviews = [];

    // Loop over products and collect reviews
    for (const product of products) {
        console.log(`Scraping reviews for product: ${product.productName} (ID: ${product.productId})`);

        const reviews = await fetchProductReviews(product.productId);

        // Add product details to each review
        const enrichedReviews = reviews.map(review => ({
            ...review,
            productId: product.productId,
            productName: product.productName,
        }));

        allReviews.push(...enrichedReviews);
    }

    // Write all collected reviews into a CSV file
    const fileName = './review_data.csv';
    await generateCSVFile(allReviews, fileName);

    // If you want to upload it to GitHub via GitHub Actions, you can use an API or push it through the repository.
    console.log('Review scraping complete!');
});
