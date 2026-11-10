import { createElement, useEffect } from "react";
export function CaseVoiceCommands({ caseId }: { caseId: string }) {
  useEffect(() => {
    if (!document.querySelector("script[data-naha-voice]")) {
      const script = document.createElement("script");
      script.src = "/voice/voice-controls.js";
      script.dataset.nahaVoice = "true";
      document.head.appendChild(script);
    }
  }, []);
  return createElement("naha-voice-control", { product: "cargo", "case-path": "/cases/" + caseId });
}
