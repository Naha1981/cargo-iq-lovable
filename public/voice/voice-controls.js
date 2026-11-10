/* Free runtime: browser speech input and bundled audio only. No TTS or model API. */
(function (root) {
  const cargoPages = {
    documents: "documents",
    definitions: "definitions",
    counts: "counts",
    clocks: "clocks",
    timeline: "",
    financials: "financials",
    recovery: "recovery",
    evidence: "pack",
    map: "map",
    harbour: "map",
  };
  function intent(raw, product) {
    const t = String(raw || "")
      .toLowerCase()
      .trim()
      .replace(/[.!?]/g, "");
    if (/^(stop|cancel|stop listening)$/.test(t)) return { kind: "stop" };
    if (/^(help|what can i say|show commands)$/.test(t)) return { kind: "help" };
    if (/^(show |open )?(camera|cameras|cctv)$/.test(t)) return { kind: "cameras" };
    if (/^(why blocked|why is this blocked|missing evidence|evidence gaps)$/.test(t))
      return { kind: "gaps" };
    if (product === "rail" && /^(show |open )?(incident history|history)$/.test(t))
      return { kind: "history" };
    if (product === "cargo")
      for (const [name, path] of Object.entries(cargoPages))
        if (t === name || t === "show " + name || t === "open " + name)
          return { kind: "page", name, path };
    return { kind: "miss" };
  }
  root.NahaVoiceIntent = intent;
  if (!root.customElements || root.customElements.get("naha-voice-control")) return;
  class VoiceControl extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) return;
      const product = this.getAttribute("product") === "rail" ? "rail" : "cargo";
      const s = this.attachShadow({ mode: "open" });
      s.innerHTML = `<style>:host{display:block;font:16px/1.5 system-ui,sans-serif;color:#17212b}*{box-sizing:border-box}details{border:1px solid #b7c1cc;border-radius:14px;background:#fff;padding:12px}summary{cursor:pointer;min-height:44px;align-content:center;font-weight:650}p{margin:8px 0}label{display:block}input,button{font:inherit;min-height:44px;border:1px solid #8c99a8;border-radius:8px;padding:8px 12px}input{width:100%;background:white;color:#17212b}button{background:#edf1f5;color:#17212b;cursor:pointer}button:disabled{opacity:.6;cursor:default}.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.reply{border-top:1px solid #d7dee5;margin-top:12px;padding-top:12px}button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #b25b00;outline-offset:3px}small{font:inherit;color:#435366}</style><details><summary>Voice commands</summary><p>Open a view by voice or type a command. No records are changed.</p><label>Command<input maxlength="180" placeholder="Try: show cameras" autocomplete="off"></label><div class="row"><button type="button" id="run">Run command</button><button type="button" id="mic">Tap to speak</button><button type="button" id="stop">Stop</button></div><p id="status">Microphone is off.</p><p><small>Your browser may send speech to its recognition provider. Do not speak confidential case details. Typing does not send a voice recording.</small></p><div class="reply" role="status" aria-live="polite">${product === "rail" ? "Try: cameras, incident history, help or stop." : "Try: documents, definitions, counts, clocks, map, cameras, missing evidence or stop."}</div></details>`;
      const input = s.querySelector("input"),
        status = s.querySelector("#status"),
        reply = s.querySelector(".reply");
      const say = (text, key) => {
        reply.textContent = text;
        const assets = this.getAttribute("audio-base");
        if (assets && key) {
          this.audio?.pause();
          this.audio = new Audio(assets + "/" + key + "-v1.mp3");
          const playing = this.audio;
          playing
            .play()
            .then(() => {
              if (this.audio === playing)
                status.textContent = "Playing your bundled voice reply. Microphone is off.";
            })
            .catch((error) => {
              if (error.name !== "AbortError" && this.audio === playing)
                status.textContent = "Audio could not play. The written reply remains available.";
            });
        }
      };
      const run = (raw) => {
        let i = intent(raw, product);
        if (i.kind === "stop") {
          this.rec?.abort();
          this.audio?.pause();
          status.textContent = "Microphone is off.";
          say("Stopped. No records were changed.", product === "rail" ? "stop" : null);
          return;
        }
        if (i.kind === "help")
          say(
            product === "rail"
              ? "Say cameras or incident history. This opens a view only."
              : "Say documents, definitions, counts, clocks, map or cameras. This opens a view only.",
            product === "rail" ? "help" : null,
          );
        else if (i.kind === "gaps")
          say(
            "Missing or conflicting evidence must be reviewed on its source page.",
            product === "rail" ? "gaps" : null,
          );
        else if (i.kind === "page") {
          const base = this.getAttribute("case-path");
          if (base && /^\/cases\/[a-zA-Z0-9-]+$/.test(base)) {
            location.assign(base + (i.path ? "/" + i.path : ""));
          } else say("Open an authenticated case first.");
        } else if (i.kind === "history") {
          const b = document.getElementById("history-open");
          if (b) {
            b.click();
            say(
              "Incident history opened. Check the record and source before relying on it.",
              "history",
            );
          } else say("Incident history is not available in this view.");
        } else if (i.kind === "cameras") {
          const b =
            document.getElementById("rw-cameras-open") ||
            [...document.querySelectorAll("button")].find(
              (b) => b.textContent.trim() === "Cameras",
            );
          if (b) {
            b.click();
            say(
              product === "rail"
                ? "Reference camera player opened. This is not live incident footage."
                : "Camera viewer opened. Check each feed label and availability.",
              product === "rail" ? "camera" : null,
            );
          } else if (product === "cargo") {
            const base = this.getAttribute("case-path");
            if (base && /^\/cases\/[a-zA-Z0-9-]+$/.test(base)) location.assign(base + "/map");
            else say("Open a case map to use cameras.");
          } else say("Camera viewer is not available.");
        } else
          say(
            "That command is not supported. No action taken.",
            product === "rail" ? "miss" : null,
          );
      };
      s.querySelector("#run").onclick = () => run(input.value);
      input.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          run(input.value);
        }
      };
      s.querySelector("#stop").onclick = () => run("stop");
      const SR = root.SpeechRecognition || root.webkitSpeechRecognition;
      s.querySelector("#mic").onclick = () => {
        if (!SR) {
          status.textContent =
            "Speech input is not supported by this browser. Type a command instead.";
          return;
        }
        this.rec?.abort();
        this.rec = new SR();
        this.rec.lang = "en-ZA";
        this.rec.continuous = false;
        this.rec.interimResults = false;
        this.rec.onresult = (e) => {
          input.value = e.results[0][0].transcript;
          run(input.value);
        };
        this.rec.onend = () => {
          if (!this.voiceError) status.textContent = "Microphone is off.";
        };
        this.voiceError = false;
        this.rec.onerror = (e) => {
          this.voiceError = true;
          status.textContent =
            e.error === "not-allowed"
              ? "Microphone permission was not granted. Type a command instead."
              : "Speech input stopped. Type a command or try again.";
        };
        try {
          this.rec.start();
          status.textContent = "Listening. Tap Stop to cancel.";
        } catch {
          status.textContent = "Microphone could not start. Type a command instead.";
        }
      };
    }
    disconnectedCallback() {
      this.rec?.abort();
      this.audio?.pause();
    }
  }
  root.customElements.define("naha-voice-control", VoiceControl);
})(typeof window === "undefined" ? globalThis : window);
