const { chromium } = require('playwright');
async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://html.duckduckgo.com/html/?q=Software+Engineer');
  const links = await page.$$eval('.result__url', els => els.map(e => e.href));
  console.log('Found:', links.length);
  await browser.close();
}
run();
