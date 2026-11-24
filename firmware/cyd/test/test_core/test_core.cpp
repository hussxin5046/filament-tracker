// Host tests for lib/wb_core: pio test -e native
#include <stdio.h>
#include <string.h>
#include <unity.h>

#include "wb_core.h"

using namespace wb;

void setUp() {}
void tearDown() {}

static const char OVERVIEW[] = R"({
  "v": "9f2cAbC", "poll": 30, "workspace": "Shop", "device": "Rack display", "canWrite": true,
  "location": { "id": "loc1", "name": "Rack A", "path": "Workshop / Rack A" },
  "total": 37, "lowCount": 1,
  "items": [
    { "id": "i1", "name": "ABS Low", "sub": "ABS - Bambu Lab", "color": "#1A1A1A", "qty": "50 g", "fill": 0.05, "low": true, "at": null, "tagged": false },
    { "id": "i2", "name": "PETG", "sub": "PETG", "color": null, "qty": "750 g", "fill": null, "low": false, "at": "Shelf 2", "tagged": true }
  ],
  "locations": [ { "id": "loc1", "name": "Workshop / Rack A" }, { "id": "loc2", "name": "Bin" } ]
})";

void test_overview_is_read_into_the_fixed_struct() {
  static Overview o;
  TEST_ASSERT_TRUE(parseOverview(OVERVIEW, strlen(OVERVIEW), o));
  TEST_ASSERT_EQUAL_STRING("9f2cAbC", o.v);
  TEST_ASSERT_EQUAL(30, o.poll);
  TEST_ASSERT_TRUE(o.canWrite);
  TEST_ASSERT_TRUE(o.hasLocation);
  TEST_ASSERT_EQUAL_STRING("Rack A", o.location.name);
  TEST_ASSERT_EQUAL_STRING("Workshop / Rack A", o.path);
  TEST_ASSERT_EQUAL(37, o.total);
  TEST_ASSERT_EQUAL(2, o.itemCount);
  TEST_ASSERT_TRUE(o.items[0].low);
  TEST_ASSERT_TRUE(o.items[0].hasColor);
  TEST_ASSERT_EQUAL_HEX32(0x1A1A1A, o.items[0].color);
  TEST_ASSERT_FLOAT_WITHIN(0.001, 0.05, o.items[0].fill);
  TEST_ASSERT_FALSE(o.items[1].hasColor);
  TEST_ASSERT_EQUAL_FLOAT(-1.0f, o.items[1].fill);
  TEST_ASSERT_EQUAL_STRING("Shelf 2", o.items[1].at);
  TEST_ASSERT_EQUAL_STRING("", o.items[0].at);
  TEST_ASSERT_EQUAL(2, o.placeCount);
  TEST_ASSERT_EQUAL_STRING("Bin", o.places[1].name);
}

void test_printer_beside_the_display() {
  static Overview o;
  const char *json = R"({"v":"p","items":[],"printer":{"name":"X1C","state":"Printing","tone":"busy","progress":0.37,
    "left":"1 h 34 min left","job":"bracket_v3","layer":"Layer 112 of 300","temps":"Nozzle 220/220 C","error":null,
    "trays":[{"label":"A1","material":"PLA Basic","color":"#000000","active":true,"empty":false},
             {"label":"A4","material":null,"color":null,"active":false,"empty":true}]}})";
  TEST_ASSERT_TRUE(parseOverview(json, strlen(json), o));
  TEST_ASSERT_TRUE(o.hasPrinter);
  TEST_ASSERT_EQUAL_STRING("Printing", o.printer.state);
  TEST_ASSERT_TRUE(o.printer.tone == Tone::Busy);
  TEST_ASSERT_FLOAT_WITHIN(0.001, 0.37, o.printer.progress);
  TEST_ASSERT_EQUAL_STRING("1 h 34 min left", o.printer.left);
  TEST_ASSERT_EQUAL_STRING("", o.printer.error);
  TEST_ASSERT_EQUAL(2, o.printer.trayCount);
  TEST_ASSERT_TRUE(o.printer.trays[0].active && o.printer.trays[0].hasColor);
  TEST_ASSERT_TRUE(o.printer.trays[1].empty && !o.printer.trays[1].hasColor);
  const char *none = R"({"v":"q","printer":null})";
  TEST_ASSERT_TRUE(parseOverview(none, strlen(none), o));
  TEST_ASSERT_FALSE(o.hasPrinter);
  const char *idle = R"({"v":"r","printer":{"name":"P1S","state":"Bridge offline","tone":"off","progress":null,"trays":[]}})";
  TEST_ASSERT_TRUE(parseOverview(idle, strlen(idle), o));
  TEST_ASSERT_TRUE(o.printer.tone == Tone::Off);
  TEST_ASSERT_EQUAL_FLOAT(-1.0f, o.printer.progress);
}

