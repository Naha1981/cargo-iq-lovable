(function () {
  "use strict";
  var $ = function (id) {
    return document.getElementById(id);
  };
  var panel = $("cam-panel"),
    frame = $("cam-live"),
    video = $("cam-reference");
  if (!panel || !frame || !video) return;
  var views = {
    vetchs: {
      name: "Marina - harbour entrance",
      url: "https://restreamer.cd.net.za/c1b53a50-06bb-47da-916a-01fb19d5c547.html",
    },
    bluewaters: {
      name: "Beach - beachfront",
      url: "https://restreamer.cd.net.za/7bd8fb34-74b3-4158-abc0-06fbbc8ffb2b.html",
    },
    reference: {
      name: "Recorded player example (not Durban)",
      url: "media/railway-reference-1939.mp4",
    },
  };
  var current = "vetchs",
    timer = null,
    originFocus = null,
    generation = 0;
  function status(text) {
    $("cam-status").textContent = text;
  }
  function clearTimer() {
    if (timer) window.clearTimeout(timer);
    timer = null;
  }
  function stop() {
    generation++;
    clearTimer();
    frame.onload = null;
    frame.removeAttribute("src");
    frame.classList.add("hidden");
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.classList.add("hidden");
  }
  function open(id) {
    var wasClosed = panel.classList.contains("hidden");
    if (wasClosed) originFocus = document.activeElement;
    stop();
    current = views[id] ? id : "vetchs";
    var view = views[current],
      token = generation;
    panel.classList.remove("hidden");
    $("cam-open").setAttribute("aria-expanded", "true");
    $("cam-select").value = current;
    $("cam-title").textContent = view.name;
    $("cam-fallback").hidden = current === "reference";
    $("cam-provider").href =
      current === "reference"
        ? "https://www.openbeelden.nl/media/55132/Opening_van_de_spoorwegtentoonstelling.en"
        : view.url;
    $("cam-provider").textContent =
      current === "reference" ? "Reference source and licence" : "Open provider player";
    if (current === "reference") {
      $("cam-source").textContent =
        "RECORDED REFERENCE - historic railway exhibition footage. Not live, not Durban, not this case. Source: Open Beelden.";
      status("Loading recorded example. Press Play to start.");
      video.classList.remove("hidden");
      video.src = view.url;
      video.load();
    } else {
      $("cam-source").textContent =
        "EXTERNAL LIVE PLAYER - " +
        view.name +
        ". Position approximate. Feed timing and availability are controlled by the provider.";
      status("Loading external camera player...");
      frame.onload = function () {
        if (token !== generation || panel.classList.contains("hidden")) return;
        clearTimer();
        status(
          "Provider page loaded. Use its Play button if needed. Playback cannot be confirmed by CargoIQ; if blank or stalled, reload or open the provider.",
        );
      };
      frame.classList.remove("hidden");
      frame.src = view.url;
    }
    timer = window.setTimeout(function () {
      if (token === generation && !panel.classList.contains("hidden"))
        status(
          "This view is taking too long. Reload it, open the provider, or choose the recorded example. No footage has been saved.",
        );
    }, 15000);
    if (wasClosed) $("cam-close").focus();
  }
  function close() {
    stop();
    panel.classList.add("hidden");
    $("cam-open").setAttribute("aria-expanded", "false");
    status("");
    if (originFocus && originFocus.isConnected) originFocus.focus();
  }
  video.addEventListener("loadeddata", function () {
    if (current !== "reference" || panel.classList.contains("hidden")) return;
    clearTimer();
    status("Recorded example ready. Press Play. Not live Durban footage or case evidence.");
  });
  video.addEventListener("playing", function () {
    clearTimer();
    status("Playing recorded reference. Not live, not Durban, not case evidence.");
  });
  video.addEventListener("error", function () {
    if (current !== "reference" || panel.classList.contains("hidden")) return;
    clearTimer();
    status("Recorded example could not load. Reload or choose a live provider view.");
  });
  $("cam-open").addEventListener("click", function () {
    open(current);
  });
  $("cam-close").addEventListener("click", close);
  $("cam-select").addEventListener("change", function () {
    open(this.value);
  });
  $("cam-retry").addEventListener("click", function () {
    open(current);
  });
  $("cam-fallback").addEventListener("click", function () {
    open("reference");
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !panel.classList.contains("hidden")) close();
  });
  window.addEventListener("pagehide", stop);
  window.CargoCameraViewer = { open: open, close: close };
})();
