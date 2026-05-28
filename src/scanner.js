(function (global) {
  "use strict";

  var ZXING_CDN = "https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js";
  var ZXING_INTERVAL = 500;

  function CameraScanner(options) {
    this.video = options.video;
    this.onResult = options.onResult;
    this.onStatus = options.onStatus;
    this.stream = null;
    this.detector = null;
    this.zxingReader = null;
    this.zxingCanvas = null;
    this.zxingCtx = null;
    this.running = false;
    this.lastScanAt = 0;
    this.scanInterval = options.scanInterval || 360;
    this.rafId = 0;
  }

  CameraScanner.prototype.checkSupport = async function () {
    var support = { detector: false, dataMatrix: false, zxing: false, formats: [] };

    if ("BarcodeDetector" in global) {
      support.detector = true;
      if (typeof global.BarcodeDetector.getSupportedFormats === "function") {
        support.formats = await global.BarcodeDetector.getSupportedFormats();
      }
      support.dataMatrix = support.formats.indexOf("data_matrix") !== -1;
    }

    support.zxing = typeof global.ZXing !== "undefined";
    return support;
  };

  function loadZxing() {
    if (typeof global.ZXing !== "undefined") {
      return Promise.resolve();
    }

    return new Promise(function (resolve) {
      var script = document.createElement("script");
      script.src = ZXING_CDN;
      script.onload = resolve;
      script.onerror = resolve; // proceed even if load fails — scanner falls back to manual input
      document.head.appendChild(script);
    });
  }

  function makeZxingReader() {
    var ZXing = global.ZXing;
    if (!ZXing || !ZXing.MultiFormatReader) return null;

    try {
      var reader = new ZXing.MultiFormatReader();
      var hints = new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.DATA_MATRIX]);
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      reader.setHints(hints);
      return reader;
    } catch (_) {
      return null;
    }
  }

  CameraScanner.prototype.start = async function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Браузер не дал доступ к камере");
    }

    this.stop();
    this.status("Запрос камеры");

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    this.video.srcObject = this.stream;
    await this.video.play();

    var support = await this.checkSupport();

    if (support.dataMatrix) {
      this.detector = new global.BarcodeDetector({ formats: ["data_matrix"] });
      this.running = true;
      this.status("Наведи камеру на код");
      this.scanLoop();
      return support;
    }

    // BarcodeDetector absent or missing data_matrix — try ZXing
    this.status("Загрузка сканера…");
    await loadZxing();
    support.zxing = typeof global.ZXing !== "undefined";

    if (support.zxing) {
      this.zxingReader = makeZxingReader();
    }

    if (this.zxingReader) {
      this.zxingCanvas = document.createElement("canvas");
      this.zxingCtx = this.zxingCanvas.getContext("2d", { willReadFrequently: true });
      this.running = true;
      this.status("Наведи камеру на код");
      this.scanLoop();
      return support;
    }

    this.status("Камера работает, сканер недоступен");
    return support;
  };

  CameraScanner.prototype.scanLoop = function () {
    var self = this;

    if (!this.running) return;

    this.rafId = global.requestAnimationFrame(async function (time) {
      if (!self.running) return;

      var interval = self.zxingReader ? ZXING_INTERVAL : self.scanInterval;

      if (time - self.lastScanAt >= interval && self.video.readyState >= 2) {
        self.lastScanAt = time;

        if (self.detector) {
          try {
            var codes = await self.detector.detect(self.video);
            if (codes && codes.length) {
              var raw = codes[0].rawValue || codes[0].rawData || "";
              if (raw) {
                self.status("Код распознан");
                self.stop(false);
                self.onResult(raw, "camera");
                return;
              }
            }
          } catch (_) {
            self.status("Сканирование прервано");
          }
        } else if (self.zxingReader && self.zxingCanvas) {
          try {
            self.zxingCanvas.width = self.video.videoWidth || 640;
            self.zxingCanvas.height = self.video.videoHeight || 480;
            self.zxingCtx.drawImage(self.video, 0, 0);
            var ZXing = global.ZXing;
            var luminance = new ZXing.HTMLCanvasElementLuminanceSource(self.zxingCanvas);
            var bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(luminance));
            var result = self.zxingReader.decode(bitmap);
            if (result) {
              self.status("Код распознан");
              self.stop(false);
              self.onResult(result.getText(), "camera");
              return;
            }
          } catch (_) {
            // ZXing.NotFoundException on every frame without a code — that's normal
          }
        }
      }

      self.scanLoop();
    });
  };

  CameraScanner.prototype.detectImage = async function (file) {
    if (!file) return null;

    var support = await this.checkSupport();

    if (support.dataMatrix) {
      var detector = new global.BarcodeDetector({ formats: ["data_matrix"] });
      var bmp = await createImageBitmap(file);
      var codes = await detector.detect(bmp);
      if (typeof bmp.close === "function") bmp.close();
      if (!codes || !codes.length || !codes[0].rawValue) {
        throw new Error("Код на изображении не найден");
      }
      return codes[0].rawValue;
    }

    // ZXing image decode
    if (!support.zxing) {
      await loadZxing();
    }

    var reader = makeZxingReader();
    if (!reader) {
      throw new Error("Распознавание Data Matrix недоступно");
    }

    try {
      var bmp2 = await createImageBitmap(file);
      var canvas = document.createElement("canvas");
      canvas.width = bmp2.width;
      canvas.height = bmp2.height;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(bmp2, 0, 0);
      if (typeof bmp2.close === "function") bmp2.close();

      var ZXing = global.ZXing;
      var luminance = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
      var bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(luminance));
      var result = reader.decode(bitmap);
      return result.getText();
    } catch (_) {
      throw new Error("Код на изображении не найден");
    }
  };

  CameraScanner.prototype.stop = function (updateStatus) {
    if (this.rafId) {
      global.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }

    this.running = false;
    this.detector = null;
    this.zxingReader = null;
    this.zxingCanvas = null;
    this.zxingCtx = null;

    if (this.stream) {
      this.stream.getTracks().forEach(function (track) { track.stop(); });
      this.stream = null;
    }

    if (this.video) {
      this.video.srcObject = null;
    }

    if (updateStatus !== false) {
      this.status("Готово");
    }
  };

  CameraScanner.prototype.status = function (message) {
    if (typeof this.onStatus === "function") {
      this.onStatus(message);
    }
  };

  global.CameraScanner = CameraScanner;
})(window);
