import { createObjectCsvWriter } from 'csv-writer'; // For generating CSV
import { main } from 'apify'; // Apify library for crawling
import puppeteer from 'puppeteer-core'; // Puppeteer for scraping

// Function to scrape product details from the search page
async function fetchProductData(query) {
    const searchUrl = `https://global.oliveyoung.com/display/search?query=${encodeURIComponent(query)}`;

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(searchUrl, { waitUntil: 'load' });

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

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(productUrl, { waitUntil: 'load' });

    const reviews = await page.evaluate(() => {
        const reviewElements = Array.from(document.querySelectorAll('.review-container')); 
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
    const csvWriter = createObjectCsvWriter({
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
main(async () => {
    const query = 'Green Finger Forest Multi Defense Sun Stick 19g'; // Set the query string for searching products
    const products = await fetchProductData(query); // Fetch the products based on the query

    const allReviews = [];

    for (const product of products) {
        console.log(`Scraping reviews for product: ${product.productName} (ID: ${product.productId})`);

        const reviews = await fetchProductReviews(product.productId); // Scrape reviews for each product

        // Enrich reviews with product details
        const enrichedReviews = reviews.map(review => ({
            ...review,
            productId: product.productId,
            productName: product.productName,
        }));

        // Push all enriched reviews to a collection
        allReviews.push(...enrichedReviews);
    }

    const fileName = './review_data.csv'; // Define the output CSV file name
    await generateCSVFile(allReviews, fileName); // Generate and write the CSV file

    console.log('Review scraping complete!');
});