void test_a_spool_someone_is_looking_for() {
  static Overview o;
  const char *json = R"({"v":"f","items":[{"id":"a","name":"PLA Black"}],
    "find":{"row":{"id":"a","name":"PLA Black","sub":"PLA - Bambu Lab","color":"#101010","qty":"500 g","fill":0.5,"low":false,"at":"Shelf 2","tagged":true}}})";
  TEST_ASSERT_TRUE(parseOverview(json, strlen(json), o));
  TEST_ASSERT_TRUE(o.hasFind);
  TEST_ASSERT_EQUAL_STRING("a", o.find.id);
  TEST_ASSERT_EQUAL_STRING("PLA Black", o.find.name);
  TEST_ASSERT_EQUAL_STRING("Shelf 2", o.find.at);
  TEST_ASSERT_EQUAL_HEX32(0x101010, o.find.color);
  // Nothing being looked for, and a find that does not say which item, light nothing.
  TEST_ASSERT_TRUE(parseOverview(OVERVIEW, strlen(OVERVIEW), o));
  TEST_ASSERT_FALSE(o.hasFind);
  const char *nameless = R"({"v":"g","find":{"row":{"name":"PLA Black"}}})";
  TEST_ASSERT_TRUE(parseOverview(nameless, strlen(nameless), o));
  TEST_ASSERT_FALSE(o.hasFind);
  const char *odd = R"({"v":"h","find":true})";
  TEST_ASSERT_TRUE(parseOverview(odd, strlen(odd), o));
  TEST_ASSERT_FALSE(o.hasFind);
}

void test_overview_without_location_and_bad_json() {
  static Overview o;
  const char *none = R"({"v":"x","poll":2,"location":null,"total":0,"items":[],"locations":[]})";
  TEST_ASSERT_TRUE(parseOverview(none, strlen(none), o));
  TEST_ASSERT_FALSE(o.hasLocation);
  TEST_ASSERT_EQUAL(10, o.poll);  // never polls faster than every 10 s
  TEST_ASSERT_FALSE(parseOverview("{\"error\":\"x\"}", 13, o));
  TEST_ASSERT_FALSE(parseOverview("not json", 8, o));
}

void test_long_text_is_cut_not_overrun() {
  static Overview o;
  char json[400];
  snprintf(json, sizeof json, R"({"v":"x","items":[{"id":"a","name":"%s"}]})",
           "A very long item name that goes on and on well past the space the screen has for it");
  TEST_ASSERT_TRUE(parseOverview(json, strlen(json), o));
  TEST_ASSERT_EQUAL(NAME_LEN - 1, strlen(o.items[0].name));
}

void test_tag_answers() {
  static TagInfo t;
  const char *known = R"({"known":true,"uid":"04A1B2","item":{"name":"PLA","qty":"1 g","location":"Bin","here":false},"canPutAway":true,"insertInto":{"machineId":"m","name":"X1C"}})";
  TEST_ASSERT_TRUE(parseTag(known, strlen(known), t));
  TEST_ASSERT_TRUE(t.known);
  TEST_ASSERT_EQUAL_STRING("PLA", t.item.name);
  TEST_ASSERT_EQUAL_STRING("Bin", t.where);
  TEST_ASSERT_TRUE(t.canPutAway);
  TEST_ASSERT_TRUE(t.canInsert);
  TEST_ASSERT_EQUAL_STRING("X1C", t.printer);
  TEST_ASSERT_FALSE(t.canWriteSticker);
  const char *writable = R"({"known":true,"uid":"04A1B2","item":{"name":"PLA"},"canWriteSticker":true})";
  TEST_ASSERT_TRUE(parseTag(writable, strlen(writable), t));
  TEST_ASSERT_TRUE(t.canWriteSticker);
  const char *unknown = R"({"known":false,"uid":"11223344","canLink":true})";
  TEST_ASSERT_TRUE(parseTag(unknown, strlen(unknown), t));
  TEST_ASSERT_FALSE(t.known);
  TEST_ASSERT_TRUE(t.canLink);
  TEST_ASSERT_FALSE(parseTag("{}", 2, t));
}

