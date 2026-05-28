(function (global) {
  "use strict";

  // Set this after deploying the Cloudflare Worker (see worker/index.js)
  // Example: "https://marking-check.YOUR_SUBDOMAIN.workers.dev"
  var WORKER_URL = "";

  // Status values returned by the CRPT API
  var STATUS_INFO = {
    APPLIED_IN_PRODUCTION: { label: "В обороте",     tone: "warning", message: "Товар введён в оборот, данных о продаже нет." },
    INTRODUCED:            { label: "В обороте",     tone: "warning", message: "Товар введён в оборот." },
    SOLD:                  { label: "Продан",         tone: "success", message: "Товар реализован через кассу." },
    EXPORTED:              { label: "Экспортирован",  tone: "muted",   message: "Товар вывезен за пределы РФ." },
    RETIRED:               { label: "Выбыл",          tone: "danger",  message: "Товар выбыл из оборота." },
    WRITTEN_OFF:           { label: "Списан",         tone: "danger",  message: "Товар списан." },
    WITHDRAWN:             { label: "Изъят",          tone: "danger",  message: "Товар изъят из оборота." },
  };

  function mapResponse(parsed, body) {
    // The CRPT API can return the item either directly or nested.
    // We try all known envelope shapes defensively.
    var item = null;

    if (body && body.cisInfo) {
      item = body.cisInfo;
    } else if (body && Array.isArray(body.data) && body.data.length) {
      item = body.data[0];
    } else if (body && body.status && body.gtin) {
      item = body;
    }

    if (!item) {
      return null;
    }

    // Map to our internal result shape
    var status = item.status || "APPLIED_IN_PRODUCTION";
    var statusInfo = STATUS_INFO[status] || {
      label: status,
      tone: "muted",
      message: "Статус кода: " + status,
    };

    return {
      status: status,
      statusInfo: statusInfo,
      productName: item.name || item.productName || "Нет данных",
      category: item.productGroupName || item.categoryName || item.category || "-",
      manufacturer: item.producerName || item.manufacturer || "-",
      parsed: parsed,
      purchase: null,
      errors: [],
      source: "api",
    };
  }

  async function checkCode(parsed) {
    if (!WORKER_URL || !parsed || !parsed.isValid) {
      return null;
    }

    try {
      var url = new URL(WORKER_URL);
      url.searchParams.set("cis", parsed.normalized);

      var response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(11000),
      });

      if (!response.ok) {
        return null;
      }

      var body = await response.json();

      if (body.error || body.code === "NOT_FOUND") {
        return null;
      }

      return mapResponse(parsed, body);
    } catch (_) {
      return null;
    }
  }

  global.ChestnyZnakApi = {
    isConfigured: function () { return Boolean(WORKER_URL); },
    setWorkerUrl: function (url) { WORKER_URL = url; },
    getWorkerUrl: function () { return WORKER_URL; },
    checkCode: checkCode,
  };
})(window);
