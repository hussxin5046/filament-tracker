// PN532 in I2C mode on the CYD's 4-pin connector CN1: 3.3V, GND, IO22 (SDA), IO27 (SCL).
#include <Adafruit_PN532.h>
#include <Arduino.h>
#include <Wire.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>
#include <freertos/task.h>
#include <string.h>

#include "reader.h"
#include "wb_bambu.h"
#include "wb_core.h"

namespace reader {
namespace {

constexpr int SDA_PIN = 22, SCL_PIN = 27;
constexpr uint32_t SAME_TAG_MS = 3000;
constexpr uint8_t NO_PIN = 255;  // IRQ and reset are not wired; the library then polls over I2C

Adafruit_PN532 *nfc = nullptr;
QueueHandle_t taps = nullptr;

// A sticker waiting to be written. The screen asks (write), this task does it; the lock guards the hand-over.
SemaphoreHandle_t jobLock = nullptr;
bool jobWaiting = false;
uint32_t jobId = 0;  // bumped by each write() and cancelWrite(), so a late outcome of an old job is dropped
char jobUid[24] = "";
wb::Sticker jobSticker;
QueueHandle_t outcomes = nullptr;

struct Outcome {
  uint32_t id;
  WriteOutcome outcome;
};

struct Tap {
  char uid[24];
  char blocks[wb::BAMBU_JSON_LEN];  // a Bambu Lab spool's data, "" for any other tag
};

/**
 * A Bambu Lab spool's tag: unlock each sector with the key that follows from the serial and read the blocks the
 * server wants. False for any other MIFARE Classic tag (the keys do not fit), or when the spool moved mid-read.
 */
bool readBambu(uint8_t *uid, uint8_t len, char *json, size_t jsonLen) {
  uint8_t keys[wb::BAMBU_SECTORS][wb::MIFARE_KEY_LEN];
  wb::bambuKeys(uid, len, keys);
  json[0] = '\0';
  int unlocked = -1;
  for (const uint8_t block : wb::BAMBU_BLOCKS) {
    const int sector = block / 4;
    if (sector != unlocked) {
      if (!nfc->mifareclassic_AuthenticateBlock(uid, len, block, 0, keys[sector])) return false;
      unlocked = sector;
    }
    uint8_t data[16];
    if (!nfc->mifareclassic_ReadDataBlock(block, data)) return false;
    if (!wb::appendBlockJson(json, jsonLen, block, data)) return false;
  }
  return true;
}

// NTAG stickers keep their NDEF in 4-byte pages from page 4; page 3 is the capability container.
constexpr uint8_t FIRST_PAGE = 4, CC_PAGE = 3;
constexpr size_t NTAG_UID_LEN = 7;

/**
 * Write the sticker to the NTAG on the reader and read every page back. Page 4 (the start of the NDEF TLV) is
 * first set to an empty message and written for real last, so a sticker pulled away part way reads as empty
 * rather than as a broken mix of old and new.
 */
WriteOutcome writeSticker(uint8_t uidLen, const wb::Sticker &sticker) {
  // Bambu Lab spools (and other MIFARE Classic tags) have 4-byte serials and are never written.
  if (uidLen != NTAG_UID_LEN) return WriteOutcome::NotWritable;
  uint8_t cc[4];
  if (!nfc->ntag2xx_ReadPage(CC_PAGE, cc)) return WriteOutcome::Failed;
  const size_t capacity = wb::stickerCapacity(cc);
  if (!capacity) return WriteOutcome::NotWritable;
  if (sticker.len > capacity) return WriteOutcome::TooSmall;

  const size_t pages = wb::stickerPages(sticker.len);
  uint8_t empty[4] = {0x03, 0x00, 0xFE, 0x00};
  if (!nfc->ntag2xx_WritePage(FIRST_PAGE, empty)) return WriteOutcome::Failed;
  uint8_t data[4];
  for (size_t index = 1; index < pages; index++) {
    wb::stickerPage(sticker, index, data);
    if (!nfc->ntag2xx_WritePage(FIRST_PAGE + index, data)) return WriteOutcome::Failed;
  }
  wb::stickerPage(sticker, 0, data);
  if (!nfc->ntag2xx_WritePage(FIRST_PAGE, data)) return WriteOutcome::Failed;

  // The library does not check the tag's answer to a write, so reading back is what says it worked.
  uint8_t back[4];
  for (size_t index = 0; index < pages; index++) {
    wb::stickerPage(sticker, index, data);
    if (!nfc->ntag2xx_ReadPage(FIRST_PAGE + index, back) || memcmp(back, data, 4) != 0) return WriteOutcome::Failed;
  }
  return WriteOutcome::Written;
}

/** If a write is waiting: true, with its id, the UID it is for and (in `sticker`) what to write. */
bool waitingJob(uint32_t &id, char *uid, size_t uidLen, wb::Sticker &sticker) {
  xSemaphoreTake(jobLock, portMAX_DELAY);
  const bool waiting = jobWaiting;
  if (waiting) {
    id = jobId;
    wb::copyText(uid, uidLen, jobUid);
    sticker = jobSticker;
  }
  xSemaphoreGive(jobLock);
  return waiting;
}

/** Pass an outcome to the screen, unless the write was cancelled or replaced meanwhile. Only WrongTag keeps it waiting. */
void report(uint32_t id, WriteOutcome outcome) {
  xSemaphoreTake(jobLock, portMAX_DELAY);
  // Queued under the lock, so a write() or cancelWrite() that comes meanwhile clears it rather than missing it.
  if (id == jobId) {
    if (outcome != WriteOutcome::WrongTag) jobWaiting = false;
    const Outcome said{id, outcome};
    xQueueSend(outcomes, &said, 0);
  }
  xSemaphoreGive(jobLock);
}

void task(void *) {
  char last[24] = "";
  uint32_t lastAt = 0;
  for (;;) {
    uint8_t uid[10];
    uint8_t len = 0;
    // A short timeout so a missing card never holds the bus for long.
    if (nfc->readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &len, 80) && len >= 4 && len <= 10) {
      Tap tap{};
      wb::uidToHex(uid, len, tap.uid, sizeof tap.uid);
      const uint32_t now = millis();
      static wb::Sticker sticker;  // too big for this task's stack
      uint32_t id = 0;
      char wanted[24];
      if (waitingJob(id, wanted, sizeof wanted, sticker)) {
        // Writing a sticker: the tag held up is the one to write, or it is said to be the wrong one. Never a tap.
        if (strcmp(tap.uid, wanted) == 0) {
          report(id, writeSticker(len, sticker));
        } else if (strcmp(tap.uid, last) != 0 || now - lastAt > SAME_TAG_MS) {
          report(id, WriteOutcome::WrongTag);
        }
      } else if (strcmp(tap.uid, last) != 0 || now - lastAt > SAME_TAG_MS) {
        // Bambu's tags have a 4-byte serial. Anything else, or a tag the keys do not open, is passed on by its UID alone.
        if (len == 4 && !readBambu(uid, len, tap.blocks, sizeof tap.blocks)) tap.blocks[0] = '\0';
        xQueueSend(taps, &tap, 0);
      }
      // Kept fresh while the tag stays on the reader, so leaving it there does not repeat it every 3 s.
      wb::copyText(last, sizeof last, tap.uid);
      lastAt = now;
    }
    vTaskDelay(pdMS_TO_TICKS(150));
  }
}

}  // namespace

