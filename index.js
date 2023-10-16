const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth");

chromium.use(stealth());

const {
  CRAWL_SERVICE_URL = "http://localhost:3000",
  AUTH_HEADER_NAME,
  AUTH_HEADER_VALUE,
} = process.env;

const headers = {};
if (AUTH_HEADER_NAME && AUTH_HEADER_VALUE) {
  headers[AUTH_HEADER_NAME] = AUTH_HEADER_VALUE;
}

/**
 * We use this to do eager fetching of the next few urls to process.
 */
const _queue = [];

async function fillQueue(num=1) {
  const url = new URL("/job", CRAWL_SERVICE_URL);
  url.searchParams.append("num", num);
  const response = await fetch(url.toString(), {
    method: "GET",
    headers
  });

  if (!response.ok) {
    throw new Error("Failed to get next url");
  }

  const jobs = await response.json();
  _queue.push(...jobs);
}

async function getNextUrl() {
  if (_queue.length) {
    fillQueue(1);
    return _queue.shift();
  }

  await fillQueue(2);
  return _queue.shift();
}

/**
 * Deletes a message from the queue, indicating it does not need to be processed again.
 * @param messageId The id of the message to delete from the queue
 * @returns 
 */
async function markPageComplete(crawlId, deleteId) {
  const url = new URL(`/crawl/${crawlId}/job/${deleteId}`, CRAWL_SERVICE_URL);
  const response = await fetch(url.toString(), {
    method: "DELETE",
    headers
  });

  if (!response.ok) {
    throw new Error(`Error deleting message: ${response.status} ${response.statusText}\n${await response.text()}`);
  }
  
  return;
}

async function savePageContent(pageId, content, links) {
  const submitUrl = new URL(`/page/${pageId}`, CRAWL_SERVICE_URL);
  const resp = await fetch(submitUrl.toString(), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify({
      content,
      links,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Error submitting page content: ${resp.status} ${resp.statusText}\n${await resp.text()}`);
  }
}

async function processPage(browser, url) {
  const page = await browser.newPage();
  console.log(`Processing ${url}`);
  await page.goto(url);
  // Wait for the page to fully load
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch (e) {
    // If we timeout, just continue
  }
  

  // Get the full html content of the page
  const html = await page.content();

  // Get every link on the page
  const links = await page.$$eval('a', as => as.map(a => a.href));

  await page.close();

  return { html, links };
}

let keepAlive = true;
process.on("SIGINT", () => {
  keepAlive = false;
});
process.on("SIGTERM", () => {
  keepAlive = false;
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  while (keepAlive) {
    const job = await getNextUrl();
    if (!job) {
      console.log("No jobs found, sleeping for 5 seconds");
      await sleep(5000);
      continue;
    }
    const { url, page_id, crawl_id, delete_id } = job;
    const { html, links } = await processPage(browser, url);
    console.log(`Found ${links.length} links in page of size ${html.length}`);
    savePageContent(page_id, html, links).then(() => markPageComplete(crawl_id, delete_id));
  }

  await browser.close();
}

main();
