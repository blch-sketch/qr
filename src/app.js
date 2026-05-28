(function () {
  "use strict";

  var elements = {};
  var scanner = null;
  var deferredInstallPrompt = null;

  document.addEventListener("DOMContentLoaded", function () {
    elements = {
      cameraShell: document.getElementById("cameraShell"),
      video: document.getElementById("cameraPreview"),
      cameraPlaceholder: document.getElementById("cameraPlaceholder"),
      scanStatus: document.getElementById("scanStatus"),
      supportBadge: document.getElementById("supportBadge"),
      startCameraButton: document.getElementById("startCameraButton"),
      stopCameraButton: document.getElementById("stopCameraButton"),
      uploadImageButton: document.getElementById("uploadImageButton"),
      imageInput: document.getElementById("imageInput"),
      receiptChip: document.getElementById("receiptChip"),
      clearButton: document.getElementById("clearButton"),
      emptyResult: document.getElementById("emptyResult"),
      resultContent: document.getElementById("resultContent"),
      installButton: document.getElementById("installButton")
    };

    scanner = new CameraScanner({
      video: elements.video,
      onResult: handleRawCode,
      onStatus: setScanStatus
    });

    bindEvents();
    renderReceiptChip();
    refreshScannerSupport();
    registerServiceWorker();
    renderIcons();
  });

  function bindEvents() {
    elements.startCameraButton.addEventListener("click", startCamera);
    elements.stopCameraButton.addEventListener("click", stopCamera);
    elements.uploadImageButton.addEventListener("click", function () {
      elements.imageInput.click();
    });
    elements.clearButton.addEventListener("click", clearResult);
    elements.imageInput.addEventListener("change", handleImageUpload);

    window.addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault();
      deferredInstallPrompt = event;
      elements.installButton.hidden = false;
    });

    elements.installButton.addEventListener("click", async function () {
      if (!deferredInstallPrompt) {
        return;
      }

      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      elements.installButton.hidden = true;
    });
  }

  async function refreshScannerSupport() {
    try {
      var support = await scanner.checkSupport();
      applyBadgeFromSupport(support);
    } catch (_) {
      setSupportBadge("Нет сканера", "muted");
    }
  }

  async function startCamera() {
    setBusy(true);

    try {
      var support = await scanner.start();
      elements.cameraShell.classList.add("is-live");
      elements.startCameraButton.disabled = true;
      elements.stopCameraButton.disabled = false;
      applyBadgeFromSupport(support);
    } catch (error) {
      setScanStatus(error.message || "Камера недоступна");
      setSupportBadge("Нет сканера", "muted");
      stopCamera();
    } finally {
      setBusy(false);
    }
  }

  function applyBadgeFromSupport(support) {
    if (!support) { setSupportBadge("Нет сканера", "muted"); return; }
    if (support.dataMatrix && support.qrCode) { setSupportBadge("DM + QR", "success"); return; }
    if (support.dataMatrix) { setSupportBadge("Data Matrix", "success"); return; }
    if (support.qrCode) { setSupportBadge("QR", "success"); return; }
    if (support.zxing)      { setSupportBadge("ZXing",       "warning"); return; }
    if (support.detector)   { setSupportBadge("Нет Data Matrix", "warning"); return; }
    setSupportBadge("Нет сканера", "muted");
  }

  function stopCamera() {
    scanner.stop();
    elements.cameraShell.classList.remove("is-live");
    elements.startCameraButton.disabled = false;
    elements.stopCameraButton.disabled = true;
  }

  async function handleImageUpload(event) {
    var file = event.target.files && event.target.files[0];

    if (!file) {
      return;
    }

    setScanStatus("Проверяем фото");

    try {
      var raw = await scanner.detectImage(file);
      handleRawCode(raw, "image");
    } catch (error) {
      renderError(error.message || "Код на изображении не найден");
      setScanStatus("Код не найден");
    } finally {
      elements.imageInput.value = "";
    }
  }

  async function handleRawCode(raw, source) {
    if (source === "camera") {
      stopCamera();
    }

    var receipt = typeof ReceiptParser !== "undefined" ? ReceiptParser.parse(raw) : { isReceipt: false };

    if (receipt.isReceipt) {
      ReceiptParser.save(receipt);
      setScanStatus("Чек сохранен");
      renderReceiptChip();
      renderReceiptResult(receipt);
      return;
    }

    var parsed = MarkingCodeParser.parse(raw);

    var result = null;
    var liveApiRequested = false;

    if (typeof ChestnyZnakApi !== "undefined" && ChestnyZnakApi.isConfigured() && shouldTryLiveApi(parsed)) {
      liveApiRequested = true;
      setScanStatus("Запрос в Честный ЗНАК…");
      setBusy(true);
      try {
        result = await ChestnyZnakApi.checkCode(parsed);
      } finally {
        setBusy(false);
      }
    }

    if (!result) {
      result = DemoRegistry.resolveParsedCode(parsed);

      if (liveApiRequested && typeof ChestnyZnakApi.getLastError === "function") {
        result.apiError = ChestnyZnakApi.getLastError();
      }
    }

    setScanStatus(source === "camera" ? "Проверка завершена" : "Готово");
    renderResult(result);
  }

  function shouldTryLiveApi(parsed) {
    if (!parsed || !parsed.normalized) {
      return false;
    }

    return parsed.isValid
      || Boolean(parsed.data && parsed.data.gtin)
      || /01\d{14}/.test(parsed.normalized)
      || parsed.normalized.length >= 18;
  }

  function renderReceiptChip() {
    if (!elements.receiptChip || typeof ReceiptParser === "undefined") {
      return;
    }

    var receipt = ReceiptParser.getSaved();

    if (!receipt || !receipt.dateIso) {
      elements.receiptChip.hidden = true;
      elements.receiptChip.innerHTML = "";
      return;
    }

    elements.receiptChip.hidden = false;
    elements.receiptChip.innerHTML = [
      "<i data-lucide=\"receipt-text\"></i>",
      "<span>Чек: " + escapeHtml(DemoRegistry.formatDateTime(receipt.dateIso)) + "</span>",
      "<button type=\"button\" id=\"clearReceiptButton\" title=\"Очистить чек\" aria-label=\"Очистить чек\">",
      "  <i data-lucide=\"x\"></i>",
      "</button>"
    ].join("");

    var clearButton = document.getElementById("clearReceiptButton");
    if (clearButton) {
      clearButton.addEventListener("click", function () {
        ReceiptParser.clearSaved();
        renderReceiptChip();
      });
    }

    renderIcons();
  }

  function renderReceiptResult(receipt) {
    elements.emptyResult.hidden = true;
    elements.resultContent.hidden = false;
    elements.resultContent.innerHTML = [
      "<div class=\"result-top\">",
      "  <div class=\"status-row\">",
      "    <span class=\"status-pill is-success\">Чек распознан</span>",
      "    <span class=\"source-badge\">QR чека</span>",
      "  </div>",
      "  <h2>QR чека распознан</h2>",
      "  <p>Дата ниже относится к кассовому чеку.</p>",
      "</div>",
      renderFields(receiptFields(receipt)),
      "<div class=\"raw-code\">" + escapeHtml(receipt.displayCode || receipt.raw || "") + "</div>"
    ].join("");
    renderIcons();
  }

  function receiptFields(receipt) {
    var fields = [
      ["Дата и время", DemoRegistry.formatDateTime(receipt.dateIso) || receipt.dateRaw || "-"],
      ["Сумма", receipt.amountLabel || receipt.amount || "-"],
      ["Операция", receipt.operationLabel || "-"],
      ["ФН", receipt.fn || "-"],
      ["ФД", receipt.fd || "-"],
      ["ФП", receipt.fp || "-"]
    ];

    return fields;
  }

  function renderResult(result) {
    var parsed = result.parsed;
    var statusInfo = result.statusInfo;
    var registryFields = buildRegistryFields(result);
    var decodeTone = parsed.isValid ? "success" : result.source === "api" ? "warning" : "danger";
    var decodeLabel = parsed.isValid ? "Расшифрован" : result.source === "api" ? "Проверен" : "Ошибка";
    var decodeMessageClass = result.status === "INVALID"
      ? "message is-danger"
      : result.status === "IN_CIRCULATION"
        ? "message is-warning"
        : result.status === "NOT_FOUND"
          ? "message is-info"
          : "message";

    elements.emptyResult.hidden = true;
    elements.resultContent.hidden = false;

    elements.resultContent.innerHTML = [
      "<div class=\"result-top\">",
      "  <div class=\"status-row\">",
      "    <span class=\"status-pill is-" + escapeHtml(decodeTone) + "\">" + escapeHtml(decodeLabel) + "</span>",
      "    <span class=\"source-badge\">GS1 DataMatrix</span>",
      "  </div>",
      "  <h2>Расшифровка кода</h2>",
      "  <p>" + escapeHtml(getDecodeSummary(parsed)) + "</p>",
      "  <p class=\"" + decodeMessageClass + "\">" + escapeHtml(getResultMessage(result)) + "</p>",
      "</div>",
      renderDecodedFields(parsed),
      renderRegistryBlock(result, registryFields, statusInfo),
      "<div class=\"raw-code\">" + escapeHtml(parsed.displayCode || "") + "</div>"
    ].join("");
    renderIcons();
  }

  function buildRegistryFields(result) {
    var parsed = result.parsed;
    var fields = [
      ["GTIN", parsed.data.gtin || result.gtin || "-"],
      ["Серийный номер", parsed.data.serial || result.serial || "-"],
      ["Категория", result.category || "-"],
      ["Производитель", result.manufacturer || "-"]
    ];

    if (parsed.data.expiryDate) {
      fields.push(["Срок годности", parsed.data.expiryDate]);
    }

    if (parsed.data.batch) {
      fields.push(["Партия", parsed.data.batch]);
    }

    return fields;
  }

  function getDecodeSummary(parsed) {
    if (!parsed.fields.length) {
      return "В строке не удалось найти GS1 Application Identifiers.";
    }

    var aiList = parsed.fields.map(function (field) { return field.ai; }).join(", ");
    return "Найдены AI-поля: " + aiList + ". Ниже показано, что означает каждое поле.";
  }

  function renderDecodedFields(parsed) {
    if (!parsed.fields.length) {
      return "<section class=\"decode-block\"><p class=\"message is-danger\">Нет полей для расшифровки.</p></section>";
    }

    return [
      "<section class=\"decode-block\">",
      "  <h3>Поля внутри кода</h3>",
      "  <div class=\"decode-list\">",
      parsed.fields.map(renderDecodedField).join(""),
      "  </div>",
      "</section>"
    ].join("");
  }

  function renderDecodedField(field) {
    return [
      "<article class=\"decode-item\">",
      "  <span class=\"decode-ai\">AI " + escapeHtml(field.ai) + "</span>",
      "  <div>",
      "    <strong>" + escapeHtml(field.label) + "</strong>",
      "    <code>" + escapeHtml(field.displayValue || field.value || "-") + "</code>",
      "    <p>" + escapeHtml(field.description || "") + "</p>",
      "  </div>",
      "</article>"
    ].join("");
  }

  function renderRegistryBlock(result, fields, statusInfo) {
    var sourceBadge = result.source === "api"
      ? "<span class=\"source-badge is-api\">Честный ЗНАК</span>"
      : "<span class=\"source-badge\">Локально</span>";

    return [
      "<section class=\"registry-block\">",
      "  <div class=\"registry-heading\">",
      "    <div>",
      "      <p class=\"eyebrow\">Реестр</p>",
      "      <h3>" + escapeHtml(result.productName) + "</h3>",
      "    </div>",
      "    <div class=\"registry-badges\">",
      "      <span class=\"status-pill is-" + escapeHtml(statusInfo.tone) + "\">" + escapeHtml(statusInfo.label) + "</span>",
      "      " + sourceBadge,
      "    </div>",
      "  </div>",
      renderFields(fields),
      renderApiNotice(result),
      renderApiDebug(result),
      "</section>"
    ].join("");
  }

  function renderApiNotice(result) {
    if (!result.apiError) {
      return "";
    }

    return [
      "<p class=\"api-notice\">",
      "Живая проверка не ответила: ",
      escapeHtml(result.apiError),
      ". Показана локальная расшифровка кода.",
      "</p>"
    ].join("");
  }

  function renderFields(fields) {
    return "<dl class=\"field-grid\">" + fields.map(function (field) {
      return [
        "<div class=\"field\">",
        "  <dt>" + escapeHtml(field[0]) + "</dt>",
        "  <dd>" + escapeHtml(field[1]) + "</dd>",
        "</div>"
      ].join("");
    }).join("") + "</dl>";
  }

