import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Search and then look for the outdoor seating filter / chip
  const url = 'https://www.google.com/maps/search/restaurants+near+Ross+Park+Mall+Pittsburgh+PA';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  // Look for and click "Outdoor seating" filter chip
  const chips = await page.$$('button');
  for (const chip of chips) {
    const text = await chip.textContent();
    if (text && text.toLowerCase().includes('outdoor seating')) {
      console.error('Found "Outdoor seating" filter — clicking');
      await chip.click();
      await page.waitForTimeout(4000);
      break;
    }
  }

  // Scroll the feed
  const feed = await page.$('div[role="feed"]');
  if (feed) {
    for (let i = 0; i < 3; i++) {
      await feed.evaluate(el => el.scrollBy(0, 800));
      await page.waitForTimeout(1500);
    }
  }

  // Extract results
  const places = await page.evaluate(() => {
    const results = [];
    const items = document.querySelectorAll('div[role="feed"] > div');
    for (const item of items) {
      const link = item.querySelector('a[aria-label]');
      const name = link ? link.getAttribute('aria-label') : null;
      if (!name) continue;
      const text = item.innerText;
      const ratingMatch = text.match(/(\d\.\d)/);
      const lines = text.split('\n').filter(l => l.trim());
      let address = null;
      let category = null;
      let description = null;
      for (const line of lines) {
        if (line.match(/\d+\s+\w+.*(Rd|Dr|St|Ave|Blvd|Hwy|Way|Pike)/i) && !address) {
          address = line.trim();
        }
        if (line.match(/restaurant|bar|grill|brew|coffee|café|cafe|pub|taproom|bistro|pizza|italian|american|taco|seafood/i) && !category) {
          category = line.trim();
        }
      }
      // Get the short description if available
      for (const line of lines) {
        if (line.length > 20 && line.length < 100 && !line.match(/Open|Close|Order|Reserve|\$/)) {
          if (line !== name && line !== address && line !== category) {
            description = line.trim();
            break;
          }
        }
      }
      const href = link ? link.getAttribute('href') : null;
      results.push({
        name,
        rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
        category: category || null,
        address: address || null,
        description: description || null,
        maps_url: href,
        raw_snippet: text.substring(0, 250)
      });
    }
    return results;
  });

  console.log(JSON.stringify({
    query: "restaurants with outdoor seating near Ross Park Mall Pittsburgh",
    filter: "outdoor seating",
    result_count: places.length,
    scraped_at: new Date().toISOString(),
    places
  }, null, 2));

  await browser.close();
}
main().catch(console.error);