// A link to https://wrkbench.example/s/abc and {"type":"PLA"}, as the server builds a sticker.
static const char STICKER_HEX[] =
    "033C910117550477726B62656E63682E6578616D706C652F732F61626352100E6170706C69636174696F6E2F6A736F6E7B2274797065223A22504C41227DFE";

void test_sticker_to_write() {
  static Sticker s;
  char json[400];
  snprintf(json, sizeof json, R"({"sticker":"%s"})", STICKER_HEX);
  TEST_ASSERT_TRUE(parseSticker(json, strlen(json), s));
  TEST_ASSERT_EQUAL(63, s.len);
  TEST_ASSERT_EQUAL_HEX8(0x03, s.bytes[0]);
  TEST_ASSERT_EQUAL_HEX8(0x04, s.bytes[6]);  // "https://" in short
  TEST_ASSERT_EQUAL_HEX8(0xFE, s.bytes[62]);
  TEST_ASSERT_EQUAL(16, stickerPages(s.len));
  TEST_ASSERT_EQUAL(1, stickerPages(1));
  TEST_ASSERT_EQUAL(1, stickerPages(4));
  uint8_t page[4];
  stickerPage(s, 0, page);
  const uint8_t first[4] = {0x03, 0x3C, 0x91, 0x01};
  TEST_ASSERT_EQUAL_HEX8_ARRAY(first, page, 4);
  stickerPage(s, 15, page);  // bytes 60-62, then a zero to fill the page
  const uint8_t last[4] = {0x22, 0x7D, 0xFE, 0x00};
  TEST_ASSERT_EQUAL_HEX8_ARRAY(last, page, 4);

  // Anything that is not a whole NDEF TLV is refused, so nothing half-meant is written.
  TEST_ASSERT_FALSE(parseSticker(R"({"ok":true})", 11, s));
  TEST_ASSERT_EQUAL(0, s.len);
  TEST_ASSERT_FALSE(parseSticker(R"({"sticker":"03"})", 16, s));
  TEST_ASSERT_FALSE(parseSticker(R"({"sticker":"0302D100FE0"})", 25, s));   // odd length
  TEST_ASSERT_FALSE(parseSticker(R"({"sticker":"0303D100FE"})", 24, s));    // length says more than is there
  TEST_ASSERT_FALSE(parseSticker(R"({"sticker":"0102D100FE"})", 24, s));    // not an NDEF TLV
  TEST_ASSERT_FALSE(parseSticker(R"({"sticker":"0302D10000"})", 24, s));    // no terminator
  TEST_ASSERT_FALSE(parseSticker(R"({"sticker":"0302D1XXFE"})", 24, s));
  TEST_ASSERT_TRUE(parseSticker(R"({"sticker":"0302d100fe"})", 24, s));     // either case
  TEST_ASSERT_TRUE(parseSticker(R"({"sticker":"03FF0002D100FE"})", 28, s)); // the three-byte length form

  // Capability containers: NTAG215 and NTAG216, an NTAG213, one not formatted for NDEF, one locked.
  const uint8_t ntag215[4] = {0xE1, 0x10, 0x3E, 0x00};
  const uint8_t ntag216[4] = {0xE1, 0x10, 0x6D, 0x00};
  const uint8_t ntag213[4] = {0xE1, 0x10, 0x12, 0x00};
  const uint8_t blank[4] = {0x00, 0x00, 0x00, 0x00};
  const uint8_t locked[4] = {0xE1, 0x10, 0x3E, 0x0F};
  TEST_ASSERT_EQUAL(496, stickerCapacity(ntag215));
  TEST_ASSERT_EQUAL(872, stickerCapacity(ntag216));
  TEST_ASSERT_EQUAL(144, stickerCapacity(ntag213));
  TEST_ASSERT_EQUAL(0, stickerCapacity(blank));
  TEST_ASSERT_EQUAL(0, stickerCapacity(locked));
}

void test_pair_and_messages() {
  static PairResult p;
  const char *ok = R"({"token":"wbd_abc","deviceId":"d","workspaceName":"Shop","deviceName":"Rack"})";
  TEST_ASSERT_TRUE(parsePair(ok, strlen(ok), p));
  TEST_ASSERT_EQUAL_STRING("wbd_abc", p.token);
  TEST_ASSERT_EQUAL_STRING("Rack", p.deviceName);
  const char *bridge = R"({"token":"wbb_abc"})";
  TEST_ASSERT_FALSE(parsePair(bridge, strlen(bridge), p));
  char message[64];
  const char *err = R"({"error":"That set-up code is not valid"})";
  parseMessage(err, strlen(err), message, sizeof message);
  TEST_ASSERT_EQUAL_STRING("That set-up code is not valid", message);
  parseMessage("nope", 4, message, sizeof message);
  TEST_ASSERT_EQUAL_STRING("", message);
}

