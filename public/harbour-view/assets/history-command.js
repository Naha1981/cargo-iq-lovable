/* Deterministic historical command review. No provider requests or speech service. */
(function (root) {
  "use strict";
  var months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  function parse(raw) {
    var text = String(raw || "").toLowerCase();
    var named = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)\s+(\d{4})\b/);
    var iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    var date = null;
    if (named && months.indexOf(named[2]) >= 0)
      date =
        named[3] +
        "-" +
        String(months.indexOf(named[2]) + 1).padStart(2, "0") +
        "-" +
        named[1].padStart(2, "0");
    if (iso) date = iso[0];
    if (date) {
      var d = new Date(date + "T12:00:00Z");
      if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== date) date = null;
    }
    return {
      historical: !!(
        named ||
        iso ||
        /\b(date|yesterday|today|tomorrow|last|ago|historical|history|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}[/.]\d{1,2})\b/.test(
          text,
        )
      ),
      date: date,
    };
  }
  function formatDate(date) {
    if (!date) return "Complete date required";
    var d = new Date(date + "T12:00:00Z");
    return Number.isFinite(d.getTime())
      ? new Intl.DateTimeFormat("en-ZA", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "Africa/Johannesburg",
        }).format(d)
      : "Invalid date";
  }
  function day(timestamp) {
    var d = new Date(timestamp);
    if (!Number.isFinite(d.getTime())) return null;
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Johannesburg",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    var p = {};
    parts.forEach(function (x) {
      p[x.type] = x.value;
    });
    return p.year + "-" + p.month + "-" + p.day;
  }
  function recordsFor(records, date, place) {
    return records.filter(function (r) {
      if (day(r.timestamp) !== date || !Number.isFinite(r.lat) || !Number.isFinite(r.lon))
        return false;
      // Explicit review UI states this is nearby-coordinate filtering, not terminal identity.
      var km = Math.hypot(
        (r.lat - place.lat) * 111.2,
        (r.lon - place.lon) * 111.2 * Math.cos((place.lat * Math.PI) / 180),
      );
      return km <= 2;
    });
  }
  root.CargoHistoryCommand = {
    parse: parse,
    formatDate: formatDate,
    day: day,
    recordsFor: recordsFor,
  };
})(typeof window !== "undefined" ? window : globalThis);
