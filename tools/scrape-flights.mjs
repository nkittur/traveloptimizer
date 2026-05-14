import { chromium } from 'playwright';

const searches = [
  {
    label: 'PIT → LAX (Apr 16, one-way)',
    url: 'https://www.google.com/travel/flights/search?tfs=CBwQAhopEgoyMDI2LTA0LTE2agwIAhIIL20vMDY2MXJyDAgCEggvbS8wdjFycBgBcAGCAQsI____________AUABSAGYAQGyAQQYASAB&hl=en&gl=us&curr=USD',
    // Fallback: we'll construct URL dynamically
    from: 'PIT',
    to: 'LAX',
    date: '2026-04-16'
  },
  {
    label: 'PIT → SNA (Apr 16, one-way)',
    from: 'PIT',
    to: 'SNA',
    date: '2026-04-16'
  },
  {
    label: 'SAN → PIT (Apr 19, one-way)',
    from: 'SAN',
    to: 'PIT',
    date: '2026-04-19'
  }
];

async function scrapeGoogleFlights(browser, from, to, date, label) {
  const page = await browser.newPage();

  try {
    // Use Google Flights search URL
    const url = `https://www.google.com/travel/flights?q=flights+from+${from}+to+${to}+on+${date}+one+way&curr=USD&hl=en&gl=us`;

    console.log(`\n--- ${label} ---`);
    console.log(`Loading: ${url}`);

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for flight results to load
    await page.waitForTimeout(5000);

    // Try to find and extract flight data from the results
    const flights = await page.evaluate(() => {
      const results = [];

      // Google Flights uses list items for flight results
      // Look for the main flight result containers
      const flightCards = document.querySelectorAll('li[class*="pIav2d"], ul[class*="Rk10dc"] > li, div[class*="yR1fYc"], div[class*="nQOrp"]');

      if (flightCards.length === 0) {
        // Try alternative selectors
        const allLis = document.querySelectorAll('li');
        for (const li of allLis) {
          const text = li.textContent;
          // Look for elements that contain flight-like data (times, prices)
          if (text && text.match(/\$\d+/) && text.match(/\d+:\d+/) && text.length < 500) {
            results.push({ raw: text.trim().replace(/\s+/g, ' ') });
          }
        }
      } else {
        for (const card of flightCards) {
          results.push({ raw: card.textContent.trim().replace(/\s+/g, ' ') });
        }
      }

      // Also try to get the "best flights" or "other flights" sections
      const sections = document.querySelectorAll('[class*="zBTtmb"], [class*="OgQvJf"]');
      for (const section of sections) {
        const text = section.textContent.trim().replace(/\s+/g, ' ');
        if (text.match(/\$\d+/) && text.length < 2000) {
          results.push({ section: text });
        }
      }

      // Grab any visible price elements
      const prices = [];
      const priceEls = document.querySelectorAll('[class*="price"], span[aria-label*="dollar"], span[aria-label*="price"]');
      for (const el of priceEls) {
        const text = el.textContent.trim();
        if (text.match(/^\$\d/)) {
          prices.push(text);
        }
      }

      // Get page title and any visible text that looks like flight info
      const bodyText = document.body.innerText;
      const flightLines = bodyText.split('\n').filter(line => {
        return line.match(/\$\d+/) ||
               (line.match(/\d+:\d+\s*(AM|PM)/i) && line.length < 200) ||
               line.match(/Nonstop|1 stop|2 stops/i) ||
               line.match(/American|United|Delta|Southwest|Spirit|Frontier|JetBlue|Breeze|Alaska/i);
      });

      return {
        results: results.slice(0, 10),
        prices: [...new Set(prices)].slice(0, 20),
        flightLines: [...new Set(flightLines)].slice(0, 50),
        title: document.title
      };
    });

    console.log(`Page title: ${flights.title}`);

    if (flights.prices.length > 0) {
      console.log(`Prices found: ${flights.prices.join(', ')}`);
    }

    if (flights.flightLines.length > 0) {
      console.log(`\nFlight data:`);
      for (const line of flights.flightLines) {
        console.log(`  ${line}`);
      }
    }

    if (flights.results.length > 0) {
      console.log(`\nResult cards:`);
      for (const r of flights.results) {
        console.log(`  ${r.raw || r.section || JSON.stringify(r)}`);
      }
    }

    if (flights.prices.length === 0 && flights.flightLines.length === 0) {
      // Take a screenshot for debugging and dump more of the page
      const text = await page.evaluate(() => document.body.innerText.substring(0, 3000));
      console.log(`No structured data found. Page text preview:\n${text}`);
    }

  } catch (err) {
    console.log(`Error: ${err.message}`);
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  try {
    await Promise.all(searches.map(s =>
      scrapeGoogleFlights(browser, s.from, s.to, s.date, s.label)
    ));
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
