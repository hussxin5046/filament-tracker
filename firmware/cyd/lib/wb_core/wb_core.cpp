#include "wb_core.h"

#include <ArduinoJson.h>
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

namespace wb {

void copyText(char *out, size_t outLen, const char *in) {
  if (!out || outLen == 0) return;
  if (!in) in = "";
  size_t n = strlen(in);
  if (n >= outLen) n = outLen - 1;
  memcpy(out, in, n);
  out[n] = '\0';
}

bool parseColor(const char *text, uint32_t &out) {
  if (!text || strlen(text) != 7 || text[0] != '#') return false;
  uint32_t value = 0;
  for (int i = 1; i < 7; i++) {
    const char c = static_cast<char>(tolower(static_cast<unsigned char>(text[i])));
    value <<= 4;
    if (c >= '0' && c <= '9') value |= static_cast<uint32_t>(c - '0');
    else if (c >= 'a' && c <= 'f') value |= static_cast<uint32_t>(c - 'a' + 10);
    else return false;
  }
  out = value;
  return true;
}

static void readItem(JsonObjectConst row, Item &item) {
  copyText(item.id, sizeof item.id, row["id"] | "");
  copyText(item.name, sizeof item.name, row["name"] | "");
  copyText(item.sub, sizeof item.sub, row["sub"] | "");
  copyText(item.qty, sizeof item.qty, row["qty"] | "");
  copyText(item.at, sizeof item.at, row["at"] | "");
  item.hasColor = parseColor(row["color"] | "", item.color);
  if (!item.hasColor) item.color = 0;
  item.fill = row["fill"].is<float>() ? row["fill"].as<float>() : -1.0f;
  if (item.fill > 1.0f) item.fill = 1.0f;
  item.low = row["low"] | false;
  item.tagged = row["tagged"] | false;
}

static Tone readTone(const char *text) {
  if (strcmp(text, "ok") == 0) return Tone::Ok;
  if (strcmp(text, "busy") == 0) return Tone::Busy;
  if (strcmp(text, "warn") == 0) return Tone::Warn;
  if (strcmp(text, "error") == 0) return Tone::Error;
  return Tone::Off;
}

static void readPrinter(JsonObjectConst p, PrinterInfo &out) {
  copyText(out.name, sizeof out.name, p["name"] | "");
  copyText(out.state, sizeof out.state, p["state"] | "");
  out.tone = readTone(p["tone"] | "off");
  out.progress = p["progress"].is<float>() ? p["progress"].as<float>() : -1.0f;
  if (out.progress > 1.0f) out.progress = 1.0f;
  copyText(out.left, sizeof out.left, p["left"] | "");
  copyText(out.job, sizeof out.job, p["job"] | "");
  copyText(out.layer, sizeof out.layer, p["layer"] | "");
  copyText(out.temps, sizeof out.temps, p["temps"] | "");
  copyText(out.error, sizeof out.error, p["error"] | "");
  out.trayCount = 0;
  for (JsonObjectConst t : p["trays"].as<JsonArrayConst>()) {
    if (out.trayCount >= MAX_TRAYS) break;
    TrayInfo &tray = out.trays[out.trayCount++];
    copyText(tray.label, sizeof tray.label, t["label"] | "");
    copyText(tray.material, sizeof tray.material, t["material"] | "");
    tray.hasColor = parseColor(t["color"] | "", tray.color);
    if (!tray.hasColor) tray.color = 0;
    tray.active = t["active"] | false;
    tray.empty = t["empty"] | false;
  }
}

bool parseOverview(const char *json, size_t len, Overview &out) {
  JsonDocument doc;
  if (deserializeJson(doc, json, len) != DeserializationError::Ok || !doc.is<JsonObject>()) return false;
  if (!doc["v"].is<const char *>()) return false;
  memset(&out, 0, sizeof out);
  copyText(out.v, sizeof out.v, doc["v"]);
  out.poll = doc["poll"] | 30;
  if (out.poll < 10) out.poll = 10;
  if (out.poll > 600) out.poll = 600;
  copyText(out.workspace, sizeof out.workspace, doc["workspace"] | "");
  copyText(out.device, sizeof out.device, doc["device"] | "");
  out.canWrite = doc["canWrite"] | false;
  JsonObjectConst location = doc["location"];
  out.hasLocation = !location.isNull();
  if (out.hasLocation) {
    copyText(out.location.id, sizeof out.location.id, location["id"] | "");
    copyText(out.location.name, sizeof out.location.name, location["name"] | "");
    copyText(out.path, sizeof out.path, location["path"] | "");
  }
  out.total = doc["total"] | 0;
  out.lowCount = doc["lowCount"] | 0;
  for (JsonObjectConst row : doc["items"].as<JsonArrayConst>()) {
    if (out.itemCount >= MAX_ITEMS) break;
    readItem(row, out.items[out.itemCount++]);
  }
  for (JsonObjectConst row : doc["locations"].as<JsonArrayConst>()) {
    if (out.placeCount >= MAX_LOCATIONS) break;
    Place &place = out.places[out.placeCount++];
    copyText(place.id, sizeof place.id, row["id"] | "");
    copyText(place.name, sizeof place.name, row["name"] | "");
  }
  if (out.total < static_cast<int>(out.itemCount)) out.total = static_cast<int>(out.itemCount);
  JsonObjectConst printer = doc["printer"];
  out.hasPrinter = !printer.isNull();
  if (out.hasPrinter) readPrinter(printer, out.printer);
  // An update is only taken when it is whole: a version, a size that fits an app slot and a full MD5.
  JsonObjectConst update = doc["update"];
  const char *md5 = update["md5"] | "";
  const uint32_t size = update["size"] | 0u;
  if (!update.isNull() && update["version"].is<const char *>() && size > 0 && size <= MAX_FIRMWARE && strlen(md5) == 32) {
    out.hasUpdate = true;
    copyText(out.update.version, sizeof out.update.version, update["version"]);
    out.update.size = size;
    copyText(out.update.md5, sizeof out.update.md5, md5);
  }
  // A spool someone is looking for. Only with its id: touching the lit row names it to the server.
  JsonObjectConst sought = doc["find"]["row"];
  const char *soughtId = sought["id"] | "";
  if (!sought.isNull() && soughtId[0]) {
    out.hasFind = true;
    readItem(sought, out.find);
  }
  return true;
}

bool parseTag(const char *json, size_t len, TagInfo &out) {
  JsonDocument doc;
  if (deserializeJson(doc, json, len) != DeserializationError::Ok || !doc["known"].is<bool>()) return false;
  memset(&out, 0, sizeof out);
  out.known = doc["known"];
  copyText(out.uid, sizeof out.uid, doc["uid"] | "");
  out.canLink = doc["canLink"] | false;
  if (!out.known) return true;
  JsonObjectConst item = doc["item"];
  readItem(item, out.item);
  copyText(out.where, sizeof out.where, item["location"] | "");
  out.here = item["here"] | false;
  out.canPutAway = doc["canPutAway"] | false;
  JsonObjectConst insert = doc["insertInto"];
  out.canInsert = !insert.isNull();
  if (out.canInsert) copyText(out.printer, sizeof out.printer, insert["name"] | "");
  out.canWriteSticker = doc["canWriteSticker"] | false;
  return true;
}

namespace {

int hexDigit(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

}  // namespace

bool parseSticker(const char *json, size_t len, Sticker &out) {
  out.len = 0;
  JsonDocument doc;
  if (deserializeJson(doc, json, len) != DeserializationError::Ok) return false;
  const char *hex = doc["sticker"] | "";
  const size_t digits = strlen(hex);
  if (digits == 0 || digits % 2 != 0 || digits / 2 > STICKER_MAX) return false;
  for (size_t i = 0; i < digits / 2; i++) {
    const int high = hexDigit(hex[2 * i]);
    const int low = hexDigit(hex[2 * i + 1]);
    if (high < 0 || low < 0) return false;
    out.bytes[i] = static_cast<uint8_t>(high << 4 | low);
  }
  const size_t n = digits / 2;
  // An NDEF TLV (0x03, then its length in one byte or 0xFF and two) whose message ends just before 0xFE.
  if (n < 3 || out.bytes[0] != 0x03) return false;
  size_t message = out.bytes[1], start = 2;
  if (message == 0xFF) {
    if (n < 5) return false;
    message = static_cast<size_t>(out.bytes[2]) << 8 | out.bytes[3];
    start = 4;
  }
  if (start + message + 1 != n || out.bytes[n - 1] != 0xFE) return false;
  out.len = n;
  return true;
}

void stickerPage(const Sticker &sticker, size_t index, uint8_t out[4]) {
  for (size_t i = 0; i < 4; i++) {
    const size_t at = index * 4 + i;
    out[i] = at < sticker.len ? sticker.bytes[at] : 0;
  }
}

size_t stickerCapacity(const uint8_t cc[4]) {
  // The access byte's high nibble is read access and low nibble write access: 0 means anyone may.
  if (cc[0] != 0xE1 || (cc[3] & 0x0F) != 0) return 0;
  const size_t size = static_cast<size_t>(cc[2]) * 8;
  return size > STICKER_MAX ? STICKER_MAX : size;
}

bool parsePair(const char *json, size_t len, PairResult &out) {
  JsonDocument doc;
  if (deserializeJson(doc, json, len) != DeserializationError::Ok) return false;
  const char *token = doc["token"] | "";
  if (strncmp(token, "wbd_", 4) != 0 || strlen(token) >= sizeof out.token) return false;
  memset(&out, 0, sizeof out);
  copyText(out.token, sizeof out.token, token);
  copyText(out.deviceName, sizeof out.deviceName, doc["deviceName"] | "");
  copyText(out.workspaceName, sizeof out.workspaceName, doc["workspaceName"] | "");
  return true;
}

bool parseItemList(const char *json, size_t len, ItemList &out) {
  JsonDocument doc;
  if (deserializeJson(doc, json, len) != DeserializationError::Ok || !doc["items"].is<JsonArray>()) return false;
  out.count = 0;
  for (JsonObjectConst row : doc["items"].as<JsonArrayConst>()) {
    if (out.count >= MAX_ITEMS) break;
    readItem(row, out.items[out.count++]);
  }
  return true;
}

void parseMessage(const char *json, size_t len, char *out, size_t outLen) {
  copyText(out, outLen, "");
  JsonDocument doc;
  if (deserializeJson(doc, json, len) != DeserializationError::Ok) return;
  const char *text = doc["error"] | (doc["message"] | "");
  copyText(out, outLen, text);
}

bool normalizeCode(const char *in, char *out, size_t outLen) {
  size_t n = 0;
  for (const char *p = in ? in : ""; *p && n + 1 < outLen; p++) {
    const char c = static_cast<char>(toupper(static_cast<unsigned char>(*p)));
    if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) out[n++] = c;
  }
  if (outLen) out[n] = '\0';
  return n == 12;
}

bool normalizeServer(const char *in, char *out, size_t outLen) {
  if (!in || !out || outLen < 12) return false;
  while (*in && isspace(static_cast<unsigned char>(*in))) in++;
  size_t len = strlen(in);
  while (len && (isspace(static_cast<unsigned char>(in[len - 1])) || in[len - 1] == '/')) len--;
  if (len == 0) return false;
  const char *scheme = strstr(in, "://");
  char buffer[160];
  if (scheme && static_cast<size_t>(scheme - in) < len) {
    const size_t schemeLen = static_cast<size_t>(scheme - in);
    // Phones like to capitalise the first letter: "Https://" is still https.
    if (!((schemeLen == 4 && strncasecmp(in, "http", 4) == 0) || (schemeLen == 5 && strncasecmp(in, "https", 5) == 0))) return false;
    if (len - schemeLen <= 3) return false;
    if (len >= sizeof buffer) return false;
    memcpy(buffer, in, len);
    buffer[len] = '\0';
  } else {
    if (len + 7 >= sizeof buffer) return false;
    memcpy(buffer, "http://", 7);
    memcpy(buffer + 7, in, len);
    buffer[len + 7] = '\0';
  }
  // A scheme typed in capitals still works.
  for (char *p = buffer; *p && *p != ':'; p++) *p = static_cast<char>(tolower(static_cast<unsigned char>(*p)));
  if (strlen(buffer) >= outLen) return false;
  copyText(out, outLen, buffer);
  return true;
}

bool isHttps(const char *url) { return url && strncmp(url, "https://", 8) == 0; }

void uidToHex(const uint8_t *uid, size_t len, char *out, size_t outLen) {
  static const char HEX_DIGITS[] = "0123456789ABCDEF";
  size_t n = 0;
  for (size_t i = 0; i < len && n + 2 < outLen; i++) {
    out[n++] = HEX_DIGITS[uid[i] >> 4];
    out[n++] = HEX_DIGITS[uid[i] & 0x0F];
  }
  if (outLen) out[n] = '\0';
}

uint32_t backoffMs(unsigned failures) {
  if (failures == 0) return 0;
  uint32_t delay = 5000;
  for (unsigned i = 1; i < failures && delay < 300000; i++) delay *= 2;
  return delay > 300000 ? 300000 : delay;
}

void formatAgo(uint32_t seconds, char *out, size_t outLen) {
  if (seconds < 60) snprintf(out, outLen, "just now");
  else if (seconds < 3600) snprintf(out, outLen, "%u min ago", static_cast<unsigned>(seconds / 60));
  else snprintf(out, outLen, "%u h ago", static_cast<unsigned>(seconds / 3600));
}

const char *parseUsbSetup(const char *json, size_t len, UsbSetup &out) {
  memset(&out, 0, sizeof out);
  JsonDocument doc;
  if (deserializeJson(doc, json, len) != DeserializationError::Ok || !doc.is<JsonObject>()) return "Not readable";
  const char *ssid = doc["ssid"] | "";
  const char *password = doc["password"] | "";
  const size_t ssidLen = strlen(ssid), passwordLen = strlen(password);
  if (ssidLen == 0 || ssidLen > 32) return "Wi-Fi name must be 1 to 32 characters";
  // WPA2 wants 8 to 63 characters; an open network has none.
  if (passwordLen != 0 && (passwordLen < 8 || passwordLen > 63)) return "Wi-Fi password must be 8 to 63 characters";
  if (!normalizeServer(doc["url"] | "", out.url, sizeof out.url)) return "Server address not usable";
  if (!normalizeCode(doc["code"] | "", out.code, sizeof out.code)) return "Set-up code not usable";
  copyText(out.ssid, sizeof out.ssid, ssid);
  copyText(out.password, sizeof out.password, password);
  out.insecure = doc["insecure"] | false;
  return nullptr;
}

size_t parseHeats(const char *temps, Heat *out, size_t max) {
  size_t count = 0;
  const char *p = temps ? temps : "";
  while (*p) {
    while (*p == ' ') p++;
    if (!*p) break;
    if (count == max) return 0;
    Heat &h = out[count];
    // The label: letters up to the space before the number.
    size_t n = 0;
    while (isalpha(static_cast<unsigned char>(*p))) {
      if (n + 1 < sizeof h.label) h.label[n++] = *p;
      p++;
    }
    h.label[n] = 0;
    if (!n || *p != ' ') return 0;
    p++;
    if (!isdigit(static_cast<unsigned char>(*p))) return 0;
    char *end = nullptr;
    h.current = static_cast<int>(strtol(p, &end, 10));
    p = end;
    h.target = 0;
    if (*p == '/') {
      if (!isdigit(static_cast<unsigned char>(p[1]))) return 0;
      h.target = static_cast<int>(strtol(p + 1, &end, 10));
      p = end;
    }
    if (p[0] != ' ' || p[1] != 'C' || (p[2] && p[2] != ' ')) return 0;
    p += 2;
    count++;
  }
  return count;
}

}  // namespace wb
