(function (global) {
  "use strict";

  // If CORS blocks the direct call, set this to your Cloudflare Worker URL.
  // Leave empty to try the CRPT API directly from the browser first.
  var WORKER_URL = "";

  var CRPT_DIRECT = "https://mobile.api.crptech.ru/api/v3/check";

  var STATUS_INFO = {
    APPLIED_IN_PRODUCTION: { label: "В обороте",    tone: "warning", message: "Товар введён в оборот, данных о продаже нет." },
    INTRODUCED:            { label: "В обороте",    tone: "warning", message: "Товар введён в оборот." },
    SOLD:                  { label: "Продан",        tone: "success", message: "Товар реализован через кассу." },
    EXPORTED:              { label: "Экспортирован", tone: "muted",   message: "Товар вывезен за пределы РФ." },
    RETIRED:               { label: "Выбыл",         tone: "danger",  message: "Товар выбыл из оборота." },
    WRITTEN_OFF:           { label: "Списан",        tone: "danger",  message: "Товар списан." },
    WITHDRAWN:             { label: "Изъят",         tone: "danger",  message: "Товар изъят из оборота." },
  };

  function endpointUrl(cis) {
    var base = WORKER_URL || CRPT_DIRECT;
    var url = new URL(base);
    url.searchParams.set("cis", cis);
    return url.toString();
  }

  function mapResponse(parsed, body) {
    var item = body.cisInfo
      || (Array.isArray(body.data) && body.data[0])
      || (body.status && body.gtin ? body : null);

    if (!item) {
      return null;
    }

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
    if (!parsed || !parsed.isValid) {
      return null;
    }

    try {
      var response = await fetch(endpointUrl(parsed.normalized), {
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
      // CORS block or network error → fall through to mock
      return null;
    }
  }

  global.ChestnyZnakApi = {
    // Always enabled — tries direct CRPT call, falls back to mock on any error
    isConfigured: function () { return true; },
    setWorkerUrl: function (url) { WORKER_URL = url; },
    getWorkerUrl: function () { return WORKER_URL; },
    checkCode: checkCode,
  };
})(window);
