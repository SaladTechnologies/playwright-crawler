import asyncio
from playwright.async_api import async_playwright
from playwright_stealth import stealth_async
import os
import requests
import json
import signal

CRAWL_SERVICE_URL = os.environ.get("CRAWL_SERVICE_URL", "http://localhost:3000")
AUTH_HEADER_NAME = os.environ.get("AUTH_HEADER_NAME")
AUTH_HEADER_VALUE = os.environ.get("AUTH_HEADER_VALUE")

headers = {}
if AUTH_HEADER_NAME and AUTH_HEADER_VALUE:
    headers[AUTH_HEADER_NAME] = AUTH_HEADER_VALUE

_queue = []


async def fill_queue(num=1):
    url = f"{CRAWL_SERVICE_URL}/job?num={num}"
    response = requests.get(url, headers=headers)
    if response.status_code != 200:
        raise Exception("Failed to get next url")
    jobs = response.json()
    _queue.extend(jobs)


async def get_next_url():
    if _queue:
        asyncio.create_task(fill_queue(1))
        return _queue.pop(0)

    await fill_queue(2)
    if len(_queue) < 1:
        return None
    return _queue.pop(0)


async def mark_page_complete(crawl_id, delete_id):
    url = f"{CRAWL_SERVICE_URL}/crawl/{crawl_id}/job/{delete_id}"
    response = requests.delete(url, headers=headers)
    if response.status_code >= 300:
        raise Exception(
            f"Error deleting message: {response.status_code} {response.reason}\n{response.text}"
        )


async def save_page_content(page_id, content, links):
    submit_url = f"{CRAWL_SERVICE_URL}/page/{page_id}"
    data = json.dumps({"content": content, "links": links})
    resp = requests.put(
        submit_url, headers={**headers, "Content-Type": "application/json"}, data=data
    )
    if resp.status_code != 200:
        raise Exception(
            f"Error submitting page content: {resp.status_code} {resp.reason}\n{resp.text}"
        )


async def process_page(browser, url):
    page = await browser.new_page()
    await stealth_async(page)
    print(f"Processing {url}", flush=True)
    await page.goto(url)
    try:
        await page.wait_for_load_state("networkidle", timeout=5000)
    except Exception as e:
        pass  # If we timeout, just continue

    html = await page.content()
    links = await page.eval_on_selector_all("a", "as => as.map(a => a.href)")

    await page.close()
    return {"html": html, "links": links}


keep_alive = [True]


def stop_loop(signum, frame):
    keep_alive[0] = False


signal.signal(signal.SIGINT, stop_loop)
signal.signal(signal.SIGTERM, stop_loop)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        while keep_alive[0]:
            try:
                job = await get_next_url()
            except Exception as e:
                print(e)
                print("Failed to get next url, sleeping for 5 seconds", flush=True)
                await asyncio.sleep(5)
                continue
            if not job:
                print("No jobs found, sleeping for 5 seconds", flush=True)
                await asyncio.sleep(5)
                continue

            page_data = await process_page(browser, job["url"])
            print(
                f"Found {len(page_data['links'])} links in page of size {len(page_data['html'])}",
                flush=True,
            )
            await save_page_content(
                job["page_id"], page_data["html"], page_data["links"]
            )
            await mark_page_complete(job["crawl_id"], job["delete_id"])

        await browser.close()


asyncio.run(main())
