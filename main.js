const { Actor } = require('apify');
const { PuppeteerCrawler } = require('@crawlee/puppeteer');
const { setTimeout } = require('node:timers/promises');

Actor.main(async () => {
    // Get input from the user
    const input = await Actor.getInput();
    const startUrls = input?.startUrls || [];

    // Initialize the crawler
    const crawler = new PuppeteerCrawler({
        async requestHandler({ page, request }) {
            console.log(`Scraping: ${request.url}`);

            // Configure longer timeout and wait for content to load
            await page.setDefaultTimeout(60000);
            await page.setDefaultNavigationTimeout(60000);
            
            // Wait for page to fully load
            await page.waitForSelector('.product-detail-wrap', { visible: true });
            
            // First scroll to where reviews start to trigger their loading
            await page.evaluate(() => {
                const reviewSection = document.querySelector('.product-detail-review');
                if (reviewSection) {
                    reviewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
            
            // Wait for reviews to load
            await setTimeout(3000);
            await page.waitForSelector('.list-product-review-unit', { visible: true, timeout: 60000 });
            
            // Scroll multiple times to ensure all reviews are loaded
            for (let i = 0; i < 8; i++) {
                await page.evaluate(() => window.scrollBy(0, 300));
                await setTimeout(1000);
            }

            // Extract reviews
            const reviews = await page.evaluate(() => {
                const reviewElements = Array.from(document.querySelectorAll('.list-product-review-unit'));
                return reviewElements.slice(0, 10).map((el) => {
                    // Extract review data
                    const name = el.querySelector('.review-write-info-writer')?.innerText?.trim() || 'Anonymous';
                    const date = el.querySelector('.review-write-info-date')?.innerText?.trim() || null;
                    
                    // Extract text content
                    const text = el.querySelector('.review-unit-cont-comment')?.innerText?.trim() || 
                                 el.querySelector('.review-unit-cont')?.innerText?.trim() || null;
                    
                    // Extract image URL if available
                    let image = null;
                    const imgElement = el.querySelector('.review-unit-media img');
                    if (imgElement && imgElement.src) {
                        image = imgElement.src;
                        // Ensure it's an absolute URL
                        if (image.startsWith('/')) {
                            image = `https://global.oliveyoung.com${image}`;
                        }
                    }

                    // Extract star rating - fixed calculation
                    let stars = null;
                    const starEl = el.querySelector('.review-product-star-rating span[style*="width"]');
                    if (starEl) {
                        const style = starEl.getAttribute('style') || '';
                        const match = style.match(/width:\s*([\d.]+)%/);
                        if (match) {
                            const percentage = parseFloat(match[1]);
                            // Calculate stars on a 5-point scale
                            stars = Math.round((percentage / 100) * 5 * 10) / 10;
                        }
                    }

                    // Add review ID for tracking
                    const reviewId = el.getAttribute('data-review-id') || 
                                    el.getAttribute('id') || 
                                    `review-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

                    return { 
                        id: reviewId,
                        name, 
                        date, 
                        stars, 
                        text, 
                        image,
                        productUrl: window.location.href
                    };
                }).filter(r => r.text); // Only include reviews with text content
            });

            console.log(`Extracted ${reviews.length} reviews`);
            
            // Debug first review
            if (reviews.length > 0) {
                console.log('First review sample:', JSON.stringify(reviews[0], null, 2));
            }
            
            await Actor.pushData(reviews);
        },
        // Configure Puppeteer for better reliability
        launchContext: {
            launchOptions: {
                headless: true,
                args: [
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins',
                    '--disable-site-isolation-trials',
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--window-size=1920,1080',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36'
                ]
            }
        }
    });

    // Run the crawler
    await crawler.run(startUrls);
});
