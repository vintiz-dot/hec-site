/* Student recording page: capture or choose a video, review it, then send it in small
   pieces to a Google Apps Script, which saves it to the teacher's private Drive folder.
   Small pieces mean a dropped connection only repeats the piece it interrupted. */
(function () {
  "use strict";

  var MAX_SECONDS = 180;
  var MAX_BYTES = 300 * 1024 * 1024;
  var CHUNK_BYTES = 4 * 1024 * 1024; // Drive needs a multiple of 256 KB
  var MAX_TRIES = 5;
  var REQUEST_TIMEOUT_MS = 90 * 1000;
  var SLOW_AFTER_MS = 15 * 1000;
  var slowTimer = null;
  var EXTENSIONS = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/x-m4v": "m4v", "video/3gpp": "3gp" };

  var $ = function (id) { return document.getElementById(id); };
  var screens = ["screenWho", "screenCapture", "screenReview", "screenSending", "screenDone"];

  var stream = null, recorder = null, chunks = [], ticking = null, startedAt = 0, countdown = null;
  var video = null; // { blob, type, ext, source, seconds }
  var playbackUrl = null, job = null, inflight = null, leaveGuard = false;

  function show(id) {
    screens.forEach(function (s) { $(s).hidden = s !== id; });
    window.scrollTo(0, 0);
  }

  /* Status text exists in both languages so the language switch keeps working on it. */
  function say(box, en, vi, code) {
    box.textContent = "";
    if (!en) return;
    [["en", en], ["vi", vi]].forEach(function (pair) {
      var s = document.createElement("span");
      s.className = pair[0];
      s.textContent = pair[1];
      box.appendChild(s);
    });
    if (code) {
      var c = document.createElement("div");
      c.className = "code";
      c.textContent = code;
      box.appendChild(c);
    }
  }

  /* ---------- Step 1: who ---------- */
  $("whoForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!$("studentName").value.trim() || !$("className").value.trim()) {
      say($("whoMsg"), "Please type the student's name and class.", "Vui lòng nhập tên và lớp của học sinh.");
      return;
    }
    if (!$("consent").checked) {
      say($("whoMsg"), "Please tick the box so we can receive the video.", "Vui lòng đánh dấu vào ô đồng ý để gửi được video.");
      return;
    }
    say($("whoMsg"));
    show("screenCapture");
  });
  $("backToWho").addEventListener("click", function () { stopCamera(); show("screenWho"); });

  /* Zalo and Facebook open links in their own browser, which usually blocks the camera. */
  if (/Zalo|FBAN|FBAV|FB_IAB|Messenger|Instagram/i.test(navigator.userAgent)) {
    $("appHint").hidden = false;
    say($("appHint"),
      "If the camera does not work, open this link in Chrome or Safari. You can also choose a video you already filmed.",
      "Nếu máy quay không hoạt động, hãy mở liên kết này bằng Chrome hoặc Safari. Bạn cũng có thể chọn video đã quay sẵn.");
  }

  /* ---------- Step 2: camera ---------- */
  function canRecord() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  function pickMime() {
    var options = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    for (var i = 0; i < options.length; i++) {
      if (MediaRecorder.isTypeSupported(options[i])) return options[i];
    }
    return "";
  }

  function stopCamera() {
    if (countdown) { clearInterval(countdown); countdown = null; $("count").hidden = true; }
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    recorder = null;
    clearInterval(ticking);
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    $("live").srcObject = null;
    $("live").hidden = true;
    $("placeholder").hidden = false;
    $("rec").hidden = true;
    $("btnCamera").hidden = false;
    $("btnStart").hidden = true;
    $("btnStop").hidden = true;
    $("fileArea").hidden = false;
  }

  $("btnCamera").addEventListener("click", function () {
    say($("camMsg"));
    if (!canRecord()) {
      say($("camMsg"),
        "This browser cannot record video. Please choose a video you already filmed, or open this page in Chrome or Safari.",
        "Trình duyệt này không quay được video. Vui lòng chọn video đã quay sẵn, hoặc mở trang này bằng Chrome hoặc Safari.");
      return;
    }
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: { echoCancellation: true, noiseSuppression: true }
    }).then(function (s) {
      stream = s;
      var live = $("live");
      live.srcObject = s;
      live.hidden = false;
      $("placeholder").hidden = true;
      $("btnCamera").hidden = true;
      $("btnStart").hidden = false;
      var p = live.play();
      if (p && p.catch) p.catch(function () { /* autoplay attribute covers this */ });
    }).catch(function (err) {
      console.error("Camera error", err);
      if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
        say($("camMsg"),
          "The camera or microphone is blocked. Allow them in your browser settings, then try again.",
          "Máy quay hoặc micrô đang bị chặn. Hãy cho phép trong cài đặt trình duyệt, rồi thử lại.");
      } else if (err && err.name === "NotFoundError") {
        say($("camMsg"),
          "No camera or microphone was found on this device. Please choose a video you already filmed.",
          "Không tìm thấy máy quay hoặc micrô trên thiết bị này. Vui lòng chọn video đã quay sẵn.");
      } else {
        say($("camMsg"),
          "The camera could not start. Close other apps using it and try again, or choose a video you already filmed.",
          "Không bật được máy quay. Hãy đóng các ứng dụng khác đang dùng máy quay rồi thử lại, hoặc chọn video đã quay sẵn.");
      }
    });
  });

  $("btnStart").addEventListener("click", function () {
    $("btnStart").hidden = true;
    $("fileArea").hidden = true;
    var n = 3, box = $("count");
    box.textContent = n;
    box.hidden = false;
    countdown = setInterval(function () {
      n--;
      if (n > 0) { box.textContent = n; return; }
      clearInterval(countdown);
      countdown = null;
      box.hidden = true;
      beginRecording();
    }, 1000);
  });

  function formatClock(total) {
    var m = Math.floor(total / 60), s = Math.floor(total % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function beginRecording() {
    var mime = pickMime();
    chunks = [];
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 1500000 } : { videoBitsPerSecond: 1500000 });
    } catch (err) {
      console.error("Recorder error", err);
      stopCamera();
      say($("camMsg"),
        "This browser cannot record video. Please choose a video you already filmed.",
        "Trình duyệt này không quay được video. Vui lòng chọn video đã quay sẵn.");
      return;
    }
    recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = finishRecording;
    recorder.start(1000);
    startedAt = Date.now();
    $("clock").textContent = "0:00";
    $("rec").hidden = false;
    $("btnStop").hidden = false;
    ticking = setInterval(function () {
      var secs = (Date.now() - startedAt) / 1000;
      $("clock").textContent = formatClock(secs);
      if (secs >= MAX_SECONDS && recorder && recorder.state === "recording") recorder.stop();
    }, 250);
  }

  $("btnStop").addEventListener("click", function () {
    if (recorder && recorder.state === "recording") recorder.stop();
  });

  function finishRecording() {
    var seconds = Math.round((Date.now() - startedAt) / 1000);
    var type = (recorder.mimeType || "video/webm").split(";")[0];
    var blob = new Blob(chunks, { type: type });
    chunks = [];
    recorder = null;
    stopCamera();
    if (!blob.size) {
      say($("camMsg"), "Nothing was recorded. Please try again.", "Chưa quay được gì. Vui lòng thử lại.");
      return;
    }
    openReview({ blob: blob, type: type, ext: EXTENSIONS[type] || "webm", source: "recorded", seconds: seconds });
  }

  /* ---------- Step 2: choose a file ---------- */
  $("btnFile").addEventListener("click", function () { $("fileInput").click(); });

  $("fileInput").addEventListener("change", function () {
    var file = this.files && this.files[0];
    this.value = "";
    say($("fileMsg"));
    if (!file) return;
    var nameExt = (file.name.split(".").pop() || "").toLowerCase();
    var type = file.type;
    if (!type) type = nameExt === "mov" ? "video/quicktime" : nameExt === "webm" ? "video/webm" : nameExt === "mp4" || nameExt === "m4v" ? "video/mp4" : "";
    if (type.indexOf("video/") !== 0) {
      say($("fileMsg"), "That file is not a video. Please choose a video.", "Tệp này không phải là video. Vui lòng chọn một video.");
      return;
    }
    if (file.size > MAX_BYTES) {
      say($("fileMsg"),
        "That video is too big (over 300 MB). Please film it again at a lower quality, or record it on this page.",
        "Video quá lớn (trên 300 MB). Vui lòng quay lại với chất lượng thấp hơn, hoặc quay ngay trên trang này.");
      return;
    }
    stopCamera();
    openReview({ blob: file, type: type, ext: EXTENSIONS[type] || (/^[a-z0-9]{2,5}$/.test(nameExt) ? nameExt : "mp4"), source: "uploaded", seconds: 0 });
  });

  /* ---------- Step 3: review ---------- */
  function openReview(v) {
    video = v;
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    playbackUrl = URL.createObjectURL(v.blob);
    var player = $("playback");
    player.src = playbackUrl;
    if (!v.seconds) {
      player.onloadedmetadata = function () {
        if (isFinite(player.duration)) video.seconds = Math.round(player.duration);
      };
    } else {
      player.onloadedmetadata = null;
    }
    $("reviewFor").textContent = $("studentName").value.trim() + " · " + $("className").value.trim();
    show("screenReview");
  }

  function backToCapture() {
    $("playback").pause();
    $("playback").removeAttribute("src");
    $("playback").load();
    video = null;
    if (playbackUrl) { URL.revokeObjectURL(playbackUrl); playbackUrl = null; }
    show("screenCapture");
  }
  $("btnRetake").addEventListener("click", backToCapture);

  /* ---------- Upload ---------- */
  function clearSlow() {
    clearTimeout(slowTimer);
    say($("slowMsg"));
  }

  function waitingMessage() {
    say($("slowMsg"), "Still trying to connect. Please wait…", "Vẫn đang kết nối. Vui lòng chờ…");
  }

  function uploadFailed(err) {
    console.error("Upload error", err);
    clearSlow();
    leaveGuard = false;
    var code = err && err.code ? err.code : "";
    $("btnRetry").hidden = false;
    if (code === "network") {
      say($("sendMsg"),
        "The internet connection is too weak. Your video is still here. Check the connection and try again.",
        "Kết nối mạng quá yếu. Video của bạn vẫn còn ở đây. Hãy kiểm tra mạng và gửi lại.", code);
    } else if (code === "storage-full" || code === "daily-limit") {
      say($("sendMsg"),
        "The teacher's video folder cannot take more videos right now. Your video is still here. Please contact your teacher.",
        "Thư mục video của thầy cô tạm thời không nhận thêm video. Video vẫn còn ở đây. Vui lòng liên hệ thầy cô.", code);
    } else {
      say($("sendMsg"),
        "The video could not be sent. It is still here, so please try again. If it keeps failing, contact your teacher.",
        "Chưa gửi được video. Video vẫn còn ở đây, vui lòng gửi lại. Nếu vẫn không được, hãy liên hệ thầy cô.", code);
    }
  }

  /* text/plain keeps this a simple request, which Apps Script can answer across sites. */
  function call(body) {
    var control = new AbortController();
    inflight = control;
    var timer = setTimeout(function () { control.abort(); }, REQUEST_TIMEOUT_MS);
    return fetch(window.CLOTHES_UPLOAD_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      signal: control.signal
    }).then(function (response) {
      return response.json();
    }).catch(function (err) {
      console.error("Connection error", err);
      throw { code: "network", retry: true };
    }).then(function (result) {
      clearTimeout(timer);
      if (!result.ok) throw { code: result.code || "server-error", retry: !!result.retry };
      return result;
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  function readPiece(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).split(",")[1] || ""); };
      reader.onerror = function () { reject({ code: "read-failed" }); };
      reader.readAsDataURL(blob);
    });
  }

  function showProgress(j) {
    var pct = Math.min(100, Math.round(j.offset / j.video.blob.size * 100));
    $("pct").textContent = pct + "%";
    $("barFill").style.width = pct + "%";
  }

  function finished(j) {
    if (j !== job) return;
    job = null;
    clearSlow();
    leaveGuard = false;
    backToCaptureState();
    show("screenDone");
  }

  function sendPieces(j) {
    if (j !== job) return null;
    if (!j.token) {
      return call({
        action: "start",
        size: j.video.blob.size,
        type: j.video.type,
        ext: j.video.ext,
        source: j.video.source,
        seconds: j.video.seconds || 0,
        studentName: $("studentName").value.trim(),
        className: $("className").value.trim()
      }).then(function (result) {
        j.token = result.token;
        j.offset = 0;
        return sendPieces(j);
      });
    }
    return readPiece(j.video.blob.slice(j.offset, j.offset + CHUNK_BYTES)).then(function (data) {
      if (j !== job) return null;
      return call({ action: "chunk", token: j.token, offset: j.offset, data: data }).then(function (result) {
        j.tries = 0;
        if (j === job) clearSlow();
        if (result.done) { finished(j); return null; }
        j.offset = result.next;
        showProgress(j);
        return sendPieces(j);
      });
    });
  }

  function run(j) {
    var work;
    try { work = sendPieces(j); } catch (err) { work = Promise.reject(err); }
    Promise.resolve(work).catch(function (err) { recover(j, err); });
  }

  function recover(j, err) {
    if (j !== job) return;
    if (err.code === "expired") {
      j.token = null;
      j.offset = 0;
      showProgress(j);
    }
    if ((err.retry || err.code === "expired") && j.tries < MAX_TRIES) {
      j.tries++;
      waitingMessage();
      setTimeout(function () { resume(j); }, 2000 * j.tries);
      return;
    }
    uploadFailed(err);
  }

  /* After a failure, ask how much actually arrived before sending anything again. */
  function resume(j) {
    if (j !== job) return;
    if (!j.token) { run(j); return; }
    call({ action: "status", token: j.token }).then(function (result) {
      if (j !== job) return;
      if (result.done) { finished(j); return; }
      j.offset = result.next;
      showProgress(j);
      run(j);
    }).catch(function (err) { recover(j, err); });
  }

  function send() {
    say($("sendMsg"));
    $("btnRetry").hidden = true;
    $("playback").pause();
    show("screenSending");
    if (!job || job.video !== video) job = { video: video, token: null, offset: 0, tries: 0 };
    showProgress(job);

    if (!window.CLOTHES_UPLOAD_URL) {
      uploadFailed({ code: "upload-not-set-up" });
      return;
    }
    leaveGuard = true;
    job.tries = 0;
    clearTimeout(slowTimer);
    slowTimer = setTimeout(waitingMessage, SLOW_AFTER_MS);
    if (job.token) resume(job); else run(job);
  }

  function backToCaptureState() {
    $("playback").removeAttribute("src");
    $("playback").load();
    video = null;
    if (playbackUrl) { URL.revokeObjectURL(playbackUrl); playbackUrl = null; }
  }

  $("btnSend").addEventListener("click", send);
  $("btnRetry").addEventListener("click", send);
  $("btnCancel").addEventListener("click", function () {
    job = null;
    if (inflight) inflight.abort();
    clearSlow();
    leaveGuard = false;
    show("screenReview");
  });
  $("btnAnother").addEventListener("click", function () { show("screenCapture"); });

  window.addEventListener("beforeunload", function (e) {
    if (leaveGuard) { e.preventDefault(); e.returnValue = ""; }
  });
  window.addEventListener("pagehide", function () {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
  });
})();