void test_codes_and_addresses_as_typed() {
  char out[64];
  TEST_ASSERT_TRUE(normalizeCode("abcd-efgh-jkmn", out, sizeof out));
  TEST_ASSERT_EQUAL_STRING("ABCDEFGHJKMN", out);
  TEST_ASSERT_FALSE(normalizeCode("ABCD-EFGH", out, sizeof out));
  TEST_ASSERT_TRUE(normalizeServer("  192.168.1.20:4000/ ", out, sizeof out));
  TEST_ASSERT_EQUAL_STRING("http://192.168.1.20:4000", out);
  TEST_ASSERT_TRUE(normalizeServer("HTTPS://wrkbench.example.com//", out, sizeof out));
  TEST_ASSERT_EQUAL_STRING("https://wrkbench.example.com", out);
  TEST_ASSERT_TRUE(isHttps(out));
  TEST_ASSERT_FALSE(normalizeServer("ftp://x.example", out, sizeof out));
  TEST_ASSERT_FALSE(normalizeServer("   ", out, sizeof out));
  TEST_ASSERT_FALSE(normalizeServer("http://", out, sizeof out));
}

void test_colours_uids_backoff_and_ages() {
  uint32_t c = 0;
  TEST_ASSERT_TRUE(parseColor("#ff8000", c));
  TEST_ASSERT_EQUAL_HEX32(0xFF8000, c);
  TEST_ASSERT_FALSE(parseColor("ff8000", c));
  TEST_ASSERT_FALSE(parseColor("#ff80zz", c));
  const uint8_t uid[] = {0x04, 0xA1, 0xB2, 0x0F};
  char hex[24];
  uidToHex(uid, sizeof uid, hex, sizeof hex);
  TEST_ASSERT_EQUAL_STRING("04A1B20F", hex);
  TEST_ASSERT_EQUAL_UINT32(5000, backoffMs(1));
  TEST_ASSERT_EQUAL_UINT32(10000, backoffMs(2));
  TEST_ASSERT_EQUAL_UINT32(300000, backoffMs(20));
  char ago[24];
  formatAgo(20, ago, sizeof ago);
  TEST_ASSERT_EQUAL_STRING("just now", ago);
  formatAgo(150, ago, sizeof ago);
  TEST_ASSERT_EQUAL_STRING("2 min ago", ago);
  formatAgo(7300, ago, sizeof ago);
  TEST_ASSERT_EQUAL_STRING("2 h ago", ago);
}

static void test_temperature_line_read_as_heaters() {
  Heat h[MAX_HEATS];
  TEST_ASSERT_EQUAL_UINT(2, parseHeats("Nozzle 220/220 C  Bed 60 C", h, MAX_HEATS));
  TEST_ASSERT_EQUAL_STRING("Nozzle", h[0].label);
  TEST_ASSERT_EQUAL_INT(220, h[0].current);
  TEST_ASSERT_EQUAL_INT(220, h[0].target);
  TEST_ASSERT_EQUAL_STRING("Bed", h[1].label);
  TEST_ASSERT_EQUAL_INT(60, h[1].current);
  TEST_ASSERT_EQUAL_INT(0, h[1].target);
  TEST_ASSERT_EQUAL_UINT(1, parseHeats("Bed 25 C", h, MAX_HEATS));
  // Empty, or not in the expected form: none, so the screen falls back to the text.
  TEST_ASSERT_EQUAL_UINT(0, parseHeats("", h, MAX_HEATS));
  TEST_ASSERT_EQUAL_UINT(0, parseHeats(nullptr, h, MAX_HEATS));
  TEST_ASSERT_EQUAL_UINT(0, parseHeats("Nozzle hot", h, MAX_HEATS));
  TEST_ASSERT_EQUAL_UINT(0, parseHeats("Nozzle 220 F", h, MAX_HEATS));
  TEST_ASSERT_EQUAL_UINT(0, parseHeats("Nozzle 220/ C", h, MAX_HEATS));
  TEST_ASSERT_EQUAL_UINT(0, parseHeats("A 1 C  B 2 C  C 3 C  D 4 C", h, MAX_HEATS));
}

