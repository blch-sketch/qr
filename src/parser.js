(function (global) {
  "use strict";

  var GS = String.fromCharCode(29);
  var AI_SPECS = {
    "01": { key: "gtin", label: "GTIN", length: 14, fixed: true, numeric: true },
    "17": { key: "expiryDateRaw", label: "Срок годности", length: 6, fixed: true, numeric: true },
    "10": { key: "batch", label: "Партия", max: 20, fixed: false },
    "21": { key: "serial", label: "Серийный номер", max: 20, fixed: false },
    "91": { key: "verificationKey", label: "Ключ проверки", length: 4, fixed: true },
    "92": { key: "verificationCode", label: "Код проверки", max: 88, fixed: false }
  };
  var KNOWN_AIS = Object.keys(AI_SPECS);
  var NEXT_AI_HINTS = {
    "10": ["17", "21", "91", "92"],
    "21": ["17", "91", "92"],
    "92": []
  };

  function normalizeRawCode(raw) {
    return String(raw || "")
      .trim()
      .replace(/\r?\n/g, "")
      .replace(/%1D/gi, GS)
      .replace(/\\u001d/gi, GS)
      .replace(/\\x1d/gi, GS)
      .replace(/<GS>/gi, GS)
      .replace(/\[GS\]/gi, GS)
      .replace(/\{GS\}/gi, GS)
      .replace(/␝/g, GS)
      .replace(/^]d2/i, "")
      .replace(/^]Q3/i, "");
  }

  function codeForDisplay(raw) {
    return String(raw || "").replace(new RegExp(GS, "g"), "<GS>");
  }

  function parseMarkingCode(raw) {
    var normalized = normalizeRawCode(raw);
    var fields = normalized.indexOf("(") !== -1 ? parseParenthesized(normalized) : parseCompact(normalized);
    return buildResult(raw, normalized, fields);
  }

  function parseParenthesized(text) {
    var fields = [];
    var re = /\((\d{2})\)([^()]+)/g;
    var match;

    while ((match = re.exec(text)) !== null) {
      if (AI_SPECS[match[1]]) {
        fields.push({
          ai: match[1],
          value: cleanupValue(match[2]),
          position: match.index
        });
      }
    }

    if (fields.length === 0) {
      return parseCompact(text.replace(/[()]/g, ""));
    }

    return fields;
  }

  function parseCompact(text) {
    var source = text.replace(/[ \t]+/g, "");
    var start = findGs1Start(source);
    var fields = [];
    var index = start;

    while (index < source.length) {
      if (source[index] === GS) {
        index += 1;
        continue;
      }

      var ai = readKnownAi(source, index);

      if (!ai) {
        break;
      }

      var spec = AI_SPECS[ai];
      var valueStart = index + ai.length;
      var valueEnd = spec.fixed
        ? valueStart + spec.length
        : findVariableEnd(source, valueStart, ai, spec.max);
      var value = cleanupValue(source.slice(valueStart, valueEnd));

      fields.push({
        ai: ai,
        value: value,
        position: index
      });

      index = valueEnd;
    }

    return fields;
  }

  function findGs1Start(source) {
    if (source.slice(0, 2) === "01") {
      return 0;
    }

    var match = source.match(/01\d{14}/);
    return match ? match.index : 0;
  }

  function readKnownAi(source, index) {
    for (var i = 0; i < KNOWN_AIS.length; i += 1) {
      var ai = KNOWN_AIS[i];
      if (source.slice(index, index + ai.length) === ai) {
        return ai;
      }
    }

    return null;
  }

  function findVariableEnd(source, start, ai, max) {
    var gsIndex = source.indexOf(GS, start);
    var maxEnd = Math.min(source.length, start + max);

    if (gsIndex !== -1 && gsIndex <= maxEnd) {
      return gsIndex;
    }

    var hints = NEXT_AI_HINTS[ai] || [];
    var nextHint = -1;

    for (var i = 0; i < hints.length; i += 1) {
      var marker = hints[i];
      var minValueLength = ai === "21" ? 3 : 1;
      var searchFrom = start + minValueLength;
      var found = source.indexOf(marker, searchFrom);

      while (found !== -1 && found <= maxEnd) {
        if (looksLikeAiAt(source, found, marker)) {
          nextHint = nextHint === -1 ? found : Math.min(nextHint, found);
          break;
        }

        found = source.indexOf(marker, found + 1);
      }
    }

    if (nextHint !== -1) {
      return nextHint;
    }

    return maxEnd;
  }

  function looksLikeAiAt(source, index, ai) {
    var spec = AI_SPECS[ai];
    var valueStart = index + ai.length;

    if (!spec) {
      return false;
    }

    if (spec.fixed) {
      var value = source.slice(valueStart, valueStart + spec.length);
      return value.length === spec.length && (!spec.numeric || /^\d+$/.test(value));
    }

    return valueStart < source.length;
  }

  function cleanupValue(value) {
    return String(value || "").replace(new RegExp(GS, "g"), "").trim();
  }

  function buildResult(raw, normalized, fields) {
    var data = {};
    var errors = [];
    var warnings = [];

    fields.forEach(function (field) {
      var spec = AI_SPECS[field.ai];
      if (spec && data[spec.key] === undefined) {
        data[spec.key] = field.value;
      }
    });

    if (!fields.length) {
      errors.push("Не найдены поля GS1 DataMatrix");
    }

    if (!data.gtin) {
      errors.push("GTIN не найден");
    } else if (!/^\d{14}$/.test(data.gtin)) {
      errors.push("GTIN должен содержать 14 цифр");
    }

    if (!data.serial) {
      errors.push("Серийный номер не найден");
    }

    if (data.expiryDateRaw) {
      data.expiryDate = formatGs1Date(data.expiryDateRaw);
      if (!data.expiryDate) {
        warnings.push("Срок годности не удалось разобрать");
      }
    }

    return {
      raw: raw,
      normalized: normalized,
      displayCode: codeForDisplay(normalized),
      fields: fields,
      data: data,
      errors: errors,
      warnings: warnings,
      isValid: errors.length === 0
    };
  }

  function formatGs1Date(value) {
    if (!/^\d{6}$/.test(value)) {
      return "";
    }

    var year = Number(value.slice(0, 2));
    var month = Number(value.slice(2, 4));
    var day = Number(value.slice(4, 6));
    var fullYear = year >= 70 ? 1900 + year : 2000 + year;

    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return "";
    }

    return [
      String(day).padStart(2, "0"),
      String(month).padStart(2, "0"),
      String(fullYear)
    ].join(".");
  }

  global.MarkingCodeParser = {
    GS: GS,
    parse: parseMarkingCode,
    normalize: normalizeRawCode,
    codeForDisplay: codeForDisplay
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.MarkingCodeParser;
  }
})(typeof window !== "undefined" ? window : globalThis);
