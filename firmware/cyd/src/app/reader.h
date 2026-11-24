// An optional NFC/RFID reader. The display works the same without one; with one, a tapped tag's UID is passed
// to the screen, and a spool's NTAG sticker can be written. A Bambu Lab spool's own tag is also unlocked and its data read, since its UID alone does not
// say which spool it is. Only the PN532 over I2C is supported (the CYD has no free SPI pins for an RC522).
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "wb_core.h"

namespace reader {

/** Look for a reader on the CYD's 4-pin connector (SDA 22, SCL 27). False when none answers. */
bool begin();
/** Start reading tags on a task of its own. Each new tag arrives through take(). */
void start();
/**
 * The UID of a newly tapped tag, as hex, if one is waiting. The same tag is ignored for 3 s.
 * `blocks` gets a Bambu Lab spool's data blocks as the inside of a JSON object ("1":"…","2":"…"), or "" for
 * any other tag. It needs wb::BAMBU_JSON_LEN bytes.
 */
bool take(char *uidHex, size_t len, char *blocks, size_t blocksLen);

/** How writing a sticker went. */
enum class WriteOutcome : uint8_t {
  Written,      // written and read back the same
  WrongTag,     // another tag was held up; still waiting for the right one
  NotWritable,  // not an NTAG sticker formatted for NDEF, or locked
  TooSmall,     // an NTAG213 or smaller: the link and the spool's details do not fit
  Failed,       // it moved away or the write did not read back: the sticker may be half written, so try again
};

/**
 * Write `sticker` onto the tag with this UID (hex, as take() gives it) when it is next on the reader; it may be
 * there already. Until it is written or cancelled, tags held up are not passed on as taps. Replaces any write
 * still waiting.
 */
void write(const char *uidHex, const wb::Sticker &sticker);
/** Forget a write still waiting. One already under way finishes, and its outcome is dropped. */
void cancelWrite();
/** The outcome of the write asked for, once there is one. WrongTag can come more than once. */
bool written(WriteOutcome &out);

}  // namespace reader