static void test_firmware_update_offer() {
  static Overview o;
  const char *json = R"({"v":"u","items":[],"update":{"version":"0.3.1","size":1382576,"md5":"0123456789abcdef0123456789abcdef"}})";
  TEST_ASSERT_TRUE(parseOverview(json, strlen(json), o));
  TEST_ASSERT_TRUE(o.hasUpdate);
  TEST_ASSERT_EQUAL_STRING("0.3.1", o.update.version);
  TEST_ASSERT_EQUAL_UINT32(1382576, o.update.size);
  TEST_ASSERT_EQUAL_STRING("0123456789abcdef0123456789abcdef", o.update.md5);
  const char *none = R"({"v":"w","items":[]})";
  TEST_ASSERT_TRUE(parseOverview(none, strlen(none), o));
  TEST_ASSERT_FALSE(o.hasUpdate);
  // Anything incomplete or too big for an app slot is ignored, not half-taken.
  const char *noMd5 = R"({"v":"x","update":{"version":"0.3.1","size":1000,"md5":"abc"}})";
  TEST_ASSERT_TRUE(parseOverview(noMd5, strlen(noMd5), o));
  TEST_ASSERT_FALSE(o.hasUpdate);
  const char *tooBig = R"({"v":"y","update":{"version":"0.3.1","size":9000000,"md5":"0123456789abcdef0123456789abcdef"}})";
  TEST_ASSERT_TRUE(parseOverview(tooBig, strlen(tooBig), o));
  TEST_ASSERT_FALSE(o.hasUpdate);
}

static void test_setup_sent_over_usb() {
  UsbSetup s;
  const char *ok = R"({"ssid":"CNC","password":"hunter2hunter2","url":"https://www.wrkbench.xyz/","code":"abcd-efgh-2345"})";
  TEST_ASSERT_NULL(parseUsbSetup(ok, strlen(ok), s));
  TEST_ASSERT_EQUAL_STRING("CNC", s.ssid);
  TEST_ASSERT_EQUAL_STRING("hunter2hunter2", s.password);
  TEST_ASSERT_EQUAL_STRING("https://www.wrkbench.xyz", s.url);
  TEST_ASSERT_EQUAL_STRING("ABCDEFGH2345", s.code);
  TEST_ASSERT_FALSE(s.insecure);
  const char *open = R"({"ssid":"Guest","password":"","url":"192.168.1.20:4000","code":"ABCDEFGH2345","insecure":true})";
  TEST_ASSERT_NULL(parseUsbSetup(open, strlen(open), s));
  TEST_ASSERT_EQUAL_STRING("http://192.168.1.20:4000", s.url);
  TEST_ASSERT_TRUE(s.insecure);
  const char *shortPass = R"({"ssid":"CNC","password":"short","url":"https://a.b","code":"ABCDEFGH2345"})";
  TEST_ASSERT_EQUAL_STRING("Wi-Fi password must be 8 to 63 characters", parseUsbSetup(shortPass, strlen(shortPass), s));
  const char *noSsid = R"({"ssid":"","password":"","url":"https://a.b","code":"ABCDEFGH2345"})";
  TEST_ASSERT_NOT_NULL(parseUsbSetup(noSsid, strlen(noSsid), s));
  const char *badCode = R"({"ssid":"CNC","password":"","url":"https://a.b","code":"ABC"})";
  TEST_ASSERT_EQUAL_STRING("Set-up code not usable", parseUsbSetup(badCode, strlen(badCode), s));
  TEST_ASSERT_EQUAL_STRING("Not readable", parseUsbSetup("nope", 4, s));
}

static int runAll() {
  UNITY_BEGIN();
  RUN_TEST(test_overview_is_read_into_the_fixed_struct);
  RUN_TEST(test_overview_without_location_and_bad_json);
  RUN_TEST(test_printer_beside_the_display);
  RUN_TEST(test_a_spool_someone_is_looking_for);
  RUN_TEST(test_long_text_is_cut_not_overrun);
  RUN_TEST(test_tag_answers);
  RUN_TEST(test_sticker_to_write);
  RUN_TEST(test_pair_and_messages);
  RUN_TEST(test_codes_and_addresses_as_typed);
  RUN_TEST(test_colours_uids_backoff_and_ages);
  RUN_TEST(test_temperature_line_read_as_heaters);
  RUN_TEST(test_firmware_update_offer);
  RUN_TEST(test_setup_sent_over_usb);
  return UNITY_END();
}

#ifdef ARDUINO
// On the board itself (pio test -e test-board): no compiler needed on the computer.
#include <Arduino.h>
void setup() {
  delay(2000);  // lets the test runner open the serial port first
  runAll();
}
void loop() {}
#else
int main() { return runAll(); }
#endif
