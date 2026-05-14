import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const url = 'https://www.google.com/travel/flights?q=flights+from+SAN+to+PIT+on+2026-04-20+one+way&curr=USD&hl=en&gl=us';
  console.log('Loading:', url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(6000);

  // Try to click "Show more flights" if available
  try {
    const showMore = await page.$('button:has-text("more flights")');
    if (showMore) {
      await showMore.click();
      await page.waitForTimeout(3000);
    }
  } catch(e) {}

  // Extract full flight cards with all details
  const data = await page.evaluate(() => {
    const results = [];
    // Google Flights uses <li> elements inside <ul> for flight results
    // Each flight card contains: times, airline, duration, stops, price
    const lists = document.querySelectorAll('ul');
    for (const ul of lists) {
      const items = ul.querySelectorAll(':scope > li');
      for (const li of items) {
        const text = li.innerText;
        // Flight cards contain both a time pattern and a price
        if (text && text.match(/\d+:\d+\s*(AM|PM)/i) && text.match(/\$\d+/) && text.length < 600) {
          // Clean up and keep the full card text
          const clean = text.replace(/\n+/g, ' | ').replace(/\s+/g, ' ').trim();
          results.push(clean);
        }
      }
    }
    
    // Also get aria-labels which often have structured flight info
    const ariaResults = [];
    const elements = document.querySelectorAll('[aria-label]');
    for (const el of elements) {
      const label = el.getAttribute('aria-label');
      if (label && label.match(/Depart/) && label.match(/\$/) && label.length < 500) {
        ariaResults.push(label);
      }
    }

    return { cards: [...new Set(results)].slice(0, 20), aria: [...new Set(ariaResults)].slice(0, 20) };
  });

  if (data.aria.length > 0) {
    console.log('\n=== ARIA LABELS (most reliable) ===');
    for (const a of data.aria) console.log(a);
  }

  if (data.cards.length > 0) {
    console.log('\n=== FLIGHT CARDS ===');
    for (const c of data.cards) console.log(c);
  }

  await browser.close();
}
main().catch(console.error);
