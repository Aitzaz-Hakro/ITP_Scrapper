(() => {
  if (window.ITPUtils) {
    return;
  }

  const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

  function sleep(minMs, maxMs) {
    const duration =
      typeof maxMs === "number"
        ? Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
        : minMs;

    return new Promise((resolve) => setTimeout(resolve, Math.max(0, duration)));
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function cleanField(value) {
    return normalizeText(value).replace(/,/g, " ");
  }

  function getFirstElement(selectors, root = document) {
    if (!selectors) return null;

    const list = Array.isArray(selectors) ? selectors : [selectors];
    for (const selector of list) {
      const element = root.querySelector(selector);
      if (element) return element;
    }

    return null;
  }

  function getTextFromElement(element) {
    if (!element) return "";

    const aria = element.getAttribute("aria-label");
    if (aria && aria.trim()) {
      return normalizeText(aria);
    }

    return normalizeText(element.innerText || element.textContent || "");
  }

  function getFirstText(selectors, root = document) {
    const element = getFirstElement(selectors, root);
    return cleanField(getTextFromElement(element));
  }

  async function waitForElement(selectors, options = {}) {
    const { root = document, timeout = 10000 } = options;
    const existing = getFirstElement(selectors, root);
    if (existing) return existing;

    return new Promise((resolve) => {
      let settled = false;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        if (timerId) clearTimeout(timerId);
        resolve(value || null);
      };

      const observer = new MutationObserver(() => {
        const found = getFirstElement(selectors, root);
        if (found) finish(found);
      });

      observer.observe(root, {
        childList: true,
        subtree: true,
      });

      const timerId = setTimeout(() => finish(null), timeout);
    });
  }

  function extractEmails(text) {
    const source = String(text || "");
    const results = source.match(EMAIL_REGEX) || [];
    const cleaned = results
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email && !email.endsWith(".png") && !email.endsWith(".jpg"));

    return [...new Set(cleaned)];
  }

  function uniqueBy(items, keyFn) {
    const map = new Map();
    for (const item of items || []) {
      const key = keyFn(item);
      if (!map.has(key)) {
        map.set(key, item);
      }
    }
    return [...map.values()];
  }

  function escapeCsvCell(value) {
    const text = normalizeText(value);
    const escaped = text.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  function toCsv(rows, headers) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const headerEntries = headers || [
      ["name", "Name"],
      ["rating", "Rating"],
      ["address", "Address"],
      ["email", "Email"],
      ["phone", "Phone Number"],
      ["website", "Website URL"],
      ["lastReview", "Last Review Text"],
    ];

    const headerLine = headerEntries.map((entry) => escapeCsvCell(entry[1])).join(",");

    const bodyLines = safeRows.map((row) =>
      headerEntries
        .map(([key]) => {
          return escapeCsvCell(row[key] || "");
        })
        .join(",")
    );

    return [headerLine, ...bodyLines].join("\n");
  }

  function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  function parsePlaceKeyFromUrl(url) {
    try {
      const decoded = decodeURIComponent(String(url || ""));
      const match = decoded.match(/\/maps\/place\/([^/?]+)/i);
      if (match && match[1]) return match[1].toLowerCase();
      return decoded.toLowerCase();
    } catch {
      return String(url || "").toLowerCase();
    }
  }

  function withTimeout(taskPromise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout")), ms);
      taskPromise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  window.ITPUtils = {
    sleep,
    cleanField,
    normalizeText,
    getFirstElement,
    getFirstText,
    getTextFromElement,
    waitForElement,
    extractEmails,
    uniqueBy,
    toCsv,
    downloadBlob,
    parsePlaceKeyFromUrl,
    withTimeout,
  };
})();
