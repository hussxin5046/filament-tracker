// Talking to the Wrkbench server, on a FreeRTOS task of its own so a slow network never freezes the screen.
// The screen sends Commands and receives Results through queues; nothing here touches LVGL.
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "store.h"
#include "wb_bambu.h"
#include "wb_core.h"

namespace net {

enum class Phase : uint8_t {
  Connecting,   // waiting for Wi-Fi
  Pairing,      // swapping a set-up code for a token
  NeedCode,     // no token and no code: the screen asks for one
  Online,       // the last poll worked
  Offline,      // the last poll failed; showing what we had
};

struct Status {
  Phase phase;
  uint32_t lastOkMs;  // millis() of the last answer from the server, 0 if none yet
  char message[96];   // why it is offline, in a few words
  int rssi;
  char ip[16];
};

enum class CommandType : uint8_t {
  Pair,      // arg: a 12-character set-up code
  Browse,    // arg: a location id, or "" for the display's own location
  Refresh,   // poll now
  Tap,       // arg: UID in hex, blocks: a Bambu spool's data. The server tags the spool in or out
  Tag,       // arg: tag key (a UID, or what the server answered a tap with): look it up, change nothing
  PutAway,   // arg: tag key
  Insert,    // arg: tag key
  Link,      // arg: tag key, arg2: item id
  TakeOut,   // arg: the id of the item the display is lit for. It is taken out: on the move
  Untagged,  // items here without a tag
  Forget,    // drop the token: the display asks for a new set-up code
};

struct Command {
  CommandType type;
  char arg[40];
  char arg2[32];
  char blocks[wb::BAMBU_JSON_LEN];  // Tap only: the inside of a JSON object, or ""
};

enum class ResultType : uint8_t {
  Overview,      // data: wb::Overview*, which the receiver frees
  Tag,           // data: wb::TagInfo*; message: what a tap did, "" for a plain look-up
  Untagged,      // data: wb::ItemList*
  Action,        // ok + message (put away, insert, link, take out)
  Paired,        // message: the display's name
  PairFailed,    // message: why
  Unauthorized,  // the token stopped working: removed or set up again elsewhere
  Updating,      // new firmware is being installed; message: how far along. The board restarts when done
  UpdateFailed,  // message: why; the display keeps running what it had
};

struct Result {
  ResultType type;
  bool ok;
  char message[96];
  void *data;
};

/** Start the task. `settings` is copied; `hasReader` is reported to the server with each poll. */
void start(const store::Settings &settings, bool hasReader);
void send(const Command &command);
/** A result waiting for the screen, if any. */
bool receive(Result &out);
Status status();

}  // namespace net
