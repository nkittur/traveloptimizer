import { chromium } from 'playwright';

// Check specific places for outdoor seating / patio details
const places = process.argv.slice(2);
if (!places.length) {
  console.error('Usage: node check-place-details.mjs "Place Name 1" "Place Name 2" ...');
  process.exit(1);
}

async function checkPlace(browser, placeName) {
  const page = await browser.newPage();
  try {
    const url = `https://www.google.com/maps/search/${encodeURIComponent(placeName + ' Pittsburgh PA')}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(4000);

    // Click the first result to open details
    const firstResult = await page.$('a[aria-label*="' + placeName.split(' ')[0] + '"]');
    if (firstResult) {
      await firstResult.click();
      await page.waitForTimeout(3000);
    }

    const details = await page.evaluate(() => {
      const text = document.body.innerText;
      const lines = text.split('\n');
      
      const result = {
        outdoor_seating: null,
        address: null,
        hours: null,
        rating: null,
        features: [],
        raw_amenities: []
      };

      for (const line of lines) {
        const lower = line.toLowerCase().trim();
        if (lower.includes('outdoor seating') || lower.includes('patio') || lower.includes('outdoor dining')) {
          result.outdoor_seating = true;
          result.features.push(line.trim());
        }
        if (lower.includes('dine-in') || lower.includes('rooftop') || lower.includes('dog-friendly') || 
            lower.includes('beer') || lower.includes('cocktail') || lower.includes('wi-fi') ||
            lower.includes('serves') || lower.includes('good for')) {
          result.raw_amenities.push(line.trim());
        }
      }

      // Check for "No outdoor seating" as well
      if (text.toLowerCase().includes('no outdoor seating')) {
        result.outdoor_seating = false;
      }

      // Find address
      const addrMatch = text.match(/(\d+\s+[\w\s]+(?:Rd|Dr|St|Ave|Blvd|Ln|Way|Hwy|Pike)[\w\s,]*(?:PA|Pittsburgh)[\s\d]*)/i);
      if (addrMatch) result.address = addrMatch[1].trim();

      return result;
    });

    return { name: placeName, ...details };
  } catch(e) {
    return { name: placeName, error: e.message };
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  
  // Run sequentially to avoid rate limiting
  for (const place of places) {
    console.error(`Checking: ${place}`);
    const result = await checkPlace(browser, place);
    results.push(result);
  }
  
  await browser.close();
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
