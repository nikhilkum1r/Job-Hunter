const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();

chromium.use(stealth);

async function testDDGSearch() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const dork = `site:lever.co | site:greenhouse.io | site:workday.com "Software Engineer"`;
    // using regular DDG
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(dork)}&t=h_&ia=web`;
    
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000); // Wait for DDG to load results (since main DDG uses JS now)
    
    const results = await page.$$eval('a[data-testid="result-title-a"]', (links) => {
        return links.map(a => ({ url: a.href, title: a.innerText }));
    });
    
    console.log("Count DDG a:", results.length);
    console.log(results);
    
    await browser.close();
}

testDDGSearch();
