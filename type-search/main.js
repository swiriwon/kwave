import { Actor } from 'apify';
import { PuppeteerCrawler, log } from '@crawlee/puppeteer';
import fs from 'fs';
import path from 'path';

await Actor.init();

const input = await Actor.getInput();
const START_URL = input.startUrl;

if (!START_URL || !START_URL.startsWith('http')) {
    throw new Error('Missing or invalid input URL. Please provide a full URL in the input field as "startUrl".');
}

log.info('Starting scraper...');
const outputFolder = '/home/myuser/app/output/';
if (!fs.existsSync(outputFolder)) {
    log.info(`Creating directory: ${outputFolder}`);
    fs.mkdirSync(outputFolder, { recursive: true });
}
