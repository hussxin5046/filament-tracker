// What the display knows, and the small pure functions that fill it in. No Arduino includes here, so all of
// it is tested on the computer (test/test_core) before it goes near a board.
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace wb {

constexpr size_t ID_LEN = 32;
constexpr size_t NAME_LEN = 48;
constexpr size_t SHORT_LEN = 28;
constexpr size_t PATH_LEN = 72;
constexpr size_t MAX_ITEMS = 40;
constexpr size_t MAX_LOCATIONS = 40;
/** A response bigger than this is refused rather than parsed: the board has no memory to spare. */
constexpr size_t MAX_RESPONSE = 16 * 1024;
/** The largest firmware image an app slot holds (min_spiffs.csv: 0x1E0000 bytes). */
constexpr uint32_t MAX_FIRMWARE = 0x1E0000;

/** One row on the screen, already worded by the server. */
struct Item {
  char id[ID_LEN];
  char name[NAME_LEN];
  char sub[NAME_LEN];
  char qty[SHORT_LEN];
  char at[SHORT_LEN];
  uint32_t color;   // 0xRRGGBB
  bool hasColor;
  float fill;       // 0..1, or -1 when the item has no full amount to compare with
  bool low;
  bool tagged;
};

struct Place {
  char id[ID_LEN];
  char name[PATH_LEN];
};

/** How a printer is doing, for the colour of its dot. */
enum class Tone : uint8_t { Ok, Busy, Warn, Error, Off };

constexpr size_t MAX_TRAYS = 8;

struct TrayInfo {
  char label[6];      // "A1", "Ext"
  char material[16];
  uint32_t color;
  bool hasColor;
  bool active;        // feeding the print now
  bool empty;
};

/** The printer chosen as beside the display, worded by the server. */
struct PrinterInfo {
  char name[36];
  char state[28];     // "Printing", "Idle", "Bridge offline" ...
  Tone tone;
  float progress;     // 0..1, or -1 when nothing is running
  char left[24];      // "1 h 34 min left"
  char job[44];
  char layer[28];     // "Layer 112 of 300"
  char temps[48];     // "Nozzle 220/220 C  Bed 60/60 C"
  char error[96];
  size_t trayCount;
  TrayInfo trays[MAX_TRAYS];
};

/** New firmware to install, as the server offers it. */
struct FirmwareOffer {
  char version[16];
  uint32_t size;
  char md5[33];  // of the whole image, in lowercase hex
};

struct Overview {
  char v[24];
  int poll;
  char workspace[NAME_LEN];
  char device[NAME_LEN];
  bool canWrite;
  bool hasLocation;
  Place location;     // name is the location's own name
  char path[PATH_LEN];
  int total;
  int lowCount;
  size_t itemCount;
  Item items[MAX_ITEMS];
  size_t placeCount;
  Place places[MAX_LOCATIONS];
  bool hasPrinter;    // a printer is chosen for this display in Settings
  PrinterInfo printer;
  bool hasUpdate;     // an admin asked for new firmware: fetch it from /api/device/firmware
  FirmwareOffer update;
  bool hasFind;       // someone is looking for a spool kept here: its row is lit until this is gone
  Item find;
};

/** What the server said about a tapped tag. */
struct TagInfo {
  bool known;
  char uid[40];  // the key the server names the tag by: a chip UID, or "T" and a spool's own id
  Item item;
  char where[PATH_LEN];  // where the item is kept, "" when nowhere
  bool here;
  bool canPutAway;
  bool canLink;
  bool canInsert;
  char printer[NAME_LEN];
  bool canWriteSticker;  // the server will hand over a sticker to write onto this tag
};

/**
 * The most a sticker's user memory holds: an NTAG216's 888 bytes. An NTAG215 holds 504, and its capability
 * container says so; stickerCapacity() reads it from there.
 */
constexpr size_t STICKER_MAX = 888;

/** What to write onto a spool's sticker, from page 4 on: an NDEF message in its TLV, as the server built it. */
struct Sticker {
  size_t len;
  uint8_t bytes[STICKER_MAX];
};

struct PairResult {
  char token[96];
  char deviceName[NAME_LEN];
  char workspaceName[NAME_LEN];
};

struct ItemList {
  size_t count;
  Item items[MAX_ITEMS];
};

bool parseOverview(const char *json, size_t len, Overview &out);
bool parseTag(const char *json, size_t len, TagInfo &out);
bool parsePair(const char *json, size_t len, PairResult &out);
bool parseItemList(const char *json, size_t len, ItemList &out);
/**
 * The "sticker" of a response (hex) as bytes. False when there is none, or when it is not an NDEF TLV that ends
 * in a terminator, so the display never writes something it did not mean to.
 */
bool parseSticker(const char *json, size_t len, Sticker &out);
/** The "error" or "message" text of a response, or "" when it has neither. */
void parseMessage(const char *json, size_t len, char *out, size_t outLen);

/** "#1a2b3c" → 0x1A2B3C. False for anything else. */
bool parseColor(const char *text, uint32_t &out);

/**
 * A set-up code as typed: capitals and digits only, the way the server compares it. True when it has the
 * twelve characters a code always has.
 */
bool normalizeCode(const char *in, char *out, size_t outLen);

/**
 * A server address as typed on a phone: trimmed, "http://" added when no scheme was given, no trailing
 * slash. False when nothing usable is left or the scheme is not http or https.
 */
bool normalizeServer(const char *in, char *out, size_t outLen);
bool isHttps(const char *url);

/** Reader bytes as the server expects them: two capital hex digits per byte. */
void uidToHex(const uint8_t *uid, size_t len, char *out, size_t outLen);

/**
 * How many bytes of NDEF a sticker can take, from its capability container (page 3): 0xE1, the version, the
 * size in 8-byte units, then the access byte. 0 when it is not formatted for NDEF or is locked against writing.
 */
size_t stickerCapacity(const uint8_t cc[4]);

/** How many 4-byte pages `len` bytes take on a sticker. */
inline size_t stickerPages(size_t len) { return (len + 3) / 4; }

/** Page `index` of what to write (0 goes to the sticker's page 4), with zeros after the end. */
void stickerPage(const Sticker &sticker, size_t index, uint8_t out[4]);

/** Waits between failed polls: 5 s, doubling, at most 5 minutes. `failures` counts from 1. */
uint32_t backoffMs(unsigned failures);

/** "just now", "1 min ago", "12 min ago", "3 h ago". */
void formatAgo(uint32_t seconds, char *out, size_t outLen);

/** One heater read back from the printer's temperature line. */
struct Heat {
  char label[12];  // "Nozzle", "Bed"
  int current;
  int target;      // 0 when it has none (off, or cooling down)
};
constexpr size_t MAX_HEATS = 3;

/**
 * The server's temperature line ("Nozzle 220/220 C  Bed 60 C") as heaters, for the dials. Returns how many
 * were read; 0 when the line is empty or not in that form, and the screen then shows the line as text.
 */
size_t parseHeats(const char *temps, Heat *out, size_t max);

/** Set-up sent over USB by the web app's flasher, in place of the phone page. */
struct UsbSetup {
  char ssid[33];
  char password[65];
  char url[128];   // normalised, as normalizeServer gives it
  char code[16];   // normalised, as normalizeCode gives it
  bool insecure;
};

/**
 * One line of JSON: {"ssid":"...","password":"...","url":"...","code":"...","insecure":false}. Returns null when
 * it is usable, or why not in a few words.
 */
const char *parseUsbSetup(const char *json, size_t len, UsbSetup &out);

/** Copy that always ends in a NUL and never overruns. */
void copyText(char *out, size_t outLen, const char *in);

}  // namespace wb
