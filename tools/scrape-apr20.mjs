import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const url = 'https://www.google.com/travel/flights?q=flights+from+SAN+to+PIT+on+2026-04-20+one+way&curr=USD&hl=en&gl=us';
  console.log('Loading:', url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(5000);

  const flights = await page.evaluate(() => {
    const bodyText = document.body.innerText;
    const flightLines = bodyText.split('\n').filter(line => {
      return line.match(/\$\d+/) ||
        (line.match(/\d+:\d+\s*(AM|PM)/i) && line.length < 200) ||
        line.match(/Nonstop|1 stop|2 stops/i) ||
        line.match(/American|United|Delta|Southwest|Spirit|Frontier|JetBlue|Breeze|Alaska/i);
    });
    const prices = [];
    const priceEls = document.querySelectorAll('span[aria-label*="dollar"], span[aria-label*="price"]');
    for (const el of priceEls) {
      const text = el.textContent.trim();
      if (text.match(/^\$\d/)) prices.push(text);
    }
    // Get result cards
    const results = [];
    const allLis = document.querySelectorAll('li');
    for (const li of allLis) {
      const text = li.textContent;
      if (text && text.match(/\$\d+/) && text.match(/\d+:\d+/) && text.length < 500) {
        results.push(text.trim().replace(/\s+/g, ' '));
      }
    }
    return {
      prices: [...new Set(prices)].slice(0, 20),
      flightLines: [...new Set(flightLines)].slice(0, 50),
      results: results.slice(0, 15),
      title: document.title
    };
  });

  console.log('Title:', flights.title);
  if (flights.prices.length) console.log('Prices:', flights.prices.join(', '));
  if (flights.flightLines.length) {
    console.log('\nFlight data:');
    for (const l of flights.flightLines) console.log(' ', l);
  }
  if (flights.results.length) {
    console.log('\nResult cards:');
    for (const r of flights.results) console.log(' ', r);
  }

  await browser.close();
}
main().catch(console.error);
