# Spool tags (OpenSpool)

A spool can carry a small NFC sticker that says which spool it is. Tap it with a phone to open the spool in Wrkbench; scan it just before loading and Wrkbench knows exactly which spool went into which tray, even for spools the printer cannot identify.

Wrkbench writes stickers in the [OpenSpool](https://github.com/spuder/OpenSpool) format, an open standard for filament tags, so other OpenSpool tools can read them, and it can read theirs.

## What you need

- **NFC stickers**: NTAG215 (or NTAG216). They are sold in sheets and cost very little.
- **To write a sticker from Wrkbench**: an Android phone with Chrome, and Wrkbench opened at a secure (`https://`) address. Other devices can still do it with any NFC-writing app (see below).
- **To use a sticker**: any phone. Tapping it opens the spool.

Bambu Lab's own spools already carry a tag the printer reads, so they do not need a sticker. A [location display](Location-displays.md#which-tags-are-read) with a tag reader reads those tags too. Stickers are for everything else.

A phone, or a mobile computer such as a Zebra TC56, cannot read a Bambu Lab spool's own tag: the tag is locked, and only a reader made for it can open it. Holding one to the phone in Wrkbench says so. Scan the spool's [label](Labels-and-scanning.md) instead, or let the printer or a location display read the tag.

## What goes on the sticker

Two things, both small:

- **A link to the spool** in your Wrkbench. Like a [QR label](Labels-and-scanning.md), it says nothing by itself and needs a sign-in.
- **An OpenSpool record**: material, colour, brand and nozzle temperature range. The temperatures come from the spool's own details; if it has none, the usual range for its material is used.

The link is written first, so that tapping the sticker opens the spool. Stickers are never locked: one can be rewritten when it moves to another spool.

Wrkbench also remembers the sticker's serial number against the spool, so the sticker still finds its spool if something else later changes what it holds.

## Write a sticker

Operators and admins can do this.

1. Open the spool and press **Spool tag**.
2. Press **Write a sticker** and hold the sticker against the back of the phone until it says **Written**. The first time, Chrome asks whether Wrkbench may use NFC.
3. Stick it on the spool.

Wrkbench reads the sticker before writing it:

- **If it is already on another spool in stock**, it names that spool and asks before moving the sticker to this one.
- **If this spool has its own tag that the printer reads**, a sticker is refused unless you choose **Use a sticker anyway**. Wrkbench keeps one tag per spool, so the sticker would replace its record of the printer's tag, and the printer would stop recognising the spool by itself.

**Forget the sticker** unties a sticker from the spool, for one that was thrown away.

### On an iPhone or a computer

Browsers there cannot write NFC tags. **Spool tag** shows the two pieces instead, with **Copy link** and **Copy OpenSpool JSON**. In any NFC-writing app, add a link record with the first and a data record of type `application/json` with the second, link first.

## Read a sticker

- **Tap it with any phone**: the spool opens (after signing in, if needed).
- **In Wrkbench on Android**: press **Scan**, then **Read an NFC tag**, and hold the sticker to the phone.

From the spool's sheet you can then change its stock or press **Load into…** to put it in a slot.

## Add a spool from someone else's tag

Scanning an OpenSpool tag that Wrkbench has not seen (a spool tagged with another tool, say) shows what the tag says and then:

- **This is one of these**: spools in stock that fit the tag, best match first. Choosing one ties the sticker to it, so no duplicate is made. This is also the quick way to tie stickers to spools you already have.
- **Add as a new spool** (admins): the usual item form, filled in from the tag. A material your workspace does not list becomes **Other**.

Without NFC, paste the tag's contents instead: **Add item**, **From a spool tag**, and paste into **Or type a code**.

## Load a spool into a slot

**Load into…** on a spool lists every slot of every machine. Slots where a connected printer reports a matching filament are first, then free ones. Tap a slot to load the spool there. Loading never changes stock.

### Scan, then insert

For a connected printer there is a quicker way that needs no picking:

1. Scan the spool (its sticker or its QR label) and press **Load into…**.
2. Under **About to put it in?**, press **Next into** and the printer's name.
3. Put the spool into the printer within two minutes. Whichever tray it goes into is linked to it, and the phone says where it went.

This is how a spool the printer cannot identify gets tied to the exact item in stock, with no reader at the printer. Nothing is sent to the printer: Wrkbench only watches which tray changes.

- **Load one spool at a time.** If two trays are loaded at once there is no telling which is which, so nothing is linked and the phone says so.
- **A tag the printer reads still wins.** If the tray turns out to hold a spool Wrkbench already knows by its own tag, that spool is loaded and the scan keeps waiting.
- **If the printer describes the tray as a different filament**, the spool is linked anyway and the phone says to check the tray's setting on the printer. A tray often still shows the filament that was in it before.
- **Cancel** stops waiting. So does the two minutes running out.

Only printers that are reporting right now are offered.

## Good to know

- **Checked on a Zebra TC56** (Android 8.1, Chrome 101) in Wrkbench's handheld mode: writing a spool's sticker, reading it back to open the spool, and reading an OpenSpool tag.
- **Not yet checked on real hardware:** that tapping a sticker with the app closed opens the link on Android and iPhone, and scan-then-insert with a real printer, which was tested with the bridge's simulated printers. Still to be confirmed: how a real AMS reports a tray between a spool going in and its filament being set on the printer. A tray whose filament has not been set reads as empty, so scan-then-insert may only link once the printer has been told what is in it.
- **Record order.** OpenSpool readers that look only at the first record on a tag would want the OpenSpool record first; Wrkbench puts the link first so tapping works. If you use such a reader, say so: it is a one-line change.
- **A sticker does not change how the printer sees a spool.** The AMS cannot read these stickers. In Wrkbench a stickered spool behaves like any untagged spool in a tray: it stays linked while the printer's description of the tray still fits it.
- Sticker serials are kept as `NFC` followed by the serial, in the same place as tags read by the printer. They come along in [exports](Backups-and-data.md).