function renderApiDebug(result) {
    if (result.source !== "api" || !result.apiDebug) {
      return "";
    }

    return [
      "<details class=\"api-debug\">",
      "  <summary>Ответ Live API</summary>",
      "  <pre>" + escapeHtml(result.apiDebug) + "</pre>",
      "</details>"
    ].join("");
  }

  function getResultMessage(result) {
    if (result.errors && result.errors.length) {
      return result.errors.join(". ");
    }

    return result.statusInfo.message;
  }

  function renderError(message) {
    var parsed = MarkingCodeParser.parse("");
    renderResult({
      status: "INVALID",
      statusInfo: {
        label: "Ошибка",
        tone: "danger",
        message: message
      },
      productName: "Проверка не выполнена",
      category: "Сканер",
      manufacturer: "Браузер",
      parsed: parsed,
      purchase: null,
      errors: [message]
    });
  }

  function clearResult() {
    elements.emptyResult.hidden = false;
    elements.resultContent.hidden = true;
    elements.resultContent.innerHTML = "";
    setScanStatus("Готово");
  }

  function setBusy(isBusy) {
    elements.startCameraButton.disabled = isBusy || elements.stopCameraButton.disabled === false;
  }

  function setScanStatus(message) {
    elements.scanStatus.textContent = message;
  }

  function setSupportBadge(label, tone) {
    elements.supportBadge.textContent = label;
    elements.supportBadge.className = "badge";

    if (tone) {
      elements.supportBadge.classList.add("is-" + tone);
    }
  }

  function renderIcons() {
    if (globalThis.lucide && typeof globalThis.lucide.createIcons === "function") {
      globalThis.lucide.createIcons();
    }
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
