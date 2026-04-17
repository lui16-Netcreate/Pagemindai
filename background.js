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

  if (message.type === "ASK_AI") {
    askClaude(message.apiKey, message.context, message.question, message.history)
      .then((answer) => sendResponse({ answer }))
      .catch((err) => sendResponse({ error: err.message }));
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
    chrome.tabs.query({ active: true }, (tabs) => {
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

// ── Smart content trimmer ──
function getRelevantContent(text, question) {
  const CHAR_LIMIT = 20000;

  // If text fits, use it all
  if (text.length <= CHAR_LIMIT) return text;

  const qLower = question.toLowerCase();

  // Detect page number references — send a larger chunk around that area
  const pageMatch = qLower.match(/pages?\s*(\d+)(?:\s*[-–to]+\s*(\d+))?/);
  if (pageMatch) {
    const startPage = parseInt(pageMatch[1]);
    const endPage   = parseInt(pageMatch[2] || pageMatch[1]);

    // Find [Page N] markers inserted during extraction and slice that region
    const pageMarkers = [...text.matchAll(/\[Page (\d+)\]/g)];
    if (pageMarkers.length > 0) {
      let startIdx = 0, endIdx = text.length;

      for (let i = 0; i < pageMarkers.length; i++) {
        const pg = parseInt(pageMarkers[i][1]);
        if (pg <= startPage) startIdx = pageMarkers[i].index;
        if (pg === endPage + 1 && endIdx === text.length) endIdx = pageMarkers[i].index;
      }

      const pageSection = text.slice(startIdx, endIdx);
      // Add intro context
      const intro = text.slice(0, 800);
      return (intro + "\n...\n" + pageSection).slice(0, CHAR_LIMIT * 2);
    }
  }

  // Detect section references — find that section heading and extract around it
  const sectionMatch = qLower.match(/section\s*([\d.]+)/);
  if (sectionMatch) {
    const sectionNum = sectionMatch[1];
    const sectionRe = new RegExp(`\\b${sectionNum.replace('.', '\\.')}\\s`, 'i');
    const idx = text.search(sectionRe);
    if (idx > 0) {
      const intro = text.slice(0, 800);
      const section = text.slice(Math.max(0, idx - 200), idx + CHAR_LIMIT);
      return (intro + "\n...\n" + section).slice(0, CHAR_LIMIT * 2);
    }
  }

  // Generic keyword scoring for all other questions
  const stopWords = new Set(["what","is","are","the","a","an","of","in","on","at","to","for",
    "and","or","but","how","why","when","where","who","which","does","do","did","was","were",
    "has","have","had","can","could","would","should","will","tell","me","about","give","list",
    "summarize","summary","describe","explain","overview"]);

  const keywords = qLower
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  if (keywords.length === 0) return text.slice(0, CHAR_LIMIT);

  const paragraphs = text.split(/\n{1,2}/);
  const scored = paragraphs.map((para, idx) => {
    const lower = para.toLowerCase();
    const score = keywords.reduce((s, kw) => {
      const exact = (lower.match(new RegExp(`\\b${kw}\\b`, "g")) || []).length;
      return s + exact * 2 + (lower.includes(kw) ? 1 : 0);
    }, 0);
    return { idx, score, para };
  });

  const top = scored
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 30)
    .sort((a, b) => a.idx - b.idx);

  if (top.length === 0) return text.slice(0, CHAR_LIMIT);

  const firstIdx = Math.max(0, top[0].idx - 3);
  const lastIdx  = Math.min(paragraphs.length - 1, top[top.length - 1].idx + 3);
  let window = paragraphs.slice(firstIdx, lastIdx + 1).join("\n");

  const intro = text.slice(0, 800);
  return (intro + "\n...\n" + window).slice(0, CHAR_LIMIT);
}

// ── Claude API ──
async function askClaude(apiKey, context, question, history) {
  const docType = context.isPdf ? `PDF DOCUMENT (${context.pageCount} pages)` : "WEBPAGE";
  const relevantContent = getRelevantContent(context.text, question);
  const isTrimmed = relevantContent.length < context.text.length;

  const systemPrompt = `You are PageMind, an intelligent reading assistant. The user is viewing a ${docType}.

TITLE: ${context.title}
URL: ${context.url}
WORD COUNT: ~${context.wordCount} words${isTrimmed ? " (showing most relevant section)" : ""}

CONTENT:
---
${relevantContent}
---

Answer questions based on this content. Be concise but thorough. If the answer isn't in the content, say so clearly. Use markdown formatting when helpful.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [...history, { role: "user", content: question }],
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "API request failed");
  }

  const data = await response.json();
  return data.content[0].text;
}
