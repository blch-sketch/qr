(function (global) {
  "use strict";

  function CameraScanner(options) {
    this.video = options.video;
    this.onResult = options.onResult;
    this.onStatus = options.onStatus;
    this.stream = null;
    this.detector = null;
    this.running = false;
    this.lastScanAt = 0;
    this.scanInterval = options.scanInterval || 360;
    this.rafId = 0;
  }

  CameraScanner.prototype.checkSupport = async function () {
    if (!("BarcodeDetector" in global)) {
      return {
        detector: false,
        dataMatrix: false,
        formats: []
      };
    }

    var formats = [];

    if (typeof global.BarcodeDetector.getSupportedFormats === "function") {
      formats = await global.BarcodeDetector.getSupportedFormats();
    }

    return {
      detector: true,
      dataMatrix: formats.indexOf("data_matrix") !== -1,
      formats: formats
    };
  };

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

    if (!support.detector) {
      this.status("Камера работает, сканер недоступен");
      return support;
    }

    if (!support.dataMatrix) {
      this.status("Камера работает, Data Matrix недоступен");
      return support;
    }

    this.detector = new global.BarcodeDetector({ formats: ["data_matrix"] });
    this.running = true;
    this.status("Наведи камеру на код");
    this.scanLoop();
    return support;
  };

  CameraScanner.prototype.scanLoop = function () {
    var self = this;

    if (!this.running || !this.detector) {
      return;
    }

    this.rafId = global.requestAnimationFrame(async function (time) {
      if (!self.running) {
        return;
      }

      if (time - self.lastScanAt >= self.scanInterval && self.video.readyState >= 2) {
        self.lastScanAt = time;

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
        } catch (error) {
          self.status("Сканирование прервано");
        }
      }

      self.scanLoop();
    });
  };

  CameraScanner.prototype.detectImage = async function (file) {
    if (!file) {
      return null;
    }

    var support = await this.checkSupport();

    if (!support.detector || !support.dataMatrix) {
      throw new Error("Распознавание Data Matrix недоступно");
    }

    var detector = new global.BarcodeDetector({ formats: ["data_matrix"] });
    var bitmap = await createImageBitmap(file);
    var codes = await detector.detect(bitmap);

    if (typeof bitmap.close === "function") {
      bitmap.close();
    }

    if (!codes || !codes.length || !codes[0].rawValue) {
      throw new Error("Код на изображении не найден");
    }

    return codes[0].rawValue;
  };

  CameraScanner.prototype.stop = function (updateStatus) {
    if (this.rafId) {
      global.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }

    this.running = false;
    this.detector = null;

    if (this.stream) {
      this.stream.getTracks().forEach(function (track) {
        track.stop();
      });
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
