#include "net.h"

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Update.h>
#include <esp_ota_ops.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>
#include <freertos/task.h>
#include <string.h>
#include <time.h>

#include "certs.h"

#ifndef WB_BOARD
#define WB_BOARD "28"  // screen size in tenths of an inch, for the model name the server records
#endif
#ifndef WB_VERSION
#define WB_VERSION "dev"
#endif
#ifndef WB_PANEL
#define WB_PANEL "unknown"
#endif

namespace net {
namespace {

store::Settings settings;
bool readerPresent = false;
QueueHandle_t commands;
QueueHandle_t results;
SemaphoreHandle_t lock;
Status shared;

// Only the network task uses these.
char response[wb::MAX_RESPONSE + 1];
size_t responseLen = 0;
char lastV[24] = "";
char browsing[32] = "";
uint32_t pollMs = 30000;
unsigned failures = 0;
bool timeSynced = false;
bool updateTried = false;  // an update is tried once per start: the server does not offer it twice either
const char *const NOTHING_WAITING = "The server had no update waiting";

/**
 * A new firmware boots "on trial": the board goes back to the one before if it restarts before this is called.
 * It is called as soon as the server answers, or after ten minutes running in any case. So a build that crashes,
 * or restarts before it reaches Wrkbench, is undone; one that runs for ten minutes is kept, even with no Wi-Fi.
 */
void markGood() {
  static bool done = false;
  if (done) return;
  done = true;
  esp_ota_img_states_t state;
  if (esp_ota_get_state_partition(esp_ota_get_running_partition(), &state) == ESP_OK && state == ESP_OTA_IMG_PENDING_VERIFY) {
    esp_ota_mark_app_valid_cancel_rollback();
    Serial.println("New firmware confirmed");
  }
}

void setStatus(Phase phase, const char *message = nullptr, bool ok = false) {
  xSemaphoreTake(lock, portMAX_DELAY);
  shared.phase = phase;
  if (message) wb::copyText(shared.message, sizeof shared.message, message);
  if (ok) {
    shared.lastOkMs = millis();
    shared.message[0] = '\0';
  }
  shared.rssi = WiFi.RSSI();
  wb::copyText(shared.ip, sizeof shared.ip, WiFi.localIP().toString().c_str());
  xSemaphoreGive(lock);
}

Phase currentPhase() {
  xSemaphoreTake(lock, portMAX_DELAY);
  const Phase phase = shared.phase;
  xSemaphoreGive(lock);
  return phase;
}

void post(ResultType type, bool ok, const char *message, void *data = nullptr) {
  Result result{};
  result.type = type;
  result.ok = ok;
  wb::copyText(result.message, sizeof result.message, message ? message : "");
  result.data = data;
  if (xQueueSend(results, &result, pdMS_TO_TICKS(1000)) != pdTRUE) free(data);
}

/** Certificates can only be checked once the clock is right, so https waits for the time. */
bool ensureTime() {
  if (timeSynced || !wb::isHttps(settings.url) || settings.insecure) return true;
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  for (int i = 0; i < 40; i++) {
    if (time(nullptr) > 1700000000) {
      timeSynced = true;
      return true;
    }
    vTaskDelay(pdMS_TO_TICKS(250));
  }
  return false;
}

/** Opens `path` on the server with the display's token. HTTP/1.0 so a body never arrives chunked. */
bool open(HTTPClient &http, const char *path) {
  static WiFiClient plain;
  static WiFiClientSecure secure;
  const bool https = wb::isHttps(settings.url);
  if (https) {
    if (settings.insecure) secure.setInsecure();
    else secure.setCACert(WB_ROOT_CERTS);
  }
  String url = String(settings.url) + path;
  http.useHTTP10(true);
  http.setTimeout(10000);
  http.setConnectTimeout(8000);
  if (!(https ? http.begin(secure, url) : http.begin(plain, url))) return false;
  if (settings.token[0]) http.addHeader("Authorization", String("Bearer ") + settings.token);
  return true;
}

/**
 * One request. Returns the HTTP status (negative for a network error) with the body in `response`.
 * A size cap so a surprise cannot run the board out of memory.
 */
int request(const char *method, const char *path, const char *body = nullptr) {
  responseLen = 0;
  response[0] = '\0';
  if (!ensureTime()) return -100;
  HTTPClient http;
  if (!open(http, path)) return -101;
  http.addHeader("Accept", "application/json");
  int status;
  if (body) {
    http.addHeader("Content-Type", "application/json");
    status = http.sendRequest(method, reinterpret_cast<uint8_t *>(const_cast<char *>(body)), strlen(body));
  } else {
    status = http.sendRequest(method);
  }
  if (status > 0) markGood();
  // A 304 has no body; waiting for one would hold the connection until it times out.
  if (status > 0 && status != 304) {
    const int size = http.getSize();
    if (size > static_cast<int>(wb::MAX_RESPONSE)) {
      http.end();
      return -102;
    }
    WiFiClient *stream = http.getStreamPtr();
    const uint32_t started = millis();
    while ((size < 0 || responseLen < static_cast<size_t>(size)) && responseLen < wb::MAX_RESPONSE && millis() - started < 10000) {
      const int available = stream->available();
      if (available > 0) {
        responseLen += stream->readBytes(response + responseLen, min(static_cast<size_t>(available), wb::MAX_RESPONSE - responseLen));
      } else if (!stream->connected()) {
        break;
      } else {
        vTaskDelay(pdMS_TO_TICKS(5));
      }
    }
    response[responseLen] = '\0';
  }
  http.end();
  return status;
}

const char *describeFailure(int status) {
  switch (status) {
    case -100: return "Could not get the time for a secure connection";
    case -102: return "The server's answer was too big";
    case HTTPC_ERROR_CONNECTION_REFUSED: return "Server refused the connection";
    case HTTPC_ERROR_READ_TIMEOUT: return "Server took too long";
    default: break;
  }
  if (status >= 500) return "Server error";
  if (status == 404) return "Wrong address, or displays are off";
  if (status == 429) return "Too many requests, waiting";
  if (status > 0) return "Unexpected answer";
  return wb::isHttps(settings.url) ? "Cannot reach the server (check the address or certificate)" : "Cannot reach the server";
}

/** The token is gone or no longer works: back to asking for a set-up code. */
void unauthorized() {
  settings.token[0] = '\0';
  store::clearToken();
  lastV[0] = '\0';
  setStatus(Phase::NeedCode, "This display needs a new set-up code");
  post(ResultType::Unauthorized, false, "This display needs a new set-up code");
}

void pair(const char *code) {
  setStatus(Phase::Pairing);
  char body[200];
  snprintf(body, sizeof body, "{\"code\":\"%s\",\"model\":\"cyd-%s-%s%s\",\"version\":\"%s\"}", code, WB_BOARD, WB_PANEL, readerPresent ? "+pn532" : "", WB_VERSION);
  settings.token[0] = '\0';
  const int status = request("POST", "/api/device/pair", body);
  if (status <= 0 || status >= 500 || status == 429) {
    // The server was not reached, so the code is still good: try it again shortly.
    wb::copyText(settings.code, sizeof settings.code, code);
    failures++;
    setStatus(Phase::Pairing, describeFailure(status));
    vTaskDelay(pdMS_TO_TICKS(wb::backoffMs(failures)));
    return;
  }
  // The server answered: the code is used up or was wrong. Never send it twice.
  settings.code[0] = '\0';
  if (status == 200) {
    static wb::PairResult paired;
    if (wb::parsePair(response, responseLen, paired)) {
      wb::copyText(settings.token, sizeof settings.token, paired.token);
      store::save(settings);
      failures = 0;
      setStatus(Phase::Online, nullptr, true);
      post(ResultType::Paired, true, paired.deviceName);
      return;
    }
  }
  store::save(settings);
  char message[96];
  if (status > 0) wb::parseMessage(response, responseLen, message, sizeof message);
  else wb::copyText(message, sizeof message, describeFailure(status));
  if (!message[0]) wb::copyText(message, sizeof message, describeFailure(status));
  setStatus(Phase::NeedCode, message);
  post(ResultType::PairFailed, false, message);
}

/**
 * Downloads new firmware into the spare app slot, checking its size and MD5 as it goes. Returns why it failed,
 * or null when the image is in place and the board can restart into it. `later` is set when the download never
 * started for a passing reason (no connection, or the server could not fetch the file just now): the server
 * still offers it, so it is simply tried again on a later poll.
 */
const char *download(const wb::FirmwareOffer &update, bool &later) {
  later = true;
  if (!ensureTime()) return "Could not get the time for a secure connection";
  HTTPClient http;
  if (!open(http, "/api/device/firmware")) return "Could not reach the server";
  http.setTimeout(20000);
  const int status = http.GET();
  if (status != 200) {
    http.end();
    if (status == 404) {
      later = false;  // withdrawn, or already started once: nothing to report
      return NOTHING_WAITING;
    }
    return status == 503 ? "The server could not fetch the firmware just now" : "The download did not start";
  }
  later = false;
  if (http.getSize() != static_cast<int>(update.size)) {
    http.end();
    return "The download was not the expected size";
  }
  if (!Update.begin(update.size)) {
    http.end();
    return "No room for the new firmware";
  }
  Update.setMD5(update.md5);
  static uint8_t chunk[2048];  // only the network task runs this
  WiFiClient *stream = http.getStreamPtr();
  uint32_t written = 0, lastData = millis();
  int shown = -1;
  while (written < update.size && millis() - lastData < 20000) {
    const int available = stream->available();
    if (available <= 0) {
      if (!stream->connected()) break;
      vTaskDelay(pdMS_TO_TICKS(5));
      continue;
    }
    const size_t want = min(static_cast<size_t>(available), min(sizeof chunk, static_cast<size_t>(update.size - written)));
    const size_t got = stream->readBytes(chunk, want);
    if (got == 0) continue;
    if (Update.write(chunk, got) != got) {
      Update.abort();
      http.end();
      return "Writing the new firmware failed";
    }
    written += got;
    lastData = millis();
    const int percent = static_cast<int>(written * 100ULL / update.size);
    if (percent / 10 != shown) {
      shown = percent / 10;
      char note[48];
      snprintf(note, sizeof note, "Firmware %s: %d%%", update.version, percent);
      post(ResultType::Updating, true, note);
    }
  }
  http.end();
  if (written != update.size) {
    Update.abort();
    return "The download broke off";
  }
  if (!Update.end()) return Update.getError() == UPDATE_ERROR_MD5 ? "The download was damaged (checksum)" : "The new firmware was refused";
  return nullptr;
}

/** Installs the firmware the server offered and restarts into it, or tells the server why it could not. */
void install(const wb::FirmwareOffer &update) {
  updateTried = true;
  char note[48];
  snprintf(note, sizeof note, "Firmware %s", update.version);
  post(ResultType::Updating, true, note);
  Serial.printf("Updating to %s (%u bytes), free heap %u\n", update.version, static_cast<unsigned>(update.size), static_cast<unsigned>(ESP.getFreeHeap()));
  bool later = false;
  const char *failure = download(update, later);
  if (!failure) {
    Serial.println("Update written, restarting");
    post(ResultType::Updating, true, "Restarting");
    vTaskDelay(pdMS_TO_TICKS(1500));
    ESP.restart();
  }
  Serial.printf("Update failed: %s%s\n", failure, later ? " (will try again)" : "");
  post(ResultType::UpdateFailed, false, failure);
  if (later) {
    updateTried = false;
    return;
  }
  if (failure == NOTHING_WAITING) return;
  char body[160];
  snprintf(body, sizeof body, "{\"message\":\"%s\"}", failure);
  request("POST", "/api/device/update-failed", body);
}

void poll() {
  char path[200];
  snprintf(path, sizeof path, "/api/device/overview?nfc=%d&fw=%s%s%s%s%s", readerPresent ? 1 : 0, WB_VERSION, lastV[0] ? "&since=" : "", lastV,
           browsing[0] ? "&location=" : "", browsing);
  const int status = request("GET", path);
  if (status == 304) {
    failures = 0;
    setStatus(Phase::Online, nullptr, true);
    return;
  }
  if (status == 401) return unauthorized();
  if (status == 404 && browsing[0]) {
    // The location being browsed was deleted: back to the display's own.
    browsing[0] = '\0';
    lastV[0] = '\0';
    return poll();
  }
  if (status == 200) {
    auto *overview = static_cast<wb::Overview *>(malloc(sizeof(wb::Overview)));
    if (overview && wb::parseOverview(response, responseLen, *overview)) {
      wb::copyText(lastV, sizeof lastV, overview->v);
      pollMs = static_cast<uint32_t>(overview->poll) * 1000;
      failures = 0;
      setStatus(Phase::Online, nullptr, true);
      // Copied first: the screen frees the overview once it has drawn it.
      const bool update = overview->hasUpdate && !updateTried;
      const wb::FirmwareOffer offered = overview->update;
      post(ResultType::Overview, true, "", overview);
      if (update) install(offered);
      return;
    }
    free(overview);
  }
  failures++;
  setStatus(Phase::Offline, describeFailure(status));
}

/** A tag call: GET for a lookup, POST for a tap and for the changes. */
void tagCall(const Command &command) {
  char path[96];
  const bool tap = command.type == CommandType::Tap;
  const char *suffix =
      tap ? "/tap" : command.type == CommandType::PutAway ? "/put-away" : command.type == CommandType::Insert ? "/insert" : command.type == CommandType::Link ? "/link" : "";
  snprintf(path, sizeof path, "/api/device/tag/%s%s", command.arg, suffix);
  static char body[wb::BAMBU_JSON_LEN + 16];  // only the network task runs this
  if (command.type == CommandType::Link) snprintf(body, sizeof body, "{\"itemId\":\"%s\"}", command.arg2);
  else if (tap && command.blocks[0]) snprintf(body, sizeof body, "{\"blocks\":{%s}}", command.blocks);
  else snprintf(body, sizeof body, "{}");
  const int status = command.type == CommandType::Tag ? request("GET", path) : request("POST", path, body);
  if (status == 401) return unauthorized();
  if (command.type == CommandType::Tag || tap) {
    auto *info = static_cast<wb::TagInfo *>(malloc(sizeof(wb::TagInfo)));
    if (status == 200 && info && wb::parseTag(response, responseLen, *info)) {
      // A tap says what it did ("Taken out: on the move"); a look-up says nothing.
      char done[96];
      wb::parseMessage(response, responseLen, done, sizeof done);
      post(ResultType::Tag, true, done, info);
      if (tap) lastV[0] = '\0';  // what is stored here may have changed
      return;
    }
    free(info);
    char message[96];
    wb::parseMessage(response, responseLen, message, sizeof message);
    post(ResultType::Tag, false, message[0] ? message : describeFailure(status));
    return;
  }
  char message[96];
  wb::parseMessage(response, responseLen, message, sizeof message);
  if (!message[0]) wb::copyText(message, sizeof message, status == 200 ? "Done" : describeFailure(status));
  post(ResultType::Action, status == 200, message);
  if (status == 200) lastV[0] = '\0';  // what is stored here may have changed
}

/** The lit row was touched: the spool someone is looking for is taken out of this location. */
void takeOut(const Command &command) {
  char path[96];
  snprintf(path, sizeof path, "/api/device/item/%s/take-out", command.arg);
  const int status = request("POST", path, "{}");
  if (status == 401) return unauthorized();
  char message[96];
  wb::parseMessage(response, responseLen, message, sizeof message);
  if (!message[0]) wb::copyText(message, sizeof message, status == 200 ? "Taken out" : describeFailure(status));
  post(ResultType::Action, status == 200, message);
  lastV[0] = '\0';  // taken out or refused, what is lit here may have changed
}

void untagged() {
  const int status = request("GET", "/api/device/untagged");
  if (status == 401) return unauthorized();
  auto *list = static_cast<wb::ItemList *>(malloc(sizeof(wb::ItemList)));
  if (status == 200 && list && wb::parseItemList(response, responseLen, *list)) {
    post(ResultType::Untagged, true, "", list);
    return;
  }
  free(list);
  post(ResultType::Untagged, false, describeFailure(status));
}

void task(void *) {
  uint32_t nextPoll = 0;
  for (;;) {
    // Before anything that waits on the network, so a board without Wi-Fi keeps a build after ten minutes too.
    if (millis() > 10 * 60000) markGood();
    if (WiFi.status() != WL_CONNECTED) {
      if (currentPhase() != Phase::NeedCode) setStatus(Phase::Connecting);
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }
    if (!settings.token[0]) {
      if (settings.code[0]) {
        pair(settings.code);
        nextPoll = 0;
        continue;
      }
      if (currentPhase() != Phase::NeedCode) setStatus(Phase::NeedCode, "Enter a set-up code");
    }

    // Commands first; wait for one until the next poll is due.
    const uint32_t now = millis();
    const uint32_t wait = settings.token[0] && nextPoll > now ? nextPoll - now : (settings.token[0] ? 0 : 1000);
    Command command;
    if (xQueueReceive(commands, &command, pdMS_TO_TICKS(wait)) == pdTRUE) {
      switch (command.type) {
        case CommandType::Pair: pair(command.arg); nextPoll = 0; break;
        case CommandType::Browse:
          wb::copyText(browsing, sizeof browsing, command.arg);
          lastV[0] = '\0';
          nextPoll = 0;
          break;
        case CommandType::Refresh: lastV[0] = '\0'; nextPoll = 0; break;
        case CommandType::Untagged: if (settings.token[0]) untagged(); break;
        case CommandType::TakeOut: if (settings.token[0]) takeOut(command); nextPoll = millis() + 1500; break;
        case CommandType::Forget:
          settings.token[0] = '\0';
          settings.code[0] = '\0';
          store::save(settings);
          lastV[0] = '\0';
          browsing[0] = '\0';
          setStatus(Phase::NeedCode, "Enter a set-up code");
          break;
        default: if (settings.token[0]) tagCall(command); nextPoll = millis() + 1500; break;
      }
      continue;
    }
    if (!settings.token[0]) continue;
    poll();
    nextPoll = millis() + (failures ? wb::backoffMs(failures) : pollMs);
  }
}

}  // namespace

void start(const store::Settings &initial, bool hasReader) {
  settings = initial;
  readerPresent = hasReader;
  lock = xSemaphoreCreateMutex();
  commands = xQueueCreate(6, sizeof(Command));
  results = xQueueCreate(6, sizeof(Result));
  shared = Status{};
  shared.phase = Phase::Connecting;
  // Core 0 with Wi-Fi; the screen runs on core 1. TLS needs a deep stack.
  // Idle priority: a TLS handshake is seconds of solid work, and above idle it starved core 0's idle task until
  // the watchdog restarted the board (seen on a real board). At the same priority the two take turns.
  xTaskCreatePinnedToCore(task, "wb-net", 12288, nullptr, tskIDLE_PRIORITY, nullptr, 0);
}

void send(const Command &command) { xQueueSend(commands, &command, 0); }

bool receive(Result &out) { return results && xQueueReceive(results, &out, 0) == pdTRUE; }

Status status() {
  if (!lock) return Status{};
  xSemaphoreTake(lock, portMAX_DELAY);
  Status copy = shared;
  xSemaphoreGive(lock);
  return copy;
}

}  // namespace net
