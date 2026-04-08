(() => {
  if (window.__ITP_SCRAPPER_INIT__) {
    return;
  }
  window.__ITP_SCRAPPER_INIT__ = true;

  const state =
    window.__ITP_SCRAPPER_STATE__ ||
    {
      isRunning: false,
      shouldStop: false,
      status: "Idle",
      statusText: "Ready",
      progress: 0,
      targetLimit: 100,
      logs: [],
      rows: [],
      exportFormat: "csv",
    };

  window.__ITP_SCRAPPER_STATE__ = state;

  const ACTION_DELAY_MIN = 800;
  const ACTION_DELAY_MAX = 1500;

  const SELECTORS = {
    listingFeed: [
      'div[role="feed"]',
      'div[aria-label*="Results"][role="feed"]',
      'div[aria-label*="results"][role="feed"]',
      'div[aria-label*="Results"] div[role="feed"]',
    ],
    listingLinks: ['a[href*="/maps/place/"]'],
    detailName: ['h1.DUwDvf', 'h1[class][aria-level="1"]', 'h1'],
    rating: [
      'div[role="main"] span[role="img"][aria-label*="star"]',
      'div[role="main"] span[aria-label*="stars"]',
      'div[role="main"] div.F7nice span[aria-hidden="true"]',
    ],
    addressButton: [
      'button[data-item-id="address"]',
      'button[aria-label^="Address:"]',
      'div[role="main"] button[data-item-id="address"]',
      'div[role="main"] [data-item-id="address"]',
    ],
    phoneButton: [
      'button[data-item-id^="phone"]',
      'button[aria-label^="Phone:"]',
      'div[role="main"] [data-item-id*="phone"]',
    ],
    websiteLink: [
      'a[data-item-id="authority"]',
      'a[data-item-id*="authority"]',
      'a[aria-label^="Website:"]',
    ],
    inlineReview: [
      'div[role="main"] div[data-review-id] span.wiI7pd',
      'div[role="main"] span.wiI7pd',
      'div[role="main"] div.MyEned',
    ],
    reviewsButton: [
      'button[aria-label*="reviews"]',
      'button[jsaction*="pane.reviewChart.moreReviews"]',
      'button[data-tab-index="1"]',
    ],
    reviewsDialog: ['div[role="dialog"]', 'div.m6QErb[aria-label*="Reviews"]', 'div[aria-label*="Reviews"]'],
    reviewText: [
      'div[role="dialog"] div[data-review-id] span.wiI7pd',
      'div[role="dialog"] div[data-review-id] span',
      'div[role="dialog"] div.MyEned',
    ],
  };

  function sendRuntime(type, payload = {}) {
    chrome.runtime.sendMessage({
      source: "itp-scrapper",
      type,
      ...payload,
    });
  }

  function addLog(message, level = "info") {
    const line = `${new Date().toLocaleTimeString()} - ${message}`;
    state.logs.push(line);
    if (state.logs.length > 200) {
      state.logs = state.logs.slice(-200);
    }

    if (level === "error") {
      console.error(`[ITP Scrapper] ${line}`);
    } else if (level === "warn") {
      console.warn(`[ITP Scrapper] ${line}`);
    } else {
      console.log(`[ITP Scrapper] ${line}`);
    }

    sendRuntime("SCRAPE_LOG", { log: line });
  }

  function setStatus(status, statusText) {
    state.status = status;
    state.statusText = statusText;

    sendRuntime("SCRAPE_STATUS", {
      status,
      statusText,
      progress: state.progress,
      targetLimit: state.targetLimit,
      scraped: state.rows.length,
    });
  }

  function emitProgress() {
    sendRuntime("SCRAPE_PROGRESS", {
      progress: state.progress,
      targetLimit: state.targetLimit,
      scraped: state.rows.length,
    });
  }

  function getListingFeed() {
    return ITPUtils.safeQuerySelector(SELECTORS.listingFeed);
  }

  function getListingAnchors(feed) {
    if (!feed) return [];

    const anchors = [...feed.querySelectorAll(SELECTORS.listingLinks[0])].filter((anchor) => {
      const href = anchor.getAttribute("href") || "";
      return href.includes("/maps/place/");
    });

    const byKey = new Map();
    for (const anchor of anchors) {
      const key = ITPUtils.parsePlaceKeyFromUrl(anchor.href || anchor.getAttribute("href"));
      if (!byKey.has(key)) {
        byKey.set(key, anchor);
      }
    }

    return [...byKey.values()];
  }

  async function openListing(anchor) {
    if (!anchor) return false;

    try {
      const listingTitle = ITPUtils.cleanText(anchor.getAttribute("aria-label") || anchor.innerText || "Listing");
      addLog(`Clicking listing: ${listingTitle}`);
      anchor.scrollIntoView({ behavior: "smooth", block: "center" });
      await ITPUtils.sleep(ACTION_DELAY_MIN, ACTION_DELAY_MAX);
      anchor.click();
      await ITPUtils.sleep(ACTION_DELAY_MIN, ACTION_DELAY_MAX);
      return true;
    } catch (error) {
      addLog(`Failed to click listing: ${error.message || "Unknown error"}`, "warn");
      return false;
    }
  }

  async function waitForDetailsReady() {
    for (let i = 0; i < 18; i += 1) {
      const name = ITPUtils.getFirstText(SELECTORS.detailName);
      if (name) return true;
      await ITPUtils.sleep(350, 700);
    }
    return false;
  }

  function getRatingValue() {
    const ratingElement = ITPUtils.safeQuerySelector(SELECTORS.rating);
    if (!ratingElement) return "";

    const source =
      ratingElement.getAttribute("aria-label") ||
      ratingElement.textContent ||
      ratingElement.innerText ||
      "";

    const valueMatch = source.match(/[0-9]+([.,][0-9]+)?/);
    return ITPUtils.cleanText(valueMatch ? valueMatch[0].replace(",", ".") : source);
  }

  function readAriaValue(element, prefix) {
    if (!element) return "";
    const aria = element.getAttribute("aria-label") || "";
    if (!aria) return "";

    return ITPUtils.cleanText(aria.replace(new RegExp(`^${prefix}\\s*`, "i"), ""));
  }

  function extractAddress() {
    const button = ITPUtils.safeQuerySelector(SELECTORS.addressButton);
    if (!button) return "";

    const candidates = [];

    const explicitValueNode =
      button.querySelector(".fontBodyMedium") ||
      button.querySelector('[class*="fontBodyMedium"]') ||
      button.querySelector("div");

    if (explicitValueNode) {
      candidates.push(explicitValueNode.textContent || "");
    }

    const ariaAddress = readAriaValue(button, "Address:");
    if (ariaAddress) {
      candidates.push(ariaAddress);
    }

    candidates.push(button.textContent || "");

    for (const candidate of candidates) {
      const cleaned = ITPUtils.cleanAddress(candidate);
      if (cleaned) {
        return cleaned;
      }
    }

    return "";
  }

  function extractPhone() {
    const button = ITPUtils.safeQuerySelector(SELECTORS.phoneButton);
    if (!button) return "";

    const fromAria = readAriaValue(button, "Phone:");
    if (fromAria) {
      return ITPUtils.cleanPhone(fromAria);
    }

    return ITPUtils.cleanPhone(button.textContent || "");
  }

  function extractWebsite() {
    const websiteElement = ITPUtils.safeQuerySelector(SELECTORS.websiteLink);
    if (!websiteElement) return "";

    const href = websiteElement.getAttribute("href") || "";
    if (href.startsWith("http")) {
      return ITPUtils.cleanText(href);
    }

    return ITPUtils.cleanText(readAriaValue(websiteElement, "Website:"));
  }

  function extractEmailFromDetailsPanel() {
    const mailto = document.querySelector('a[href^="mailto:"]');
    if (mailto) {
      return ITPUtils.cleanText((mailto.getAttribute("href") || "").replace(/^mailto:/i, ""));
    }

    const mainPanel = document.querySelector('div[role="main"]');
    const panelText = mainPanel ? mainPanel.innerText : "";

    return ITPUtils.extractEmailFromHTML(panelText);
  }

  async function extractEmailFromWebsite(websiteUrl) {
    if (!websiteUrl || !/^https?:\/\//i.test(websiteUrl)) return "";

    try {
      const response = await ITPUtils.withTimeout(
        fetch(websiteUrl, {
          method: "GET",
          redirect: "follow",
          credentials: "omit",
          mode: "cors",
        }),
        8000
      );

      if (!response.ok) {
        addLog(`Website fetch failed (${response.status}) for email extraction.`, "warn");
        return "";
      }

      const html = await ITPUtils.withTimeout(response.text(), 6000);
      return ITPUtils.extractEmailFromHTML(html);
    } catch (error) {
      addLog(`Email extraction fallback triggered (${error.message || "CORS/Timeout"}).`, "warn");
      return "";
    }
  }

  function getFirstVisibleReviewText(dialog) {
    const reviewElements = ITPUtils.safeQuerySelectorAll(SELECTORS.reviewText, dialog);
    for (const node of reviewElements) {
      const rect = node.getBoundingClientRect();
      const text = ITPUtils.cleanText(node.textContent || node.innerText || "");
      if (rect.width > 0 && rect.height > 0 && text) {
        return text;
      }
    }
    return "";
  }

  async function extractLatestVisibleReview() {
    const inlineReview = ITPUtils.getFirstText(SELECTORS.inlineReview);
    if (inlineReview) {
      return ITPUtils.cleanText(inlineReview);
    }

    const reviewsButton = ITPUtils.safeQuerySelector(SELECTORS.reviewsButton);
    if (!reviewsButton) return "";

    try {
      reviewsButton.click();
      await ITPUtils.sleep(ACTION_DELAY_MIN, ACTION_DELAY_MAX);

      const dialog = await ITPUtils.waitForElement(SELECTORS.reviewsDialog, { timeout: 5000 });
      if (!dialog) return "";

      dialog.scrollBy({ top: 320, behavior: "smooth" });
      await ITPUtils.sleep(800, 1200);

      const reviewText = getFirstVisibleReviewText(dialog);

      const closeButton = dialog.querySelector('button[aria-label="Close"]');
      if (closeButton) {
        closeButton.click();
      } else {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      }

      await ITPUtils.sleep(350, 700);
      return ITPUtils.cleanText(reviewText);
    } catch (error) {
      addLog(`Review extraction failed: ${error.message || "Unknown"}`, "warn");
      return "";
    }
  }

  async function extractBusinessDetails() {
    const ready = await waitForDetailsReady();
    if (!ready) {
      return null;
    }

    const name = ITPUtils.cleanText(ITPUtils.getFirstText(SELECTORS.detailName));
    const rating = ITPUtils.cleanText(getRatingValue());
    const address = ITPUtils.cleanAddress(extractAddress());
    const phone = ITPUtils.cleanPhone(extractPhone());
    const website = ITPUtils.cleanText(extractWebsite());

    let email = ITPUtils.cleanText(extractEmailFromDetailsPanel());
    if (!email && website) {
      email = ITPUtils.cleanText(await extractEmailFromWebsite(website));
    }

    const lastReview = ITPUtils.cleanText(await extractLatestVisibleReview());

    return {
      name,
      rating,
      address,
      email,
      phone,
      website,
      lastReview,
    };
  }

  async function scrapeListings() {
    const feed = getListingFeed() || (await ITPUtils.waitForElement(SELECTORS.listingFeed, { timeout: 15000 }));
    if (!feed) {
      throw new Error("Google Maps listing panel was not detected.");
    }

    const processed = new Set();
    const results = [];

    let noNewItemsCycles = 0;

    while (!state.shouldStop && results.length < state.targetLimit && noNewItemsCycles < 18) {
      const listingAnchors = getListingAnchors(feed);
      let cycleNewCount = 0;

      for (const anchor of listingAnchors) {
        if (state.shouldStop || results.length >= state.targetLimit) {
          break;
        }

        const key = ITPUtils.parsePlaceKeyFromUrl(anchor.href || anchor.getAttribute("href"));
        if (!key || processed.has(key)) {
          continue;
        }

        processed.add(key);
        const opened = await openListing(anchor);
        if (!opened) {
          continue;
        }

        try {
          const row = await extractBusinessDetails();
          if (!row) {
            addLog("Skipped listing because detail panel did not fully load.", "warn");
            continue;
          }

          if (!row.name && !row.address) {
            addLog("Skipped listing because both name and address were empty.", "warn");
            continue;
          }

          results.push(row);
          cycleNewCount += 1;

          state.rows = results;
          state.progress = results.length;

          addLog(`Extracted data: ${JSON.stringify(row)}`);
          emitProgress();

          await ITPUtils.sleep(ACTION_DELAY_MIN, ACTION_DELAY_MAX);
        } catch (error) {
          addLog(`Skipped one listing due to parsing error: ${error.message || "Unknown"}`, "error");
        }
      }

      if (state.shouldStop || results.length >= state.targetLimit) {
        break;
      }

      const beforeScrollCount = getListingAnchors(feed).length;
      feed.scrollBy({ top: Math.max(feed.clientHeight * 0.82, 620), behavior: "smooth" });
      await ITPUtils.sleep(ACTION_DELAY_MIN, ACTION_DELAY_MAX);

      const afterScrollCount = getListingAnchors(feed).length;
      if (cycleNewCount === 0 && afterScrollCount <= beforeScrollCount) {
        noNewItemsCycles += 1;
      } else {
        noNewItemsCycles = 0;
      }
    }

    return ITPUtils.uniqueBy(results, (item) =>
      `${(item.name || "").toLowerCase()}__${(item.address || "").toLowerCase()}`
    );
  }

  function exportRows(rows, format) {
    const normalizedFormat = ["csv", "json", "both"].includes(format) ? format : "csv";

    if (normalizedFormat === "csv" || normalizedFormat === "both") {
      const csv = ITPUtils.toCsv(rows);
      ITPUtils.downloadCsv(csv, "itp_scrapper_data.csv");
    }

    if (normalizedFormat === "json" || normalizedFormat === "both") {
      const json = JSON.stringify(rows, null, 2);
      ITPUtils.downloadBlob(json, "itp_scrapper_data.json", "application/json");
    }
  }

  async function runScraper(config = {}) {
    if (state.isRunning) {
      return {
        ok: false,
        message: "Scraper is already running.",
      };
    }

    state.isRunning = true;
    state.shouldStop = false;
    state.rows = [];
    state.progress = 0;
    state.targetLimit = Number(config.limit) > 0 ? Number(config.limit) : 100;
    state.exportFormat = config.exportFormat || "csv";
    state.logs = [];

    setStatus("Running", "Scanning listings and extracting details...");
    addLog(`Scrape started with limit ${state.targetLimit}`);

    try {
      const rows = await scrapeListings();
      state.rows = rows;
      state.progress = rows.length;

      if (state.shouldStop) {
        setStatus("Idle", "Scraping stopped by user.");
        addLog("Scraping stopped before completion.");
        return {
          ok: true,
          stopped: true,
          rows,
        };
      }

      exportRows(rows, state.exportFormat);

      setStatus("Completed", `Completed. ${rows.length} businesses scraped.`);
      emitProgress();
      addLog("Data export complete.");

      sendRuntime("SCRAPE_DONE", {
        rows,
        count: rows.length,
        exportFormat: state.exportFormat,
      });

      return {
        ok: true,
        rows,
      };
    } catch (error) {
      setStatus("Error", error.message || "Scraping failed.");
      addLog(`Error: ${error.message || "Unknown"}`, "error");
      return {
        ok: false,
        error: error.message || "Unknown error",
      };
    } finally {
      state.isRunning = false;
      state.shouldStop = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return;

    if (message.type === "PING") {
      sendResponse({ ok: true, source: "itp-scrapper-content" });
      return;
    }

    if (message.type === "GET_STATUS") {
      sendResponse({
        ok: true,
        state: {
          isRunning: state.isRunning,
          status: state.status,
          statusText: state.statusText,
          progress: state.progress,
          targetLimit: state.targetLimit,
          rowsCount: state.rows.length,
          logs: state.logs.slice(-50),
        },
      });
      return;
    }

    if (message.type === "STOP_SCRAPING") {
      state.shouldStop = true;
      setStatus("Idle", "Stop requested. Finishing current step...");
      addLog("Stop requested by popup.");
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "START_SCRAPING") {
      runScraper(message.config || {}).then((result) => {
        sendResponse(result);
      });
      return true;
    }

    if (message.type === "EXPORT_LAST") {
      if (!state.rows.length) {
        sendResponse({ ok: false, message: "No data to export." });
        return;
      }
      exportRows(state.rows, message.format || state.exportFormat || "csv");
      sendResponse({ ok: true, count: state.rows.length });
      return;
    }
  });
})();
