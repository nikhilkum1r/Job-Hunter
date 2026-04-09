const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();

chromium.use(stealth);

async function testGoogleSearch() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const dork = `site:lever.co | site:greenhouse.io | site:workday.com "Software Engineer" "Apply"`;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(dork)}`;
    
    await page.goto(searchUrl, { waitUntil: 'networkidle' });
    
    const results = await page.$$eval('div.g a', (links) => {
        return links.map(a => ({ url: a.href, title: a.innerText }));
    });
    
    console.log("Count div.g a:", results.length);
    if (results.length === 0) {
        // Find any links
        const aTags = await page.$$eval('a', links => links.map(a => a.href).slice(0, 10));
        console.log("First 10 links on page:", aTags);
        const title = await page.title();
        console.log("Page title:", title);
        
        // Take a screenshot to see if it's a captcha
        await page.screenshot({ path: 'google_test.png' });
    }
    
    await browser.close();
}

testGoogleSearch();
