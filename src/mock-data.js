(function (global) {
  "use strict";

  var GS = global.MarkingCodeParser.GS;

  var demoCodes = [
    {
      id: "sold",
      title: "Покупка найдена",
      caption: "Товар продан",
      raw: "010460123456789321A1B2C3D4E5" + GS + "91ABCD" + GS + "92DEMOCRYPTO1234567890"
    },
    {
      id: "no-purchase",
      title: "Без покупки",
      caption: "Товар в обороте",
      raw: "010460987654321321ZXCV98765" + GS + "91WXYZ" + GS + "92DEMOCRYPTO0987654321"
    },
    {
      id: "unknown",
      title: "Не найден",
      caption: "Структура корректна",
      raw: "010460700111222821UNKNOWN42" + GS + "91QWER" + GS + "92NOTINREGISTRY"
    },
    {
      id: "invalid",
      title: "Ошибка",
      caption: "Нет серийного номера",
      raw: "010460123456789391ABCD92BROKEN"
    }
  ];

  var products = [
    {
      gtin: "04601234567893",
      serial: "A1B2C3D4E5",
      productName: "Молоко пастеризованное 3.2%",
      category: "Молочная продукция",
      manufacturer: "ООО Демоферма",
      status: "SOLD",
      purchase: {
        date: "2026-05-21T18:42:00+10:00",
        store: "Демо Маркет, Владивосток"
      }
    },
    {
      gtin: "04609876543213",
      serial: "ZXCV98765",
      productName: "Кроссовки детские RunStep",
      category: "Обувь",
      manufacturer: "АО Демо Обувь",
      status: "IN_CIRCULATION",
      purchase: null
    }
  ];

  var statusMap = {
    SOLD: {
      label: "Продан",
      tone: "success",
      message: "Покупка найдена в демо-реестре."
    },
    IN_CIRCULATION: {
      label: "В обороте",
      tone: "warning",
      message: "Товар найден, данных о покупке в демо-реестре нет."
    },
    NOT_FOUND: {
      label: "Не найден",
      tone: "danger",
      message: "Код структурно похож на маркировку, но в демо-реестре его нет."
    },
    INVALID: {
      label: "Некорректный код",
      tone: "danger",
      message: "Строка не похожа на полный код маркировки."
    }
  };

  function resolveParsedCode(parsed) {
    if (!parsed.isValid) {
      return {
        status: "INVALID",
        statusInfo: statusMap.INVALID,
        productName: "Код не распознан",
        category: "Проверка структуры",
        manufacturer: "Локальный парсер",
        parsed: parsed,
        purchase: null,
        errors: parsed.errors
      };
    }

    var record = findProduct(parsed.data.gtin, parsed.data.serial);

    if (!record) {
      return {
        status: "NOT_FOUND",
        statusInfo: statusMap.NOT_FOUND,
        productName: "Код не найден",
        category: "Нет данных",
        manufacturer: "Демо-реестр",
        parsed: parsed,
        purchase: null,
        errors: []
      };
    }

    return {
      status: record.status,
      statusInfo: statusMap[record.status],
      productName: record.productName,
      category: record.category,
      manufacturer: record.manufacturer,
      parsed: parsed,
      purchase: record.purchase,
      errors: []
    };
  }

  function findProduct(gtin, serial) {
    for (var i = 0; i < products.length; i += 1) {
      if (products[i].gtin === gtin && products[i].serial === serial) {
        return products[i];
      }
    }

    return null;
  }

  function formatDateTime(iso) {
    if (!iso) {
      return "";
    }

    var date = new Date(iso);

    if (Number.isNaN(date.getTime())) {
      return iso;
    }

    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  global.DemoRegistry = {
    demoCodes: demoCodes,
    products: products,
    resolveParsedCode: resolveParsedCode,
    formatDateTime: formatDateTime
  };
})(window);
