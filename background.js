// background.js — Service Worker for PageMind AI

// Load bundled PDF.js (converted from ESM to importScripts-compatible)
importScripts("lib/pdf.worker.js");
importScripts("lib/pdf.js");

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === "GET_PAGE_CONTENT") {
    getActiveTab().then(async (tab) => {
      if (!tab) {
        sendResponse({ error: "No readable page found. Navigate to a webpage first." });
        return;
      }

      const url = tab.url || "";
      const isPdf = looksLikePdf(url, tab.title);

      if (isPdf) {
        try {
          const content = await extractPdfFromUrl(url, tab.title);
          sendResponse({ content });
        } catch (err) {
          sendResponse({ error: "PDF read failed: " + err.message });
        }
        return;
      }

      chrome.scripting.executeScript(
        { target: { tabId: tab.id }, func: extractPageContent },
        (results) => {
          if (chrome.runtime.lastError) {
            sendResponse({ error: chrome.runtime.lastError.message });
          } else if (!results || !results[0]) {
            sendResponse({ error: "Could not read page content." });
          } else {
            sendResponse({ content: results[0].result });
          }
        }
      );
    });
    return true;
  }

});

function looksLikePdf(url, title) {
  const u = (url || "").toLowerCase();
  const t = (title || "").toLowerCase();
  return u.endsWith(".pdf") || u.includes(".pdf?") || u.includes(".pdf#")
      || u.includes("/pdf/") || t.endsWith(".pdf");
}

async function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs.find(t =>
        t.url &&
        !t.url.startsWith("chrome://") &&
        !t.url.startsWith("chrome-extension://") &&
        !t.url.startsWith("about:")
      );
      resolve(tab || null);
    });
  });
}

// ── PDF extraction using bundled PDF.js ──
async function extractPdfFromUrl(url, title) {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();

  const pdfjs = globalThis.pdfjsLib;
  if (!pdfjs) throw new Error("PDF.js failed to load");

  // Point PDF.js at the already-loaded worker
  if (globalThis.pdfjsWorker) {
    pdfjs.GlobalWorkerOptions.workerPort = null;
  }

  const loadingTask = pdfjs.getDocument({
    data: arrayBuffer,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  });

  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  let fullText = "";

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    let lastY = null;
    let pageText = `[Page ${i}]\n`;

    for (const item of textContent.items) {
      if (!item.str) continue;
      const y = item.transform ? item.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 5) {
        pageText += "\n";
      }
      pageText += item.str;
      if (item.hasEOL) pageText += "\n";
      lastY = y;
    }

    fullText += pageText + "\n\n";
  }

  const cleaned = fullText
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (cleaned.length < 20) throw new Error("No text could be extracted from this PDF");

  return {
    title: title || "PDF Document",
    url,
    text: cleaned.slice(0, 80000),
    wordCount: cleaned.split(/\s+/).filter(w => w.length > 0).length,
    pageCount: totalPages,
    isPdf: true,
  };
}

// ── Webpage extractor (injected into page) ──
function extractPageContent() {
  const skipTags = new Set(["SCRIPT","STYLE","NOSCRIPT","NAV","FOOTER","HEADER","ASIDE","IFRAME","SVG","IMG"]);
  const skipRoles = new Set(["navigation","banner","complementary","contentinfo"]);

  function getTextFromNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    if (skipTags.has(node.tagName)) return "";
    const role = node.getAttribute("role");
    if (role && skipRoles.has(role)) return "";
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return "";
    let text = "";
    for (const child of node.childNodes) text += getTextFromNode(child);
    const blockTags = new Set(["P","DIV","H1","H2","H3","H4","H5","H6","LI","TR","BR","BLOCKQUOTE","SECTION","ARTICLE"]);
    if (blockTags.has(node.tagName)) text = "\n" + text.trim() + "\n";
    return text;
  }

  const main =
    document.querySelector("main") ||
    document.querySelector("article") ||
    document.querySelector('[role="main"]') ||
    document.querySelector(".post-content,.article-content,.entry-content,#content,.content") ||
    document.body;

  const rawText = getTextFromNode(main);
  const cleaned = rawText.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();

  return {
    title: document.title,
    url: window.location.href,
    text: cleaned.slice(0, 80000),
    wordCount: cleaned.split(/\s+/).filter(w => w.length > 0).length,
    isPdf: false,
  };
}

