# Labels and scanning

Wrkbench prints a QR label for any item or location. Scanning one opens that item or location, on any phone, so you can check stock, log what you used or put things away without searching.

![A printed item label: QR code, name, details and where it lives](images/label.png)

## What a label holds

The QR code is a link to the item or location in your Wrkbench, and nothing else. It carries no details of the thing itself:

- Someone who is not signed in gets the sign-in page, and after signing in lands on what was scanned.
- Someone who is not a member of the workspace learns nothing: they are told the label is not for anything of theirs.
- If you belong to several workspaces, scanning switches to the right one.

Beside the code the label shows the name, its code if it has one (an item's SKU, a location's label code), a line of details (an item's material, size and so on; a location's kind) and where it lives. Small labels show less: see [How a label fits its size](#how-a-label-fits-its-size).

## Print labels

Labels are made for a **roll label printer** (Brother, Dymo, and the many thermal printers that take rolls of small labels): each label is its own page.

1. Open what you want a label for:
   - An item: open it and press **Print label**.
   - Several items: in **Inventory**, narrow the list with search or filters, open **Filters**, then **Print labels for these … items** (up to 200 at a time).
   - A location: see [Locations](Locations.md#labels).
2. Choose the **Label size**. Four common sizes are listed; **Another size** takes any width and height from 15 to 150 mm. The size is remembered on that device.
3. Choose the **Printer**: 203 dpi (most thermal label printers) or 300 dpi (Brother QL, Dymo LabelWriter). If you are not sure, leave it at 203. See [Why the printer matters](#why-the-printer-matters).
4. Press **Print**. In the print window that opens, choose your label printer, the same paper size, **no margins** and **100% scale**.

The preview shows the first label at its real size, or smaller (and says so) when the label is larger than the dialog.

### How a label fits its size

Every label is fitted to the size you choose, one by one, so nothing is ever cut off by the edge:

- The QR code takes what it needs to scan and leaves the rest to the text. It sits beside the text, or above it where that leaves the text more room.
- The type is as large as fits, and shrinks until everything fits, down to about 1.5 mm (roughly 4 pt), the smallest worth printing.
- If the smallest type is still too large, whole lines are left off, least important first: the location, then the details, then the code. The name stays. Only a name too long for the label by itself is shortened, and ends in "…".
- Words are not split. The one exception is a single word too long for a line, such as a long part number, at the smallest type.
- On labels of about 20 mm and under there is room for the QR code only.

When anything was left off, the dialog says what and on how many labels before you print. Scanning the code always shows everything.

### Why the printer matters

A label printer prints rows of tiny dots. A QR code prints sharp when each of its squares is a whole number of dots wide; otherwise some squares come out a dot wider than others, and a small code may not scan. Wrkbench sizes the code to the dots of the printer you choose, so the code may be a little smaller than the room it has.

If a label is too small for a code that scans reliably, the dialog says so. A larger label fixes it; so does a shorter address for your Wrkbench, since a shorter link makes a simpler code. On very small labels Wrkbench already uses the simplest code that holds the link.

> **Print from the address everyone uses.** The link on a label starts with the address Wrkbench was open at when it was printed. The dialog shows that address, and warns when it is one only that computer can open (`localhost`).

Anyone in the workspace can print labels, including viewers.

## Scan with any phone

Point the phone's own camera at a label and tap the link it shows. Nothing needs installing.

## Scan inside Wrkbench

**Scan** (in the sidebar, and at the top right on a phone) opens the camera inside Wrkbench. Hold a label inside the square; it is read as soon as it is sharp.

The in-app scanner does a little more than the phone's camera:

- It reads **your own codes** too. If a product's barcode is in an item's **SKU / barcode** field, scanning the product opens the item. A location's **Label code** works the same way. (Reading ordinary barcodes depends on the browser; QR codes are always read.)
- **Or type a code**: type or paste a label code, SKU or barcode and press **Find**.
- On a location, **Scan items here** keeps scanning and moves each item you scan to that location. See [Locations](Locations.md#put-things-away).
- It reads NFC spool tags on phones that can. See [Spool tags](Spool-tags.md).

The camera only works when Wrkbench is opened at a secure address (one starting `https://`). The first time, the browser asks whether Wrkbench may use the camera. If you said no, allow it in the browser's settings for the site; typing codes works in the meantime.

## Use a barcode scanner

A handheld barcode scanner, or a mobile computer with a scanner built in (Zebra and others), works on every screen. There is nothing to open first: pull the trigger.

What a scan does:

- **A Wrkbench label, or a code only one item has**: the item opens with the cursor in **Set the exact amount**, ready for what you used or what the scale says. Scan the next item and it opens in its place.
- **A maker's barcode that several items share** (every spool of one product carries the same barcode): the inventory lists those items, and you pick the one in your hand. To go straight to one spool, print it a Wrkbench label.
- **A location's label**: the location opens.
- **A code nothing has**: Wrkbench says so and offers **Add item**, with the code filled in as the new item's **SKU / barcode**.
- **While "Scan items here" is open** on a location: each scan moves that item there.
- **While you are typing in a field**, such as **SKU / barcode** on an item: the code goes into the field, and the form is not saved.
- **While another dialog is open**: nothing happens, and Wrkbench asks you to close it first.

Wrkbench tells a scanner from a keyboard by its speed: the code arrives all at once and ends with Enter. So the scanner must send Enter after each code.

### A handheld scanner (USB or Bluetooth)

1. Set the scanner to act as a keyboard. For Zebra scanners this is "HID keyboard", and is how most arrive.
2. Set it to send **Enter** after each code. The scanner's quick start guide has a barcode to scan for this.
3. Set the scanner's keyboard country to match the computer's. If they differ, the `:` and `/` in a Wrkbench label arrive as other characters and the label is not recognised.

### A Zebra mobile computer (TC56 and similar)

There is no app to install from a file. Open Wrkbench in Chrome on the device, then choose **Add to Home screen** from Chrome's menu: it gets its own icon and opens full screen. This needs Wrkbench at a secure address (one starting `https://`); at any other address it still works as a page in Chrome.

Use **Handheld mode** on the device (see below). In Chrome, a Zebra mobile computer hands each scan to the text box that has the cursor, and drops it when no box has one. Handheld mode has a **Ready to scan** bar with a box for this. Tapping the box brings up the on-screen keyboard: a TC56 only hands scans to a box that does. After the first scan the keyboard is put away while the box stays ready; tap the box to bring it back for typing a code. In the full Wrkbench, scans only arrive while you are typing in a box, such as **Or type a code** in the Scan window.

The built-in scanner does not fire while Chrome has the camera open. Open **Scan** once and tap **Turn off camera (for a device with a scanner built in)**: the device remembers it, and the trigger then works in the Scan window too. **Use camera** turns it back on.

Then set up DataWedge, the scanning service already on the device:

1. Open **DataWedge** and choose **Profile0 (default)**, which applies to every app without a profile of its own.
2. Check that **Barcode input** and **Keystroke output** are both on.
3. Under **Keystroke output**, open **Basic data formatting** and check that **Send data** and **Send ENTER key** are both on.

### If scans do nothing

Open **Scan** and tap **Barcode scanner not working? Test it**. The **Scanner test** lists everything the scanner sends, the pause before each character, and whether Wrkbench read it as a scan. Nothing opens while it is open, and the camera is off so the scanner can fire.

1. Scan a label.
2. Tap **Scan into this box** and scan the same label again.
3. Tap **Copy** and send the result to whoever helps you set up the scanner, or with a bug report.

If the list stays empty when you pull the trigger, the scanner is not sending anything to the browser: check its settings (for a Zebra mobile computer, the DataWedge steps above).

Devices on Android 8 can no longer update Chrome. Wrkbench runs on the last version they got, but that browser gets no more security fixes: use such a device on a network you trust.

### Handheld mode

On a mobile computer, the full Wrkbench has more on screen than a scanner needs. **Handheld mode** keeps only what you do with one in your hand: scan, see an item, use or count stock, move it, and put things away in a location. It has no camera, so the built-in scanner always fires.

To switch a device to it, open **More** and choose **Handheld mode (for a scanner)**. The device remembers: from then on, Wrkbench and its home-screen icon open in handheld mode. **Full Wrkbench** at the top goes back to everything, and the device then opens the full Wrkbench again.

In handheld mode:

- **The bar at the top shows whether a scan will land.** Green **Ready to scan** means it will. When handheld mode opens it says **Tap the box, then scan**: tap the box in the bar once. Chrome only lets a scan into a box you have tapped yourself. It also says this after you have typed an amount; tapping a button usually makes it ready again by itself.

- **Scan any label**, or a maker's barcode or a location's code, on any screen and it opens. If several spools share a barcode, they are listed and you pick the one in your hand. **Find** also searches by name or code.
- **An item** shows how much is left, with buttons to use some (admins can also add) and a box to set the exact amount. **Move to another location**, then scan the location's label, or pick it from the list.
- **A location** lists what is inside it. **Put items away here**, then scan each item: it is moved there at once. Tap **Done** when you have finished.

- **NFC tags**: tap the **NFC** button at the top (on a device that can read NFC, with Wrkbench at an `https://` address), then hold a spool's sticker to the back of the device: the spool opens. An OpenSpool tag that Wrkbench did not write opens the full inventory with the spools it could be. Tap the button again to stop. See [Spool tags](Spool-tags.md).
- **Writing a sticker**: on a spool, **Spool tag** writes its NFC sticker, as in the full Wrkbench.

What each role can do is the same as in the full Wrkbench: operators can use stock and move items, viewers can only look.

## After a backup is restored

Labels keep working after a workspace is exported and imported into an empty Wrkbench at the same address: items and locations get the same ids back. Importing into a Wrkbench that still holds the originals makes copies with new ids, so the old labels keep pointing at the originals. See [Backups, import and export](Backups-and-data.md).

## Good to know

- A label stops working when its item or location is deleted. An item that was retired because past jobs used it says so when scanned.
- If Wrkbench moves to a new address, labels printed before the move point at the old one. Keep the old address redirecting to the new one, or reprint.
- Barcode scanners were checked by sending Wrkbench the keystrokes a scanner sends. They have not yet been checked on a physical Zebra scanner. If a mobile computer's scans do nothing, run the **Scanner test** above. Meanwhile, open **Scan**, tap **Or type a code** and scan again: that way always works. If scans are only read some of the time, set the scanner to send its characters with no delay between them.
- Label printing was checked by producing the pages for sizes from 15 to 150 mm, measuring that no text is clipped, and reading every code back by program as a 203 and a 300 dpi printer would print it. It has not yet been checked on a physical label printer: if yours cuts off or shrinks the label, check the paper size, margins and scale in the print window first.
