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
      clearButton: document.getElementById("clearButton"),
      manualInput: document.getElementById("manualInput"),
      checkManualButton: document.getElementById("checkManualButton"),
      sampleClearButton: document.getElementById("sampleClearButton"),
      demoCodes: document.getElementById("demoCodes"),
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
    renderDemoCodes();
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
    elements.checkManualButton.addEventListener("click", function () {
      handleRawCode(elements.manualInput.value, "manual");
    });
    elements.sampleClearButton.addEventListener("click", function () {
      elements.manualInput.value = "";
      elements.manualInput.focus();
    });
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

      if (support.detector && support.dataMatrix) {
        setSupportBadge("Data Matrix", "success");
      } else if (support.detector) {
        setSupportBadge("Нет Data Matrix", "warning");
      } else {
        setSupportBadge("Ручной ввод", "muted");
      }
    } catch (error) {
      setSupportBadge("Ручной ввод", "muted");
    }
  }

  async function startCamera() {
    setBusy(true);

    try {
      var support = await scanner.start();
      elements.cameraShell.classList.add("is-live");
      elements.startCameraButton.disabled = true;
      elements.stopCameraButton.disabled = false;

      if (support && support.detector && support.dataMatrix) {
        setSupportBadge("Data Matrix", "success");
      } else if (support && support.detector) {
        setSupportBadge("Нет Data Matrix", "warning");
      } else {
        setSupportBadge("Ручной ввод", "muted");
      }
    } catch (error) {
      setScanStatus(error.message || "Камера недоступна");
      setSupportBadge("Ручной ввод", "muted");
      stopCamera();
    } finally {
      setBusy(false);
    }
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
    var parsed = MarkingCodeParser.parse(raw);

    elements.manualInput.value = MarkingCodeParser.codeForDisplay(parsed.normalized || raw);

    var result = null;

    if (ChestnyZnakApi.isConfigured() && parsed.isValid) {
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
    }

    setScanStatus(source === "camera" ? "Проверка завершена" : "Готово");
    renderResult(result);
  }

  function renderDemoCodes() {
    elements.demoCodes.innerHTML = "";

    DemoRegistry.demoCodes.forEach(function (demo) {
      var button = document.createElement("button");
      button.className = "demo-code";
      button.type = "button";
      button.innerHTML = "<span>" + escapeHtml(demo.title) + "</span><small>" + escapeHtml(demo.caption) + "</small>";
      button.addEventListener("click", function () {
        elements.manualInput.value = MarkingCodeParser.codeForDisplay(demo.raw);
        handleRawCode(demo.raw, "demo");
      });
      elements.demoCodes.appendChild(button);
    });
  }

  function renderResult(result) {
    var parsed = result.parsed;
    var statusInfo = result.statusInfo;
    var fields = [
      ["GTIN", parsed.data.gtin || "-"],
      ["Серийный номер", parsed.data.serial || "-"],
      ["Категория", result.category || "-"],
      ["Производитель", result.manufacturer || "-"]
    ];

    if (parsed.data.expiryDate) {
      fields.push(["Срок годности", parsed.data.expiryDate]);
    }

    if (parsed.data.batch) {
      fields.push(["Партия", parsed.data.batch]);
    }

    var messageClass = result.status === "INVALID"
      ? "message is-danger"
      : result.status === "NOT_FOUND" || result.status === "IN_CIRCULATION"
        ? "message is-warning"
        : "message";

    elements.emptyResult.hidden = true;
    elements.resultContent.hidden = false;
    var sourceBadge = result.source === "api"
      ? "<span class=\"source-badge is-api\">Честный ЗНАК</span>"
      : "<span class=\"source-badge\">Demo</span>";

    elements.resultContent.innerHTML = [
      "<div class=\"result-top\">",
      "  <div class=\"status-row\">",
      "    <span class=\"status-pill is-" + escapeHtml(statusInfo.tone) + "\">" + escapeHtml(statusInfo.label) + "</span>",
      "    " + sourceBadge,
      "  </div>",
      "  <h2>" + escapeHtml(result.productName) + "</h2>",
      "  <p>" + escapeHtml(result.category) + " · " + escapeHtml(result.manufacturer) + "</p>",
      "  <p class=\"" + messageClass + "\">" + escapeHtml(getResultMessage(result)) + "</p>",
      "</div>",
      renderFields(fields),
      renderPurchase(result.purchase),
      "<div class=\"raw-code\">" + escapeHtml(parsed.displayCode || "") + "</div>"
    ].join("");
    renderIcons();
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

  function renderPurchase(purchase) {
    if (!purchase) {
      return [
        "<div class=\"purchase-block\">",
        "  <strong>Покупка</strong>",
        "  <p class=\"purchase-note\">Нет данных в демо-реестре</p>",
        "</div>"
      ].join("");
    }

    return [
      "<div class=\"purchase-block\">",
      "  <strong>Покупка</strong>",
      "  <p>" + escapeHtml(DemoRegistry.formatDateTime(purchase.date)) + "</p>",
      "  <p class=\"purchase-note\">" + escapeHtml(purchase.store) + "</p>",
      "</div>"
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
    elements.manualInput.value = "";
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
