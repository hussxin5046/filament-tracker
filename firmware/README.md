# Wrkbench firmware

Firmware for hardware of Wrkbench's own. For now there is one device: the **location display** in `cyd/`, a
2.8" touch screen board fixed to a shelf, rack or dry box that shows what is stored there. How to buy one, set it
up and use it is in the wiki: [Location displays](../docs/wiki/Location-displays.md).

## Building and flashing

You need [PlatformIO Core](https://docs.platformio.org/page/core/installation/index.html)
(`pip install platformio`). The first build downloads the ESP32 toolchain (about 1 GB).

```bash
cd firmware/cyd
pio run -e cyd-st7789 -t upload     # build and flash
pio device monitor                  # what it prints over USB
```

The USB-C version of the board ships with either an ST7789 or an ILI9341 panel, and nothing on the board says
which. Flash `cyd-st7789` first. If the colours are wrong (white looks black, or everything looks like a photo
negative), flash `cyd-ili9341` instead. To check a new board without the full firmware, flash `bringup-st7789`
(or `bringup-ili9341`): it shows four bars labelled RED, GREEN, BLUE and WHITE, prints touch readings over USB,
and a tap on the bottom strip toggles colour inversion.

- **Windows, "No such file or directory" for `lv_conf_internal.h`:** the build path is too long for Windows.
  Build with a short PlatformIO folder: `set PLATFORMIO_WORKSPACE_DIR=C:\wbpio` (PowerShell:
  `$env:PLATFORMIO_WORKSPACE_DIR = "C:\wbpio"`), or turn on Windows long paths.
- **"Wrong boot mode detected" when flashing:** some boards do not enter flashing mode by themselves. Hold the
  **BOOT** button, press and release **RST**, then release BOOT, and flash again.
- **Everything looks like a negative** (a white background, black spools white) on a 2.8" ST7789 board: its
  builds switch the panel's inversion off (`WB_INVERT=0` in `cyd-st7789`). If yours looks like a negative the other
  way round, remove it, or try `cyd-ili9341`.
- **Red and blue swapped:** set `-DTFT_RGB_ORDER` the other way in the env's build flags. The USB-C board with an
  ST7789 needs `TFT_BGR`, which `cyd-st7789` already sets.
- **Touch lands in the wrong place:** flash the bring-up env, note the raw readings at the four corners, and set
  `-DWB_TOUCH_X_MIN=… -DWB_TOUCH_X_MAX=… -DWB_TOUCH_Y_MIN=… -DWB_TOUCH_Y_MAX=…`.

## Flashing from the browser

**Settings → Displays → Flash a new display** writes the newest release's full image (`…-full.bin`, served by
`GET /api/workspaces/:wid/firmware/:model/full`) at offset 0 with [esptool-js](https://github.com/espressif/esptool-js)
over Web Serial (Chrome and Edge on a computer). With **Set it up over USB too** it then adds the display and sends
one line of JSON over the same port at 115200 baud:

```json
{"ssid":"Workshop","password":"…","url":"https://wrkbench.example.com","code":"ABCD-EFGH-2345"}
```

The firmware (0.3.2 and later) saves it as the phone page would (`setUpOverUsb` in `main.cpp`, checked by
`wb::parseUsbSetup`), answers `WBSETUP OK` or `WBSETUP ERR <why>` and restarts into its new set-up. Older firmware
does not answer, and the page falls back to showing the set-up code for a phone.

## Releasing firmware

Displays update themselves from Settings (see [Updating its firmware](../docs/wiki/Location-displays.md#updating-its-firmware)).
A release needs no commit and no deploy of the app: the version comes from its tag, and servers look for new
releases by themselves (at most once an hour). Commit your firmware changes to `main` (through a pull request when
you want the build checked first), then either:

- **On GitHub:** Releases → **Draft a new release** → choose a new tag `firmware-v0.3.3` on `main` → Publish. Write
  what changed in the notes; they stay.
- **From a terminal:** `git tag firmware-v0.3.3 && git push origin firmware-v0.3.3`.

The **Display firmware** workflow (`.github/workflows/firmware.yml`) builds that version (it sets
`WB_FIRMWARE_VERSION`, which `tools/version.py` turns into `WB_VERSION`), runs the tests, builds every board
(`cyd-st7789`, `cyd-ili9341`, `cyd24-st7789`) and attaches `tools/package_release.py`'s output to the release,
making it first when the tag was pushed from a terminal: each board's app image (for updates over Wi-Fi), a full
image written at offset 0 (for flashing a new board) and `firmware-manifest.json` describing them. It takes about
five minutes; until every file is attached, servers keep offering the release before. A tag with a suffix
(`firmware-v0.3.3-rc1`) makes a pre-release of 0.3.3, offered only by servers with `FIRMWARE_PRERELEASES=true`
(staging). Displays are offered a version newer than the one they run, so use a new number each time.

Builds on your own computer use `custom_wb_version` in `cyd/platformio.ini`, or `WB_FIRMWARE_VERSION` when set.
On a pull request the workflow only builds, so a broken build is seen before it is merged. Commits that only touch
`firmware/` or `docs/` do not redeploy the app (`railway.json` lists what does).

How an update works: the server adds `update` (version, size, MD5) to a display's overview once an admin asks
for it, and serves the image once at `GET /api/device/firmware`. The display writes it into the spare app slot,
checks the MD5 and restarts. The new firmware starts on trial (`verifyRollbackLater` in `main.cpp`) and is only
kept once the server has answered it (`markGood` in `net.cpp`), or after ten minutes running, Wi-Fi or not; if it
restarts before then, the bootloader goes back to the old one. A download that fails is reported to
`POST /api/device/update-failed`; one that never started (no connection, or the server could not fetch the file) is
tried again on a later poll.
Every poll reports the running version as `fw=`.

## Working on the screens

- **See the screen from the computer:** `python tools/screenshot.py COM3 shot.png` (any port name) asks the display
  to redraw and saves exactly what it drew as a PNG. It works with every build. Add `P` to open the printer
  screen first, or `O` for the overview.
- **A printer to show without a real one:** run a bridge with `--simulate` (see the
  [Bridge reference](../docs/wiki/Bridge-reference.md)); its pretend X1C is always mid-print.
- **Update over Wi-Fi instead of USB:** the `cyd-st7789-dev` env also accepts new firmware over Wi-Fi, protected by
  a password you choose. Set `WB_OTA_PASSWORD` in the environment, flash that env over USB once, then
  `pio run -e cyd-st7789-dev -t upload --upload-port <the display's IP>`. The computer must accept an incoming
  connection from the display (Windows asks to allow Python through the firewall). Release envs never listen.

## Layout

| Path | What it is |
|---|---|
| `cyd/platformio.ini` | Board, libraries (pinned) and the panel variants |
| `cyd/src/app/` | The display: `main` (start-up), `display` (screen, touch, LVGL), `portal` (set-up page for a phone), `net` (server and firmware updates, on its own task), `ui` (screens), `store` (saved settings), `reader_pn532` (optional tag reader: reads tags, writes spool stickers) |
| `cyd/src/bringup/` | Colour bars and touch test for a new board |
| `cyd/lib/wb_core/` | Parsing and tidying with no Arduino code in it, so it is tested on a computer |
| `cyd/lib/wb_bambu/` | The keys that unlock a Bambu Lab spool tag (SHA-256, HMAC and HKDF with no Arduino code), also tested on a computer |
| `cyd/test/test_core/`, `cyd/test/test_bambu/` | Unity tests for `wb_core` and `wb_bambu` |
| `cyd/certs/make_certs.py` | Writes `src/app/certs.h`, the root certificates trusted for `https://` servers |
| `cyd/include/lv_conf.h` | LVGL settings |

## Tests

The `wb_core` tests run on a computer with a C++ compiler (`pio test -e native`), or on the board itself
(`pio test -e test-board`). Without a compiler on Windows, `pip install ziglang` provides one:

```bash
cd firmware/cyd
python -m ziglang cc -c -I .pio/libdeps/test-board/Unity/src .pio/libdeps/test-board/Unity/src/unity.c -o unity.o
python -m ziglang c++ -std=gnu++17 -I lib/wb_core -I .pio/libdeps/test-board/ArduinoJson/src -I .pio/libdeps/test-board/Unity/src test/test_core/test_core.cpp lib/wb_core/wb_core.cpp unity.o -o test_core.exe
./test_core.exe
```

(`pio pkg install -e test-board` fetches Unity and ArduinoJson into `.pio/libdeps/test-board` first.)

## How it talks to the server

The display uses its own token (`wbd_…`), which it gets once by sending the set-up code to
`POST /api/device/pair`. After that it polls `GET /api/device/overview` every 10 seconds (304 when nothing
changed). With a reader fitted, each tap is sent to `POST /api/device/tag/:uid/tap`, which tags the spool in or
out and answers with what to show; the put-away, insert and link routes next to it serve the card's buttons.

When a member looks for a spool kept at the display (**Where is it?** on the item), the overview carries it as
`find.row` (firmware 0.4.0 and later; older firmware ignores it). The display shows that row first, outlined
and pulsing, at full brightness, for as long as the overview carries it, or until it has not heard from the
server for a minute. Touching the row sends `POST /api/device/item/:id/take-out`.

A Bambu Lab spool's own tag is a locked MIFARE Classic chip. The reader unlocks it with keys that follow from
its serial (`lib/wb_bambu`, after the community's
[Bambu Lab RFID Tag Guide](https://github.com/queengooborg/Bambu-Lab-RFID-Tag-Guide)) and sends six data blocks
with the tap. The server reads the spool's id and details from them (`server/src/integrations/bambu/tag.ts`)
and answers with a key, `T` and that id, which the display uses for the buttons. The server side is `server/src/routes/devices.ts`.
