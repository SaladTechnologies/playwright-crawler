const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth");

chromium.use(stealth());

const {
  PAGE_DATA_URL = "http://localhost:3000",
  PAGE_DATA_AUTH_HEADER = "Benchmark-Api-Key",
  PAGE_DATA_API_KEY = "1234567890",
  QUEUE_URL = "http://localhost:3001",
  CRAWL_ID = "crawl",
} = process.env;

async function getNextUrl() {
  const url = new URL("/" + CRAWL_ID, QUEUE_URL);
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      [PAGE_DATA_AUTH_HEADER]: PAGE_DATA_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to get next url");
  }

  const queueMessage = await response.json();

  if (queueMessage.messages?.length) {
    const { url } = JSON.parse(queueMessage.messages[0].body);

    return {
      url,
      messageId: queueMessage.messages[0].messageId
    }
  } else {
    return null;
  }
}

/**
 * Deletes a message from the queue, indicating it does not need to be processed again.
 * @param messageId The id of the message to delete from the queue
 * @returns 
 */
async function markPageComplete(messageId) {
  const url = new URL(`/${CRAWL_ID}/${encodeURIComponent(messageId)}`, QUEUE_URL);
  const response = await fetch(url.toString(), {
    method: "DELETE",
    headers: {
      [PAGE_DATA_AUTH_HEADER]: PAGE_DATA_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Error deleting message: ${response.status} ${response.statusText}\n${await response.text()}`);
  }
  const json = await response.json()

  return json;
}

async function savePageContent(url, html, links) {
  const submitUrl = new URL("/" + CRAWL_ID, PAGE_DATA_URL);
  await fetch(submitUrl.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [PAGE_DATA_AUTH_HEADER]: PAGE_DATA_API_KEY,
    },
    body: JSON.stringify({
      url,
      html,
      links,
    }),
  });
}

const splitIntoChunks = (array, chunkSize) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

async function queueLinks(links) {
  const submitUrl = new URL("/" + CRAWL_ID, QUEUE_URL);

  const chunks = splitIntoChunks(links, 10);

  for (const chunk of chunks) {
    await Promise.all(chunk.map(link => {
      return fetch(submitUrl.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [PAGE_DATA_AUTH_HEADER]: PAGE_DATA_API_KEY,
        },
        body: JSON.stringify({
          url: link,
        }),
      });
    }));
  }
}

async function processPage(browser, url) {
  const page = await browser.newPage();
  console.log(`Processing ${url}`);
  await page.goto(url);
  // Wait for the page to fully load
  await page.waitForLoadState('networkidle', { timeout: 5000 });

  // Get the full html content of the page
  const html = await page.content();

  // Get every link on the page
  const links = await page.$$eval('a', as => as.map(a => a.href));

  await page.close();

  return { html, links };
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  let nextUrl;
  while (nextUrl = await getNextUrl()) {
    const { url, messageId } = nextUrl;
    const { html, links } = await processPage(browser, url);
    console.log(`Found ${links.length} links in page of size ${html.length}`);
    Promise.all([savePageContent(url, html, links), queueLinks(links)]).then(() => markPageComplete(messageId));
  }

  await browser.close();
}

main();