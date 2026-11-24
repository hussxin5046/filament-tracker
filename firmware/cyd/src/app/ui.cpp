#include "ui.h"

#include <Arduino.h>
#include <WiFi.h>
#include <lvgl.h>
#include <stdio.h>
#include <string.h>

#include "display.h"
#include "net.h"
#include "reader.h"
#include "wb_core.h"

#ifndef WB_VERSION
#define WB_VERSION "dev"
#endif
#ifndef WB_PANEL
#define WB_PANEL "unknown"
#endif

namespace ui {
namespace {

// ---- Look ----------------------------------------------------------------------------------
const lv_color_t BG = lv_color_hex(0x111418);
const lv_color_t SURFACE = lv_color_hex(0x1C2128);
const lv_color_t TEXT = lv_color_hex(0xF2F4F7);
const lv_color_t MUTED = lv_color_hex(0x9AA4B0);
const lv_color_t ACCENT = lv_color_hex(0x4F8CFF);
const lv_color_t OK = lv_color_hex(0x34C759);
const lv_color_t WARN = lv_color_hex(0xFF9F0A);
const lv_color_t DANGER = lv_color_hex(0xFF5C5C);
const lv_color_t LOW_ROW = lv_color_hex(0x3A1D1F);
const lv_color_t LIT_ROW = lv_color_hex(0x1B2C4A);

constexpr int W = 320, H = 240, HEADER_H = 44;
constexpr uint32_t BROWSE_RETURN_MS = 120000;  // back to the display's own location after 2 idle minutes
constexpr uint32_t CARD_CLOSE_MS = 20000;
constexpr uint32_t DIM_AFTER_MS = 5 * 60000;
// A spool someone is looking for stays lit while the server says so. Out of touch with the server for this long,
// nothing can say it was taken out, so the display stops by itself.
constexpr uint32_t FIND_STALE_MS = 60000;

enum class View { None, Setup, Busy, Code, Overview, Places, About, Printer };

store::Settings settings;
bool readerFitted = false;
View view = View::None;
lv_obj_t *screen = nullptr;
wb::Overview *overview = nullptr;  // owned here; replaced as new ones arrive
bool browsing = false;
char litFor[wb::ID_LEN] = "";  // the item the display is lit for, "" when nobody is looking for one

// Overview widgets that change without rebuilding the screen.
lv_obj_t *statusDot = nullptr;
lv_obj_t *subtitle = nullptr;

// The tap card on the top layer.
lv_obj_t *card = nullptr;
lv_timer_t *cardTimer = nullptr;
wb::TagInfo *tag = nullptr;
// What the tap that opened the card did ("Taken out: on the move"), "" when it changed nothing.
char tagNote[96] = "";
wb::ItemList *untagged = nullptr;
char pendingLinkItem[wb::ID_LEN] = "";
// A sticker being written: what to write, onto which tag, and whether the reader is waiting for it now.
wb::Sticker *toWrite = nullptr;
char writeUid[40] = "";
bool writing = false;
bool writeAfterLink = false;  // the tag was linked just before, and stays linked whatever the write does
lv_obj_t *toastLabel = nullptr;
lv_timer_t *toastTimer = nullptr;
bool aboutArmed = false;  // "Set up again" needs a second press

// ---- Small builders --------------------------------------------------------------------------
lv_obj_t *label(lv_obj_t *parent, const char *text, const lv_font_t *font = &lv_font_montserrat_14, lv_color_t colour = TEXT) {
  lv_obj_t *l = lv_label_create(parent);
  lv_label_set_text(l, text);
  lv_obj_set_style_text_font(l, font, 0);
  lv_obj_set_style_text_color(l, colour, 0);
  return l;
}

/**
 * Keep a label to one line, ending in "..." when it does not fit. LVGL only cuts with dots when the height is
 * fixed; left to size itself, a long name wraps onto the line below (seen on a real board).
 */
void oneLine(lv_obj_t *l) {
  lv_label_set_long_mode(l, LV_LABEL_LONG_DOT);
  lv_obj_set_height(l, lv_font_get_line_height(lv_obj_get_style_text_font(l, LV_PART_MAIN)));
}

lv_obj_t *plainBox(lv_obj_t *parent) {
  lv_obj_t *o = lv_obj_create(parent);
  lv_obj_set_style_bg_opa(o, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(o, 0, 0);
  lv_obj_set_style_pad_all(o, 0, 0);
  lv_obj_set_style_radius(o, 0, 0);
  lv_obj_remove_flag(o, LV_OBJ_FLAG_SCROLLABLE);
  return o;
}

lv_obj_t *button(lv_obj_t *parent, const char *text, lv_event_cb_t onClick, void *data = nullptr, lv_color_t colour = SURFACE) {
  lv_obj_t *b = lv_button_create(parent);
  lv_obj_set_style_bg_color(b, colour, 0);
  lv_obj_set_style_radius(b, 8, 0);
  lv_obj_set_style_pad_hor(b, 12, 0);
  lv_obj_set_style_pad_ver(b, 9, 0);
  lv_obj_set_style_shadow_width(b, 0, 0);
  lv_obj_t *l = label(b, text);
  lv_obj_center(l);
  lv_obj_add_event_cb(b, onClick, LV_EVENT_CLICKED, data);
  return b;
}

lv_color_t swatchColour(const wb::Item &item) { return item.hasColor ? lv_color_hex(item.color) : lv_color_hex(0x3A414B); }

/** A fresh screen; the old one is deleted once LVGL is done with it (it may be the one handling this tap). */
lv_obj_t *newScreen(View next) {
  lv_obj_t *old = screen;
  screen = lv_obj_create(nullptr);
  lv_obj_set_style_bg_color(screen, BG, 0);
  lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, 0);
  lv_obj_set_style_pad_all(screen, 0, 0);
  lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);
  lv_screen_load(screen);
  if (old) lv_obj_delete_async(old);
  view = next;
  statusDot = nullptr;
  subtitle = nullptr;
  return screen;
}

void toast(const char *text, lv_color_t colour = SURFACE) {
  if (!toastLabel) {
    toastLabel = lv_label_create(lv_layer_top());
    lv_obj_set_style_bg_opa(toastLabel, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(toastLabel, 8, 0);
    lv_obj_set_style_pad_all(toastLabel, 8, 0);
    lv_obj_set_style_text_color(toastLabel, TEXT, 0);
    lv_obj_set_width(toastLabel, W - 32);
    lv_label_set_long_mode(toastLabel, LV_LABEL_LONG_WRAP);
    lv_obj_align(toastLabel, LV_ALIGN_BOTTOM_MID, 0, -8);
  }
  lv_obj_set_style_bg_color(toastLabel, colour, 0);
  lv_label_set_text(toastLabel, text);
  lv_obj_remove_flag(toastLabel, LV_OBJ_FLAG_HIDDEN);
  lv_obj_move_foreground(toastLabel);
  if (toastTimer) lv_timer_delete(toastTimer);
  toastTimer = lv_timer_create([](lv_timer_t *) {
    lv_obj_add_flag(toastLabel, LV_OBJ_FLAG_HIDDEN);
    lv_timer_delete(toastTimer);
    toastTimer = nullptr;
  }, 3500, nullptr);
}

void showOverview();
void showCode(const char *message);
void closeCard();

// ---- Set-up and pairing ----------------------------------------------------------------------
void wipeAndRestart(lv_event_t *);

/** Pressed twice: forget Wi-Fi, server and token, and start set-up from the phone again. */
void onSetupAgain(lv_event_t *e) {
  if (!aboutArmed) {
    aboutArmed = true;
    lv_label_set_text(lv_obj_get_child(static_cast<lv_obj_t *>(lv_event_get_target(e)), 0), "Press again: forget all");
    return;
  }
  wipeAndRestart(e);
}

char shownTitle[64] = "";
char shownDetail[112] = "";

void showMessageScreen(View kind, const char *title, const char *detail, bool spinner) {
  // Called every second while waiting: only redraw when something changed, so the button stays pressable.
  if (view == kind && strcmp(shownTitle, title) == 0 && strcmp(shownDetail, detail ? detail : "") == 0) return;
  wb::copyText(shownTitle, sizeof shownTitle, title);
  wb::copyText(shownDetail, sizeof shownDetail, detail);
  aboutArmed = false;
  lv_obj_t *s = newScreen(kind);
  // A way out when the address or Wi-Fi was entered wrong and the display can never get further.
  lv_obj_t *again = button(s, "Set up again", onSetupAgain, nullptr, lv_color_hex(0x2A3038));
  lv_obj_align(again, LV_ALIGN_BOTTOM_RIGHT, -6, -6);
  lv_obj_t *col = plainBox(s);
  lv_obj_set_size(col, W - 32, H - 60);
  lv_obj_align(col, LV_ALIGN_TOP_MID, 0, 8);
  lv_obj_set_flex_flow(col, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_flex_align(col, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_set_style_pad_row(col, 10, 0);
  if (spinner) {
    lv_obj_t *sp = lv_spinner_create(col);
    lv_obj_set_size(sp, 40, 40);
    lv_obj_set_style_arc_color(sp, ACCENT, LV_PART_INDICATOR);
  }
  label(col, title, &lv_font_montserrat_20);
  lv_obj_t *d = label(col, detail, &lv_font_montserrat_14, MUTED);
  lv_obj_set_width(d, W - 32);
  lv_label_set_long_mode(d, LV_LABEL_LONG_WRAP);
  lv_obj_set_style_text_align(d, LV_TEXT_ALIGN_CENTER, 0);
}

void onCodeKey(lv_event_t *e) {
  const lv_event_code_t code = lv_event_get_code(e);
  lv_obj_t *area = static_cast<lv_obj_t *>(lv_event_get_user_data(e));
  if (code != LV_EVENT_READY) return;
  char normal[16];
  if (!wb::normalizeCode(lv_textarea_get_text(area), normal, sizeof normal)) {
    toast("A set-up code has 12 letters and digits", DANGER);
    return;
  }
  net::Command command{};
  command.type = net::CommandType::Pair;
  wb::copyText(command.arg, sizeof command.arg, normal);
  net::send(command);
  showMessageScreen(View::Busy, "Setting up", "Checking the code with the server", true);
}

void wipeAndRestart(lv_event_t *) {
  store::wipe();
  delay(200);
  ESP.restart();
}

void showCode(const char *message) {
  lv_obj_t *s = newScreen(View::Code);
  lv_obj_t *top = label(s, message && message[0] ? message : "Enter the set-up code from Settings, Displays", &lv_font_montserrat_14,
                        message && message[0] && strcmp(message, "Enter a set-up code") != 0 ? WARN : MUTED);
  lv_obj_set_width(top, W - 110);
  lv_label_set_long_mode(top, LV_LABEL_LONG_WRAP);
  lv_obj_align(top, LV_ALIGN_TOP_LEFT, 8, 6);
  lv_obj_t *again = button(s, "Wi-Fi...", wipeAndRestart);
  lv_obj_align(again, LV_ALIGN_TOP_RIGHT, -6, 4);
  lv_obj_t *area = lv_textarea_create(s);
  lv_textarea_set_one_line(area, true);
  lv_textarea_set_max_length(area, 14);
  lv_textarea_set_placeholder_text(area, "ABCD-EFGH-JKMN");
  lv_obj_set_style_text_font(area, &lv_font_montserrat_20, 0);
  lv_obj_set_size(area, W - 16, 44);
  lv_obj_align(area, LV_ALIGN_TOP_MID, 0, 44);
  lv_obj_t *kb = lv_keyboard_create(s);
  lv_keyboard_set_mode(kb, LV_KEYBOARD_MODE_TEXT_UPPER);
  lv_keyboard_set_textarea(kb, area);
  lv_obj_set_size(kb, W, H - 94);
  lv_obj_align(kb, LV_ALIGN_BOTTOM_MID, 0, 0);
  lv_obj_add_event_cb(kb, onCodeKey, LV_EVENT_READY, area);
}

// ---- Overview --------------------------------------------------------------------------------
void browse(const char *locationId) {
  net::Command command{};
  command.type = net::CommandType::Browse;
  wb::copyText(command.arg, sizeof command.arg, locationId ? locationId : "");
  net::send(command);
  browsing = locationId && locationId[0];
}

void showPlaces();
void showAbout();
void showPrinter();

lv_color_t toneColour(wb::Tone tone) {
  switch (tone) {
    case wb::Tone::Ok: return OK;
    case wb::Tone::Busy: return ACCENT;
    case wb::Tone::Warn: return WARN;
    case wb::Tone::Error: return DANGER;
    default: return MUTED;
  }
}

constexpr int STRIP_H = 30;

/** One line under the header: the printer beside the display, tap for more. */
void addPrinterStrip(lv_obj_t *s, const wb::PrinterInfo &p) {
  lv_obj_t *strip = plainBox(s);
  lv_obj_set_size(strip, W, STRIP_H);
  lv_obj_align(strip, LV_ALIGN_TOP_LEFT, 0, HEADER_H);
  lv_obj_set_style_bg_color(strip, lv_color_hex(0x161B22), 0);
  lv_obj_set_style_bg_opa(strip, LV_OPA_COVER, 0);
  lv_obj_add_flag(strip, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_add_event_cb(strip, [](lv_event_t *) { showPrinter(); }, LV_EVENT_CLICKED, nullptr);

  lv_obj_t *dot = lv_obj_create(strip);
  lv_obj_set_size(dot, 10, 10);
  lv_obj_set_style_radius(dot, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_border_width(dot, 0, 0);
  lv_obj_set_style_bg_color(dot, toneColour(p.tone), 0);
  lv_obj_align(dot, LV_ALIGN_LEFT_MID, 8, -1);
  lv_obj_remove_flag(dot, LV_OBJ_FLAG_CLICKABLE);

  char text[120];
  if (p.progress >= 0) {
    snprintf(text, sizeof text, "%s  %s %d%%%s%s", p.name, p.state, static_cast<int>(p.progress * 100 + 0.5f), p.left[0] ? ", " : "", p.left);
  } else {
    snprintf(text, sizeof text, "%s  %s", p.name, p.state);
  }
  lv_obj_t *l = label(strip, text, &lv_font_montserrat_14, p.tone == wb::Tone::Error ? DANGER : TEXT);
  lv_obj_set_width(l, W - 46);
  oneLine(l);
  lv_obj_align(l, LV_ALIGN_LEFT_MID, 24, -1);
  lv_obj_t *more = label(strip, LV_SYMBOL_RIGHT, &lv_font_montserrat_14, MUTED);
  lv_obj_align(more, LV_ALIGN_RIGHT_MID, -8, -1);

  if (p.progress >= 0) {
    lv_obj_t *bar = lv_bar_create(strip);
    lv_obj_set_size(bar, W, 3);
    lv_bar_set_value(bar, static_cast<int32_t>(p.progress * 100 + 0.5f), LV_ANIM_OFF);
    lv_obj_set_style_radius(bar, 0, LV_PART_MAIN);
    lv_obj_set_style_radius(bar, 0, LV_PART_INDICATOR);
    lv_obj_set_style_bg_color(bar, lv_color_hex(0x2A3038), LV_PART_MAIN);
    lv_obj_set_style_bg_color(bar, toneColour(p.tone), LV_PART_INDICATOR);
    lv_obj_align(bar, LV_ALIGN_BOTTOM_MID, 0, 0);
  }
}

void onHeader(lv_event_t *e) {
  if (lv_event_get_code(e) == LV_EVENT_LONG_PRESSED) showAbout();
  else if (lv_event_get_code(e) == LV_EVENT_SHORT_CLICKED) showPlaces();
}

void refreshStatus() {
  if (!statusDot || !subtitle) return;
  const net::Status st = net::status();
  const bool online = st.phase == net::Phase::Online;
  lv_obj_set_style_bg_color(statusDot, online ? OK : WARN, 0);
  char text[120];
  if (online || st.lastOkMs == 0) {
    // The path only when it says more than the title (a location inside another), then how many items.
    if (!overview) text[0] = '\0';
    else if (!overview->hasLocation) wb::copyText(text, sizeof text, overview->workspace);
    else {
      const bool nested = strcmp(overview->path, overview->location.name) != 0;
      snprintf(text, sizeof text, "%s%s%d item%s", nested ? overview->path : "", nested ? " - " : "", overview->total, overview->total == 1 ? "" : "s");
    }
  } else {
    char ago[24];
    wb::formatAgo((millis() - st.lastOkMs) / 1000, ago, sizeof ago);
    snprintf(text, sizeof text, "Offline, updated %s", ago);
  }
  lv_label_set_text(subtitle, text);
  lv_obj_set_style_text_color(subtitle, online ? MUTED : WARN, 0);
}

/** `lit`: the spool someone is looking for. Its row has a bright outline that pulses, to catch the eye across a room. */
void addRow(lv_obj_t *list, const wb::Item &item, lv_event_cb_t onClick = nullptr, void *data = nullptr, bool lit = false) {
  lv_obj_t *row = plainBox(list);
  lv_obj_set_size(row, lv_pct(100), 48);
  lv_obj_set_style_bg_color(row, lit ? LIT_ROW : item.low ? LOW_ROW : SURFACE, 0);
  lv_obj_set_style_bg_opa(row, LV_OPA_COVER, 0);
  lv_obj_set_style_radius(row, 6, 0);
  if (lit) {
    lv_obj_set_style_border_color(row, ACCENT, 0);
    lv_obj_set_style_border_width(row, 2, 0);
    lv_anim_t pulse;
    lv_anim_init(&pulse);
    lv_anim_set_var(&pulse, row);
    lv_anim_set_values(&pulse, LV_OPA_20, LV_OPA_COVER);
    lv_anim_set_duration(&pulse, 600);
    lv_anim_set_playback_duration(&pulse, 600);
    lv_anim_set_repeat_count(&pulse, LV_ANIM_REPEAT_INFINITE);
    lv_anim_set_exec_cb(&pulse, [](void *obj, int32_t opa) { lv_obj_set_style_border_opa(static_cast<lv_obj_t *>(obj), static_cast<lv_opa_t>(opa), 0); });
    lv_anim_start(&pulse);  // ends with the row: LVGL drops an object's animations when it is deleted
  }
  if (onClick) {
    lv_obj_add_flag(row, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(row, onClick, LV_EVENT_CLICKED, data);
  }
  lv_obj_t *swatch = lv_obj_create(row);
  lv_obj_set_size(swatch, 10, 34);
  lv_obj_align(swatch, LV_ALIGN_LEFT_MID, 6, 0);
  lv_obj_set_style_bg_color(swatch, swatchColour(item), 0);
  lv_obj_set_style_border_width(swatch, 1, 0);
  lv_obj_set_style_border_color(swatch, lv_color_hex(0x55606C), 0);
  lv_obj_set_style_radius(swatch, 3, 0);
  lv_obj_remove_flag(swatch, LV_OBJ_FLAG_CLICKABLE);

  lv_obj_t *name = label(row, item.name);
  lv_obj_set_width(name, 200);
  oneLine(name);
  lv_obj_align(name, LV_ALIGN_TOP_LEFT, 24, 6);
  char sub[96];
  if (item.at[0]) snprintf(sub, sizeof sub, "%s  - at %s", item.sub, item.at);
  else wb::copyText(sub, sizeof sub, item.sub);
  lv_obj_t *subLabel = label(row, sub, &lv_font_montserrat_14, MUTED);
  lv_obj_set_width(subLabel, 200);
  oneLine(subLabel);
  lv_obj_align(subLabel, LV_ALIGN_TOP_LEFT, 24, 26);

  lv_obj_t *qty = label(row, item.qty, &lv_font_montserrat_14, item.low ? DANGER : TEXT);
  lv_obj_align(qty, LV_ALIGN_TOP_RIGHT, -8, 6);
  if (item.fill >= 0) {
    lv_obj_t *bar = lv_bar_create(row);
    lv_obj_set_size(bar, 64, 6);
    lv_bar_set_range(bar, 0, 100);
    lv_bar_set_value(bar, static_cast<int32_t>(item.fill * 100 + 0.5f), LV_ANIM_OFF);
    lv_obj_set_style_bg_color(bar, lv_color_hex(0x343B45), LV_PART_MAIN);
    lv_obj_set_style_bg_color(bar, item.low ? DANGER : ACCENT, LV_PART_INDICATOR);
    lv_obj_align(bar, LV_ALIGN_BOTTOM_RIGHT, -8, -9);
  }
}

/** The lit row was touched: take that spool out. The answer comes back as a toast. */
void onTakeOut(lv_event_t *) {
  if (!overview || !overview->hasFind) return;
  net::Command command{};
  command.type = net::CommandType::TakeOut;
  wb::copyText(command.arg, sizeof command.arg, overview->find.id);
  net::send(command);
  toast("Taking it out...");
}

void showOverview() {
  lv_obj_t *s = newScreen(View::Overview);
  // Header: tap for other locations, hold for details.
  lv_obj_t *header = plainBox(s);
  lv_obj_set_size(header, W, HEADER_H);
  lv_obj_set_style_bg_color(header, SURFACE, 0);
  lv_obj_set_style_bg_opa(header, LV_OPA_COVER, 0);
  lv_obj_add_flag(header, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_add_event_cb(header, onHeader, LV_EVENT_SHORT_CLICKED, nullptr);
  lv_obj_add_event_cb(header, onHeader, LV_EVENT_LONG_PRESSED, nullptr);

  char title[80];
  if (!overview) wb::copyText(title, sizeof title, "Loading...");
  else if (!overview->hasLocation) wb::copyText(title, sizeof title, overview->device);
  else snprintf(title, sizeof title, "%s%s", browsing ? LV_SYMBOL_LEFT " " : "", overview->location.name);
  lv_obj_t *t = label(header, title, &lv_font_montserrat_20);
  lv_obj_set_width(t, 230);
  oneLine(t);
  lv_obj_align(t, LV_ALIGN_TOP_LEFT, 8, 2);
  subtitle = label(header, "", &lv_font_montserrat_14, MUTED);
  lv_obj_set_width(subtitle, 250);
  oneLine(subtitle);
  lv_obj_align(subtitle, LV_ALIGN_BOTTOM_LEFT, 8, -2);

  statusDot = lv_obj_create(header);
  lv_obj_set_size(statusDot, 10, 10);
  lv_obj_set_style_radius(statusDot, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_border_width(statusDot, 0, 0);
  lv_obj_align(statusDot, LV_ALIGN_TOP_RIGHT, -8, 8);
  lv_obj_remove_flag(statusDot, LV_OBJ_FLAG_CLICKABLE);
  if (overview && overview->lowCount > 0) {
    char low[24];
    snprintf(low, sizeof low, "%d low", overview->lowCount);
    lv_obj_t *pill = label(header, low, &lv_font_montserrat_14, DANGER);
    lv_obj_align(pill, LV_ALIGN_BOTTOM_RIGHT, -8, -3);
  }
  const bool strip = overview && overview->hasPrinter;
  if (strip) addPrinterStrip(s, overview->printer);

  lv_obj_t *list = lv_obj_create(s);
  lv_obj_set_size(list, W, H - HEADER_H - (strip ? STRIP_H : 0));
  lv_obj_align(list, LV_ALIGN_BOTTOM_MID, 0, 0);
  lv_obj_set_style_bg_opa(list, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(list, 0, 0);
  lv_obj_set_style_radius(list, 0, 0);
  lv_obj_set_style_pad_all(list, 6, 0);
  lv_obj_set_style_pad_row(list, 4, 0);
  lv_obj_set_flex_flow(list, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_scrollbar_mode(list, LV_SCROLLBAR_MODE_ACTIVE);

  // A spool someone is looking for comes first, whatever else is on the list and wherever it would be sorted.
  const bool lit = overview && overview->hasFind;
  if (lit) {
    label(list, overview->canWrite ? "Take this one, then touch it" : "Take this one", &lv_font_montserrat_14, ACCENT);
    addRow(list, overview->find, overview->canWrite ? onTakeOut : nullptr, nullptr, true);
  }
  if (!overview) {
    label(list, "Waiting for the server...", &lv_font_montserrat_14, MUTED);
  } else if (!overview->hasLocation) {
    lv_obj_t *l = label(list, "No location chosen for this display yet. Pick one in Wrkbench: Settings, Displays. Or tap the top bar to look at one here.",
                        &lv_font_montserrat_14, MUTED);
    lv_obj_set_width(l, lv_pct(100));
    lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
  } else if (overview->itemCount == 0) {
    if (!lit) label(list, "Nothing is stored here.", &lv_font_montserrat_14, MUTED);
  } else {
    for (size_t i = 0; i < overview->itemCount; i++) {
      if (lit && strcmp(overview->items[i].id, overview->find.id) == 0) continue;  // already at the top
      addRow(list, overview->items[i]);
    }
    if (overview->total > static_cast<int>(overview->itemCount)) {
      char more[48];
      snprintf(more, sizeof more, "+%d more in Wrkbench", overview->total - static_cast<int>(overview->itemCount));
      label(list, more, &lv_font_montserrat_14, MUTED);
    }
  }
  refreshStatus();
}

void onPlace(lv_event_t *e) {
  const intptr_t index = reinterpret_cast<intptr_t>(lv_event_get_user_data(e));
  browse(index < 0 || !overview ? "" : overview->places[index].id);
  showMessageScreen(View::Busy, "Loading", "", true);
}

void backToOverview(lv_event_t *) { showOverview(); }

void showPlaces() {
  lv_obj_t *s = newScreen(View::Places);
  lv_obj_t *head = label(s, "Show another location", &lv_font_montserrat_20);
  lv_obj_align(head, LV_ALIGN_TOP_LEFT, 8, 8);
  lv_obj_t *close = button(s, LV_SYMBOL_CLOSE, backToOverview);
  lv_obj_align(close, LV_ALIGN_TOP_RIGHT, -6, 4);
  lv_obj_t *list = lv_list_create(s);
  lv_obj_set_size(list, W, H - HEADER_H);
  lv_obj_align(list, LV_ALIGN_BOTTOM_MID, 0, 0);
  lv_obj_set_style_bg_color(list, BG, 0);
  lv_obj_set_style_border_width(list, 0, 0);
  lv_obj_t *own = lv_list_add_button(list, LV_SYMBOL_HOME, "This display's own location");
  lv_obj_add_event_cb(own, onPlace, LV_EVENT_CLICKED, reinterpret_cast<void *>(static_cast<intptr_t>(-1)));
  if (overview) {
    for (size_t i = 0; i < overview->placeCount; i++) {
      lv_obj_t *b = lv_list_add_button(list, nullptr, overview->places[i].name);
      lv_obj_add_event_cb(b, onPlace, LV_EVENT_CLICKED, reinterpret_cast<void *>(static_cast<intptr_t>(i)));
    }
  }
}

void onNewCode(lv_event_t *) {
  net::Command command{};
  command.type = net::CommandType::Forget;
  net::send(command);
  free(overview);
  overview = nullptr;
  showCode(nullptr);
}

constexpr int TRAYS_TOP = H - 36 - 22;  // where the spool boxes along the bottom start

/** The top of a heater's dial scale, in C. */
int heatScale(const char *label) {
  if (!strcmp(label, "Nozzle")) return 350;
  if (!strcmp(label, "Bed")) return 120;
  if (!strcmp(label, "Chamber")) return 70;
  return 100;
}

/**
 * One heater: a 270-degree dial with the temperature in the middle, and beside it the name and what it is
 * set to. Blue while heating, green at its target, orange while hot with no target (cooling), grey when cold.
 */
void addDial(lv_obj_t *s, const wb::Heat &h, int x, int y, int size, int cellW) {
  lv_color_t colour;
  if (h.target > 0) colour = abs(h.current - h.target) <= 5 ? OK : ACCENT;
  else colour = h.current >= 50 ? WARN : lv_color_hex(0x55606C);

  lv_obj_t *arc = lv_arc_create(s);
  lv_obj_set_size(arc, size, size);
  lv_obj_align(arc, LV_ALIGN_TOP_LEFT, x, y);
  lv_arc_set_rotation(arc, 135);
  lv_arc_set_bg_angles(arc, 0, 270);
  lv_arc_set_range(arc, 0, heatScale(h.label));
  lv_arc_set_value(arc, LV_CLAMP(0, h.current, heatScale(h.label)));
  lv_obj_remove_flag(arc, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_set_style_bg_opa(arc, LV_OPA_TRANSP, LV_PART_KNOB);
  lv_obj_set_style_pad_all(arc, 0, LV_PART_KNOB);
  lv_obj_set_style_arc_width(arc, 6, LV_PART_MAIN);
  lv_obj_set_style_arc_width(arc, 6, LV_PART_INDICATOR);
  lv_obj_set_style_arc_color(arc, lv_color_hex(0x2A3038), LV_PART_MAIN);
  lv_obj_set_style_arc_color(arc, colour, LV_PART_INDICATOR);

  char text[24];
  snprintf(text, sizeof text, "%d\xC2\xB0", h.current);
  lv_obj_t *value = label(arc, text, size >= 56 ? &lv_font_montserrat_20 : &lv_font_montserrat_14);
  lv_obj_center(value);

  const int textX = x + size + 8, textW = cellW - size - 12;
  lv_obj_t *name = label(s, h.label, &lv_font_montserrat_14, TEXT);
  lv_obj_set_width(name, textW);
  oneLine(name);
  lv_obj_align(name, LV_ALIGN_TOP_LEFT, textX, y + size / 2 - 18);
  if (h.target > 0) snprintf(text, sizeof text, "Set %d\xC2\xB0", h.target);
  else snprintf(text, sizeof text, "Off");
  lv_obj_t *set = label(s, text, &lv_font_montserrat_14, h.target > 0 ? colour : MUTED);
  lv_obj_set_width(set, textW);
  oneLine(set);
  lv_obj_align(set, LV_ALIGN_TOP_LEFT, textX, y + size / 2 + 1);
}

/** The printer beside the display: what it is doing, its temperatures, any error, and the spools loaded. */
void showPrinter() {
  if (!overview || !overview->hasPrinter) {
    showOverview();
    return;
  }
  const wb::PrinterInfo &p = overview->printer;
  lv_obj_t *s = newScreen(View::Printer);

  lv_obj_t *header = plainBox(s);
  lv_obj_set_size(header, W, HEADER_H);
  lv_obj_set_style_bg_color(header, SURFACE, 0);
  lv_obj_set_style_bg_opa(header, LV_OPA_COVER, 0);
  lv_obj_add_flag(header, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_add_event_cb(header, backToOverview, LV_EVENT_CLICKED, nullptr);
  char title[48];
  snprintf(title, sizeof title, LV_SYMBOL_LEFT " %s", p.name);
  lv_obj_t *t = label(header, title, &lv_font_montserrat_20);
  lv_obj_set_width(t, 200);
  oneLine(t);
  lv_obj_align(t, LV_ALIGN_LEFT_MID, 8, 0);
  lv_obj_t *state = label(header, p.state, &lv_font_montserrat_14, toneColour(p.tone));
  lv_obj_align(state, LV_ALIGN_RIGHT_MID, -8, 0);

  int y = HEADER_H + 8;
  if (p.progress >= 0) {
    char line[96];
    snprintf(line, sizeof line, "%d%%%s%s", static_cast<int>(p.progress * 100 + 0.5f), p.left[0] ? "  -  " : "", p.left);
    lv_obj_t *pct = label(s, line, &lv_font_montserrat_20);
    lv_obj_align(pct, LV_ALIGN_TOP_LEFT, 10, y);
    y += 28;
    lv_obj_t *bar = lv_bar_create(s);
    lv_obj_set_size(bar, W - 20, 8);
    lv_bar_set_value(bar, static_cast<int32_t>(p.progress * 100 + 0.5f), LV_ANIM_OFF);
    lv_obj_set_style_bg_color(bar, lv_color_hex(0x2A3038), LV_PART_MAIN);
    lv_obj_set_style_bg_color(bar, toneColour(p.tone), LV_PART_INDICATOR);
    lv_obj_align(bar, LV_ALIGN_TOP_LEFT, 10, y);
    y += 14;
  }
  // The job on one line, with the layer at its right.
  if (p.job[0] || p.layer[0]) {
    int layerW = 0;
    if (p.layer[0]) {
      lv_obj_t *l = label(s, p.layer, &lv_font_montserrat_14, MUTED);
      lv_obj_align(l, LV_ALIGN_TOP_RIGHT, -10, y);
      lv_obj_update_layout(l);
      layerW = lv_obj_get_width(l) + 10;
    }
    if (p.job[0]) {
      lv_obj_t *j = label(s, p.job, &lv_font_montserrat_14, TEXT);
      lv_obj_set_width(j, W - 20 - layerW);
      oneLine(j);
      lv_obj_align(j, LV_ALIGN_TOP_LEFT, 10, y);
    }
    y += 19;
  }

  // Temperatures as dials, sized to the room left above the spools; as text if the line is not understood.
  wb::Heat heats[wb::MAX_HEATS];
  const size_t heatCount = wb::parseHeats(p.temps, heats, wb::MAX_HEATS);
  const int bottom = p.trayCount ? TRAYS_TOP : H - 6;
  const int errorRoom = p.error[0] ? 34 : 0;
  if (heatCount) {
    const int size = LV_CLAMP(44, bottom - 4 - errorRoom - y, 64);
    const int cellW = (W - 20) / static_cast<int>(heatCount);
    for (size_t i = 0; i < heatCount; i++) addDial(s, heats[i], 10 + static_cast<int>(i) * cellW, y, size, cellW);
    y += size + 4;
  } else if (p.temps[0]) {
    lv_obj_t *l = label(s, p.temps, &lv_font_montserrat_14, MUTED);
    lv_obj_set_width(l, W - 20);
    oneLine(l);
    lv_obj_align(l, LV_ALIGN_TOP_LEFT, 10, y);
    y += 19;
  }
  if (p.error[0] && bottom - y >= 17) {
    lv_obj_t *e = label(s, p.error, &lv_font_montserrat_14, DANGER);
    lv_obj_set_size(e, W - 20, LV_MIN(34, (bottom - y) / 17 * 17));
    lv_label_set_long_mode(e, LV_LABEL_LONG_DOT);
    lv_obj_align(e, LV_ALIGN_TOP_LEFT, 10, y);
  }

  // Spools along the bottom: colour, its place, the material; the one feeding now is outlined.
  if (p.trayCount) {
    const int slot = (W - 12) / static_cast<int>(wb::MAX_TRAYS);
    for (size_t i = 0; i < p.trayCount; i++) {
      const wb::TrayInfo &tray = p.trays[i];
      const int x = 6 + static_cast<int>(i) * slot;
      lv_obj_t *box = lv_obj_create(s);
      lv_obj_set_size(box, slot - 8, 22);
      lv_obj_align(box, LV_ALIGN_BOTTOM_LEFT, x + 4, -36);
      lv_obj_set_style_radius(box, 4, 0);
      lv_obj_set_style_pad_all(box, 0, 0);
      lv_obj_remove_flag(box, LV_OBJ_FLAG_SCROLLABLE);
      lv_obj_set_style_bg_color(box, tray.empty ? BG : (tray.hasColor ? lv_color_hex(tray.color) : lv_color_hex(0x3A414B)), 0);
      lv_obj_set_style_border_color(box, tray.active ? ACCENT : lv_color_hex(0x55606C), 0);
      lv_obj_set_style_border_width(box, tray.active ? 3 : 1, 0);
      lv_obj_t *place = label(s, tray.label, &lv_font_montserrat_14, tray.active ? ACCENT : TEXT);
      lv_obj_set_width(place, slot);
      lv_obj_set_style_text_align(place, LV_TEXT_ALIGN_CENTER, 0);
      lv_obj_align(place, LV_ALIGN_BOTTOM_LEFT, x, -18);
      lv_obj_t *material = label(s, tray.empty ? "-" : tray.material, &lv_font_montserrat_14, MUTED);
      lv_obj_set_width(material, slot);
      oneLine(material);
      lv_obj_set_style_text_align(material, LV_TEXT_ALIGN_CENTER, 0);
      lv_obj_align(material, LV_ALIGN_BOTTOM_LEFT, x, -2);
    }
  }
}

void showAbout() {
  aboutArmed = false;
  lv_obj_t *s = newScreen(View::About);
  const net::Status st = net::status();
  char text[480];
  snprintf(text, sizeof text,
           "Display: %s\nWorkspace: %s\nServer: %s\nWi-Fi: %s, %d dBm, %s\nTag reader: %s\nFirmware %s, panel %s",
           overview ? overview->device : "-", overview ? overview->workspace : "-", settings.url, WiFi.SSID().c_str(), st.rssi, st.ip,
           readerFitted ? "connected" : "none", WB_VERSION, WB_PANEL);
  lv_obj_t *l = label(s, text);
  lv_obj_set_width(l, W - 16);
  lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
  lv_obj_align(l, LV_ALIGN_TOP_LEFT, 8, 8);
  lv_obj_t *row = plainBox(s);
  lv_obj_set_size(row, W - 16, 44);
  lv_obj_align(row, LV_ALIGN_BOTTOM_MID, 0, -8);
  lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(row, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  button(row, "Close", backToOverview, nullptr, ACCENT);
  button(row, "New code", onNewCode);
  button(row, "Set up again", onSetupAgain, nullptr, lv_color_hex(0x5A2328));
}

// ---- Tapped tags -----------------------------------------------------------------------------
void closeCard() {
  if (cardTimer) {
    lv_timer_delete(cardTimer);
    cardTimer = nullptr;
  }
  if (card) {
    lv_obj_delete_async(card);
    card = nullptr;
  }
  free(tag);
  tag = nullptr;
  tagNote[0] = '\0';
  free(untagged);
  untagged = nullptr;
  // Closing the card (by hand, after 20 s or for a new tap) stops waiting for the sticker.
  if (writing) reader::cancelWrite();
  writing = false;
  free(toWrite);
  toWrite = nullptr;
}

void onCloseCard(lv_event_t *) { closeCard(); }

lv_obj_t *openCard() {
  if (card) lv_obj_delete_async(card);
  card = lv_obj_create(lv_layer_top());
  lv_obj_set_size(card, W - 16, H - 16);
  lv_obj_center(card);
  lv_obj_set_style_bg_color(card, lv_color_hex(0x232A33), 0);
  lv_obj_set_style_border_color(card, ACCENT, 0);
  lv_obj_set_style_border_width(card, 2, 0);
  lv_obj_set_style_radius(card, 10, 0);
  lv_obj_set_style_pad_all(card, 10, 0);
  if (cardTimer) lv_timer_delete(cardTimer);
  cardTimer = lv_timer_create([](lv_timer_t *) { closeCard(); }, CARD_CLOSE_MS, nullptr);
  lv_timer_set_repeat_count(cardTimer, 1);
  lv_timer_set_auto_delete(cardTimer, false);
  display::setBrightness(255);
  return card;
}

void sendTagCommand(net::CommandType type) {
  if (!tag) return;
  net::Command command{};
  command.type = type;
  wb::copyText(command.arg, sizeof command.arg, tag->uid);
  if (type == net::CommandType::Link) wb::copyText(command.arg2, sizeof command.arg2, pendingLinkItem);
  net::send(command);
  lv_obj_t *c = openCard();
  lv_obj_t *sp = lv_spinner_create(c);
  lv_obj_set_size(sp, 40, 40);
  lv_obj_center(sp);
}

void onPutAway(lv_event_t *) { sendTagCommand(net::CommandType::PutAway); }
void onWriteSticker(lv_event_t *) { sendTagCommand(net::CommandType::Sticker); }

/** The card while the reader waits for the sticker, or after a write that did not take. */
void showWriting(const char *headline, const char *detail, bool retry) {
  lv_obj_t *c = openCard();
  lv_obj_t *h = label(c, headline, &lv_font_montserrat_20);
  lv_obj_set_width(h, W - 40);
  oneLine(h);
  lv_obj_t *d = label(c, detail, &lv_font_montserrat_14, MUTED);
  lv_obj_set_width(d, W - 40);
  lv_label_set_long_mode(d, LV_LABEL_LONG_WRAP);
  lv_obj_align(d, LV_ALIGN_TOP_LEFT, 0, 32);
  lv_obj_t *row = plainBox(c);
  lv_obj_set_size(row, lv_pct(100), 44);
  lv_obj_align(row, LV_ALIGN_BOTTOM_MID, 0, 0);
  lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(row, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_set_style_pad_column(row, 8, 0);
  if (retry) {
    button(row, "Try again", [](lv_event_t *) {
      if (!toWrite) return;
      reader::write(writeUid, *toWrite);
      writing = true;
      showWriting("Writing the sticker", "Hold the sticker still against the reader.", false);
    }, nullptr, ACCENT);
  } else {
    lv_obj_t *sp = lv_spinner_create(row);
    lv_obj_set_size(sp, 32, 32);
  }
  button(row, retry ? "Close" : "Cancel", onCloseCard);
}

/** The server handed over a sticker for the tag on the card: wait for it on the reader and write it. */
void startWriting(wb::Sticker *sticker, const char *done) {
  free(toWrite);
  toWrite = sticker;
  if (!tag) {
    // The card was closed meanwhile (another tag was tapped): nothing to write onto.
    free(toWrite);
    toWrite = nullptr;
    if (done[0]) toast(done, lv_color_hex(0x1F5130));
    return;
  }
  wb::copyText(writeUid, sizeof writeUid, tag->uid);
  reader::write(writeUid, *toWrite);
  writing = true;
  writeAfterLink = done[0] != '\0';
  // After a link the sticker is usually still on the reader, and this card is gone in a moment.
  showWriting(done[0] ? done : "Writing the sticker", "Hold the sticker against the reader to write the spool's link and details onto it.", false);
}

void onWritten(reader::WriteOutcome outcome) {
  if (!writing) return;
  const char *still = writeAfterLink ? " It is still linked." : "";
  char text[140];
  switch (outcome) {
    case reader::WriteOutcome::Written:
      closeCard();
      toast("Sticker written. Tap it with any phone to open the spool.", lv_color_hex(0x1F5130));
      break;
    case reader::WriteOutcome::WrongTag:
      showWriting("That is another tag", "Hold the sticker this is for against the reader.", false);
      break;
    case reader::WriteOutcome::NotWritable:
      snprintf(text, sizeof text, "This tag cannot be written: use an NTAG215 or NTAG216 sticker.%s", still);
      closeCard();
      toast(text, DANGER);
      break;
    case reader::WriteOutcome::TooSmall:
      snprintf(text, sizeof text, "Too small for a spool's details: use an NTAG215 or NTAG216 sticker.%s", still);
      closeCard();
      toast(text, DANGER);
      break;
    case reader::WriteOutcome::Failed:
      writing = false;
      showWriting("Not written", "The sticker moved away or did not take it. Hold it still and try again.", true);
      break;
  }
}
void onInsert(lv_event_t *) { sendTagCommand(net::CommandType::Insert); }

void showTagCard() {
  lv_obj_t *c = openCard();
  if (!tag->known) {
    // A Bambu spool Wrkbench has not met comes with a note saying what it is and where to add it.
    label(c, tagNote[0] ? "Not in stock yet" : "This tag is not linked to anything", &lv_font_montserrat_20);
    char uid[48];
    snprintf(uid, sizeof uid, "Tag %s", tag->uid);
    lv_obj_t *u = label(c, tagNote[0] ? tagNote : uid, &lv_font_montserrat_14, MUTED);
    lv_obj_set_width(u, W - 40);
    lv_label_set_long_mode(u, LV_LABEL_LONG_WRAP);
    lv_obj_align(u, LV_ALIGN_TOP_LEFT, 0, 52);
    lv_obj_t *row = plainBox(c);
    lv_obj_set_size(row, lv_pct(100), 44);
    lv_obj_align(row, LV_ALIGN_BOTTOM_MID, 0, 0);
    lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(row, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_column(row, 8, 0);
    if (tag->canLink) {
      button(row, "Link to an item", [](lv_event_t *) {
        net::Command command{};
        command.type = net::CommandType::Untagged;
        net::send(command);
        lv_obj_t *c2 = openCard();
        lv_obj_t *sp = lv_spinner_create(c2);
        lv_obj_set_size(sp, 40, 40);
        lv_obj_center(sp);
      }, nullptr, ACCENT);
    }
    button(row, "Close", onCloseCard);
    return;
  }
  const wb::Item &item = tag->item;
  lv_obj_t *swatch = lv_obj_create(c);
  lv_obj_set_size(swatch, 36, 36);
  lv_obj_align(swatch, LV_ALIGN_TOP_LEFT, 0, 0);
  lv_obj_set_style_bg_color(swatch, swatchColour(item), 0);
  lv_obj_set_style_radius(swatch, 6, 0);
  lv_obj_t *name = label(c, item.name, &lv_font_montserrat_20);
  lv_obj_set_width(name, W - 90);
  oneLine(name);
  lv_obj_align(name, LV_ALIGN_TOP_LEFT, 46, 0);
  lv_obj_t *sub = label(c, item.sub, &lv_font_montserrat_14, MUTED);
  lv_obj_align(sub, LV_ALIGN_TOP_LEFT, 46, 24);
  char amount[96];
  snprintf(amount, sizeof amount, "%s left", item.qty);
  lv_obj_t *qty = label(c, amount, &lv_font_montserrat_20, item.low ? DANGER : TEXT);
  lv_obj_align(qty, LV_ALIGN_TOP_LEFT, 0, 50);
  if (item.fill >= 0) {
    lv_obj_t *bar = lv_bar_create(c);
    lv_obj_set_size(bar, W - 40, 8);
    lv_bar_set_value(bar, static_cast<int32_t>(item.fill * 100 + 0.5f), LV_ANIM_OFF);
    lv_obj_set_style_bg_color(bar, item.low ? DANGER : ACCENT, LV_PART_INDICATOR);
    lv_obj_align(bar, LV_ALIGN_TOP_LEFT, 0, 80);
  }
  char where[120];
  // A tap that tagged the spool in or out says so here, where the place it is kept would be.
  if (tagNote[0]) snprintf(where, sizeof where, "%s", tagNote);
  else if (tag->here) snprintf(where, sizeof where, "Kept here");
  else if (tag->where[0]) snprintf(where, sizeof where, "Kept at %s", tag->where);
  else snprintf(where, sizeof where, "Not put away anywhere");
  lv_obj_t *w = label(c, where, &lv_font_montserrat_14, tagNote[0] ? TEXT : MUTED);
  lv_obj_set_width(w, W - 40);
  oneLine(w);
  lv_obj_align(w, LV_ALIGN_TOP_LEFT, 0, 94);
  if (tag->canWriteSticker) {
    // Above the row of actions, which has no room left: a sticker is written now and then, not on every tap.
    lv_obj_t *b = button(c, LV_SYMBOL_EDIT "  Write sticker", onWriteSticker);
    lv_obj_align(b, LV_ALIGN_TOP_LEFT, 0, 116);
  }

  lv_obj_t *row = plainBox(c);
  lv_obj_set_size(row, lv_pct(100), 44);
  lv_obj_align(row, LV_ALIGN_BOTTOM_MID, 0, 0);
  lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(row, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_set_style_pad_column(row, 6, 0);
  if (tag->canPutAway) button(row, "Put away here", onPutAway, nullptr, ACCENT);
  if (tag->canInsert) {
    char into[64];
    snprintf(into, sizeof into, "Into %s", tag->printer);
    lv_obj_t *b = button(row, into, onInsert, nullptr, ACCENT);
    lv_obj_set_width(b, LV_SIZE_CONTENT);
  }
  button(row, "Close", onCloseCard);
}

void onLinkConfirm(lv_event_t *) { sendTagCommand(net::CommandType::Link); }

void onLinkPick(lv_event_t *e) {
  if (!untagged || !tag) return;
  const intptr_t index = reinterpret_cast<intptr_t>(lv_event_get_user_data(e));
  const wb::Item &item = untagged->items[index];
  wb::copyText(pendingLinkItem, sizeof pendingLinkItem, item.id);
  lv_obj_t *c = openCard();
  char text[120];
  snprintf(text, sizeof text, "Link this tag to\n%s?", item.name);
  lv_obj_t *l = label(c, text, &lv_font_montserrat_20);
  lv_obj_set_width(l, W - 40);
  lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
  lv_obj_t *row = plainBox(c);
  lv_obj_set_size(row, lv_pct(100), 44);
  lv_obj_align(row, LV_ALIGN_BOTTOM_MID, 0, 0);
  lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(row, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_set_style_pad_column(row, 8, 0);
  button(row, "Link", onLinkConfirm, nullptr, ACCENT);
  button(row, "Cancel", onCloseCard);
}

void showUntagged() {
  lv_obj_t *c = openCard();
  lv_obj_t *head = label(c, untagged->count ? "Which item is it?" : "Every item here already has a tag", &lv_font_montserrat_14, MUTED);
  lv_obj_align(head, LV_ALIGN_TOP_LEFT, 0, 0);
  lv_obj_t *close = button(c, LV_SYMBOL_CLOSE, onCloseCard);
  lv_obj_align(close, LV_ALIGN_TOP_RIGHT, 0, -6);
  lv_obj_t *list = lv_obj_create(c);
  lv_obj_set_size(list, lv_pct(100), H - 16 - 20 - 44);
  lv_obj_align(list, LV_ALIGN_BOTTOM_MID, 0, 0);
  lv_obj_set_style_bg_opa(list, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(list, 0, 0);
  lv_obj_set_style_pad_all(list, 0, 0);
  lv_obj_set_style_pad_row(list, 4, 0);
  lv_obj_set_flex_flow(list, LV_FLEX_FLOW_COLUMN);
  for (size_t i = 0; i < untagged->count; i++) addRow(list, untagged->items[i], onLinkPick, reinterpret_cast<void *>(static_cast<intptr_t>(i)));
}

// ---- Results from the network task -----------------------------------------------------------
void handle(net::Result &result) {
  switch (result.type) {
    case net::ResultType::Overview: {
      free(overview);
      overview = static_cast<wb::Overview *>(result.data);
      // Someone started looking for a spool kept here: whatever was on screen, show it lit in its own location.
      const bool newlyLit = overview && overview->hasFind && strcmp(litFor, overview->find.id) != 0;
      wb::copyText(litFor, sizeof litFor, overview && overview->hasFind ? overview->find.id : "");
      if (newlyLit && browsing) browse("");
      const bool away = view == View::Places || view == View::About || view == View::Printer;
      if (view == View::Overview || view == View::Busy || view == View::None || (newlyLit && away)) showOverview();
      else if (view == View::Printer) showPrinter();
      break;
    }
    case net::ResultType::Paired:
      showMessageScreen(View::Busy, "Set up", result.message, true);
      break;
    case net::ResultType::PairFailed:
      showCode(result.message);
      break;
    case net::ResultType::Unauthorized:
      free(overview);
      overview = nullptr;
      closeCard();
      showCode("This display was removed or set up again. Enter a new code.");
      break;
    case net::ResultType::Tag:
      free(tag);
      tag = static_cast<wb::TagInfo *>(result.data);
      if (!result.ok || !tag) {
        closeCard();
        toast(result.message[0] ? result.message : "Could not look up that tag", DANGER);
      } else {
        wb::copyText(tagNote, sizeof tagNote, result.message);
        showTagCard();
      }
      break;
    case net::ResultType::Untagged:
      free(untagged);
      untagged = static_cast<wb::ItemList *>(result.data);
      if (!result.ok || !untagged) {
        closeCard();
        toast(result.message, DANGER);
      } else {
        showUntagged();
      }
      break;
    case net::ResultType::Updating:
      closeCard();
      showMessageScreen(View::Busy, "Updating firmware", result.message, true);
      break;
    case net::ResultType::UpdateFailed:
      // Back to the location; the next overview would not come while nothing changed.
      if (overview) showOverview();
      toast(result.message, lv_color_hex(0x5A2328));
      break;
    case net::ResultType::Sticker:
      startWriting(static_cast<wb::Sticker *>(result.data), result.message);
      break;
    case net::ResultType::Action:
      closeCard();
      toast(result.message, result.ok ? lv_color_hex(0x1F5130) : lv_color_hex(0x5A2328));
      break;
  }
}

}  // namespace

void begin(const store::Settings &initial, bool hasReader) {
  settings = initial;
  readerFitted = hasReader;
  lv_theme_t *theme = lv_theme_default_init(lv_display_get_default(), ACCENT, DANGER, true, &lv_font_montserrat_14);
  lv_display_set_theme(lv_display_get_default(), theme);
}

void showSetup(const char *apName, const char *apPassword) {
  lv_obj_t *s = newScreen(View::Setup);
  lv_obj_t *t = label(s, "Set up this display", &lv_font_montserrat_20);
  lv_obj_align(t, LV_ALIGN_TOP_LEFT, 10, 8);
  char text[400];
  snprintf(text, sizeof text,
           "1. On your phone, join the Wi-Fi\n     " LV_SYMBOL_WIFI "  %s\n     password  %s\n"
           "2. A set-up page opens (or go to 192.168.4.1).\n"
           "3. Choose your Wi-Fi and enter the Wrkbench address and set-up code from Settings, Displays.",
           apName, apPassword);
  lv_obj_t *l = label(s, text);
  lv_obj_set_width(l, W - 20);
  lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
  lv_obj_align(l, LV_ALIGN_TOP_LEFT, 10, 42);
}

void showBusy(const char *title, const char *detail) { showMessageScreen(View::Busy, title, detail, true); }

void openScreen(char key) {
  if (key == 'P') showPrinter();
  else if (key == 'O') showOverview();
}

void poll() {
  net::Result result;
  while (net::receive(result)) handle(result);
  reader::WriteOutcome outcome;
  while (reader::written(outcome)) onWritten(outcome);

  // A tapped tag: the server tags the spool in or out and says what it is.
  char uid[24];
  static char blocks[wb::BAMBU_JSON_LEN];
  if (reader::take(uid, sizeof uid, blocks, sizeof blocks)) {
    if (!overview) {
      toast("Not set up yet", DANGER);
    } else {
      closeCard();
      static net::Command command;
      command = net::Command{};
      command.type = net::CommandType::Tap;
      wb::copyText(command.arg, sizeof command.arg, uid);
      wb::copyText(command.blocks, sizeof command.blocks, blocks);
      net::send(command);
      lv_obj_t *c = openCard();
      lv_obj_t *sp = lv_spinner_create(c);
      lv_obj_set_size(sp, 40, 40);
      lv_obj_center(sp);
    }
  }

  // Once a second: the status dot and "updated N min ago", the right screen for the phase, dimming.
  static uint32_t lastSecond = 0;
  if (millis() - lastSecond < 1000) return;
  lastSecond = millis();
  const net::Status st = net::status();
  if (st.phase == net::Phase::NeedCode && view != View::Code && view != View::Setup) showCode(st.message);
  else if (st.phase == net::Phase::Connecting && view == View::Busy && !overview) showMessageScreen(View::Busy, "Joining Wi-Fi", WiFi.SSID().c_str(), true);
  else if (st.phase == net::Phase::Offline && view == View::Busy && !overview) showMessageScreen(View::Busy, "Cannot reach Wrkbench", st.message, true);
  else if (st.phase == net::Phase::Pairing && view == View::Busy && st.message[0]) showMessageScreen(View::Busy, "Setting up", st.message, true);
  refreshStatus();
  // Out of touch with the server while lit: nothing can say the spool was taken out, so stop.
  if (overview && overview->hasFind && st.lastOkMs && millis() - st.lastOkMs > FIND_STALE_MS) {
    overview->hasFind = false;
    litFor[0] = '\0';
    if (view == View::Overview) showOverview();
  }
  const bool lit = overview && overview->hasFind;
  if (browsing && view == View::Overview && display::idleMs() > BROWSE_RETURN_MS) browse("");
  if ((view == View::Places || view == View::About || view == View::Printer) && display::idleMs() > BROWSE_RETURN_MS) showOverview();
  display::setBrightness(display::idleMs() > DIM_AFTER_MS && !card && !lit ? 40 : 255);
}

}  // namespace ui