bool begin() {
  Wire.begin(SDA_PIN, SCL_PIN, 100000);
  Wire.setTimeOut(50);
  // A quick knock on the PN532's address first: without a reader the library would retry for ~20 s.
  Wire.beginTransmission(PN532_I2C_ADDRESS);
  if (Wire.endTransmission() != 0) {
    Wire.end();
    return false;
  }
  nfc = new Adafruit_PN532(NO_PIN, NO_PIN, &Wire);
  if (!nfc->begin()) return false;
  const uint32_t version = nfc->getFirmwareVersion();
  if (!version) return false;
  Serial.printf("Tag reader: PN5%02X firmware %u.%u\n", static_cast<unsigned>((version >> 24) & 0xFF), static_cast<unsigned>((version >> 16) & 0xFF),
                static_cast<unsigned>((version >> 8) & 0xFF));
  nfc->SAMConfig();
  return true;
}

void start() {
  if (!nfc || taps) return;
  taps = xQueueCreate(2, sizeof(Tap));
  jobLock = xSemaphoreCreateMutex();
  outcomes = xQueueCreate(4, sizeof(Outcome));
  xTaskCreatePinnedToCore(task, "wb-reader", 6144, nullptr, 1, nullptr, 0);
}

bool take(char *uidHex, size_t len, char *blocks, size_t blocksLen) {
  static Tap tap;  // too big for the screen task's stack to hold twice
  if (!taps || xQueueReceive(taps, &tap, 0) != pdTRUE) return false;
  wb::copyText(uidHex, len, tap.uid);
  wb::copyText(blocks, blocksLen, tap.blocks);
  return true;
}

void write(const char *uidHex, const wb::Sticker &sticker) {
  if (!jobLock) return;
  xSemaphoreTake(jobLock, portMAX_DELAY);
  jobId++;
  wb::copyText(jobUid, sizeof jobUid, uidHex);
  jobSticker = sticker;
  jobWaiting = true;
  xQueueReset(outcomes);
  xSemaphoreGive(jobLock);
}

void cancelWrite() {
  if (!jobLock) return;
  xSemaphoreTake(jobLock, portMAX_DELAY);
  jobId++;
  jobWaiting = false;
  xQueueReset(outcomes);
  xSemaphoreGive(jobLock);
}

bool written(WriteOutcome &out) {
  if (!outcomes) return false;
  Outcome said;
  // An outcome of a write since replaced or cancelled was never queued, or was cleared then.
  if (xQueueReceive(outcomes, &said, 0) != pdTRUE) return false;
  out = said.outcome;
  return true;
}

}  // namespace reader
