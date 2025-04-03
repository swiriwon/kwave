const { Actor } = require('apify');
const { PuppeteerCrawler, log } = require('@crawlee/puppeteer');
const { setTimeout } = require('node:timers/promises');

Actor.main(async () => {
    // Get input from the user
    const input = await Actor.getInput();
    const startUrls = input?.startUrls || [];
    
    log.info('Starting scraper with anti-bot measures...');

    // Initialize the crawler with more robust settings
    const crawler = new PuppeteerCrawler({
        maxRequestRetries: 5,
        requestHandlerTimeoutSecs: 180,
        navigationTimeoutSecs: 120,
        
        // Browser launch options with more stable configuration
        launchContext: {
            launchOptions: {
                headless: false, // Try non-headless mode to avoid detection
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--window-size=1280,1024',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                ]
            }
        },
        
        async preNavigationHooks(crawlingContext, gotoOptions) {
            const { page } = crawlingContext;
            
            // Set extra HTTP headers to appear more like a regular browser
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'sec-ch-ua': '"Google Chrome";v="121", " Not;A Brand";v="99"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'Upgrade-Insecure-Requests': '1'
            });
            
            // Set longer timeouts for navigation
            gotoOptions.timeout = 120000;
            gotoOptions.waitUntil = 'networkidle2';
        },
        
        async requestHandler({ page, request, session }) {
            log.info(`Scraping: ${request.url}`);
            
            try {
                // Wait for initial page load with increased timeout
                await page.setDefaultNavigationTimeout(120000);
                await page.setDefaultTimeout(60000);
                
                // Wait for the main content to load
                log.info('Waiting for page content to load...');
                try {
                    await page.waitForSelector('.product-detail-wrap', { 
                        timeout: 30000,
                        visible: true 
                    });
                } catch (err) {
                    log.warning('Could not find product detail wrap, trying to continue anyway');
                }
                
                // Slow down interactions to avoid triggering anti-bot measures
                await setTimeout(3000);
                
                // Scroll down slowly to reach review section
                log.info('Scrolling to review section...');
                for (let i = 0; i < 10; i++) {
                    await page.evaluate(() => {
                        window.scrollBy(0, 200);
                    });
                    await setTimeout(500);
                }
                
                // Check if reviews section exists
                const hasReviews = await page.evaluate(() => {
                    return !!document.querySelector('.product-detail-review') || 
                           !!document.querySelector('.list-product-review-unit');
                });
                
                if (!hasReviews) {
                    log.warning('Review section not found on page');
                    await Actor.pushData([{
                        url: request.url,
                        status: 'NO_REVIEWS',
                        timestamp: new Date().toISOString()
                    }]);
                    return;
                }
                
                // Click on review tab if needed
                await page.evaluate(() => {
                    const reviewTab = document.querySelector('#tab-reviews');
                    if (reviewTab) reviewTab.click();
                });
                
                await setTimeout(2000);
                
                // Scroll multiple times with pauses to load all reviews
                log.info('Loading reviews by scrolling...');
                for (let i = 0; i < 5; i++) {
                    await page.evaluate(() => {
                        const reviewSection = document.querySelector('.product-detail-review');
                        if (reviewSection) {
                            reviewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                        window.scrollBy(0, 300);
                    });
                    await setTimeout(1500);
                }
                
                // Extract reviews using an evaluation function that handles potential page structure differences
                const reviews = await page.evaluate(() => {
                    // Different possible selectors for review containers
                    const selectors = [
                        '.list-product-review-unit',
                        '.review-unit',
                        '.review-item'
                    ];
                    
                    // Find which selector works
                    let elements = [];
                    for (const selector of selectors) {
                        const found = document.querySelectorAll(selector);
                        if (found && found.length > 0) {
                            elements = Array.from(found);
                            break;
                        }
                    }
                    
                    // Take only up to 10 reviews
                    elements = elements.slice(0, 10);
                    
                    // Extract data from each review
                    return elements.map((el) => {
                        // Try different selectors for reviewer name
                        const nameSelectors = ['.review-write-info-writer', '.review-author', '.user-name'];
                        let name = 'Anonymous';
                        for (const selector of nameSelectors) {
                            const nameEl = el.querySelector(selector);
                            if (nameEl && nameEl.innerText.trim()) {
                                name = nameEl.innerText.trim();
                                break;
                            }
                        }
                        
                        // Try different selectors for date
                        const dateSelectors = ['.review-write-info-date', '.review-date', '.date'];
                        let date = null;
                        for (const selector of dateSelectors) {
                            const dateEl = el.querySelector(selector);
                            if (dateEl && dateEl.innerText.trim()) {
                                date = dateEl.innerText.trim();
                                break;
                            }
                        }
                        
                        // Try different selectors for review text
                        const textSelectors = ['.review-unit-cont-comment', '.review-unit-cont', '.review-content', '.review-text'];
                        let text = null;
                        for (const selector of textSelectors) {
                            const textEl = el.querySelector(selector);
                            if (textEl && textEl.innerText.trim()) {
                                text = textEl.innerText.trim();
                                break;
                            }
                        }
                        
                        // Try different selectors for images
                        const imageSelectors = ['.review-unit-media img', '.review-image img', '.review-photo img'];
                        let image = null;
                        for (const selector of imageSelectors) {
                            const imgEl = el.querySelector(selector);
                            if (imgEl && imgEl.src) {
                                image = imgEl.src;
                                break;
                            }
                        }
                        
                        // Fix relative URLs
                        if (image && image.startsWith('/')) {
                            image = `https://global.oliveyoung.com${image}`;
                        }
                        
                        // Try different approaches for star ratings
                        let stars = null;
                        
                        // Method 1: Extract from style width
                        const starEls = el.querySelectorAll('[style*="width"]');
                        for (const starEl of starEls) {
                            if (starEl.classList.contains('rating') || 
                                starEl.parentElement?.classList.contains('rating') || 
                                starEl.classList.contains('star') || 
                                starEl.parentElement?.classList.contains('star')) {
                                
                                const style = starEl.getAttribute('style') || '';
                                const match = style.match(/width:\s*([\d.]+)%/);
                                if (match) {
                                    const percentage = parseFloat(match[1]);
                                    stars = Math.round((percentage / 100) * 5 * 10) / 10;
                                    break;
                                }
                            }
                        }
                        
                        // Method 2: Count filled stars
                        if (!stars) {
                            const filledStars = el.querySelectorAll('.star.filled, .star-filled');
                            if (filledStars.length > 0) {
                                stars = filledStars.length;
                            }
                        }
                        
                        // Generate unique ID
                        const id = `review-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
                        
                        return {
                            id,
                            name,
                            date,
                            stars,
                            text,
                            image,
                            productUrl: window.location.href
                        };
                    }).filter(r => r.text); // Only include reviews with text
                });
                
                log.info(`Successfully extracted ${reviews.length} reviews`);
                
                // Debug info
                if (reviews.length > 0) {
                    log.info('First review sample:', JSON.stringify(reviews[0], null, 2));
                } else {
                    log.warning('No reviews extracted!');
                }
                
                // Save the data
                await Actor.pushData(reviews);
                
            } catch (error) {
                log.error('Error during scraping:', error);
                
                // Try to take screenshot for debugging
                try {
                    const screenshotBuffer = await page.screenshot({ fullPage: true });
                    const screenshotKey = `error-${Date.now()}.png`;
                    await Actor.setValue(screenshotKey, screenshotBuffer, { contentType: 'image/png' });
                    log.info(`Error screenshot saved as ${screenshotKey}`);
                } catch (screenshotError) {
                    log.error('Failed to take error screenshot:', screenshotError);
                }
                
                throw error; // Rethrow to trigger retry
            }
        }
    });

    await crawler.run(startUrls);
});
