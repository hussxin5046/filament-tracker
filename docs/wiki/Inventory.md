# Inventory

**Inventory** is everything your workshop keeps in stock: filament, sheet material, endmills, screws, sandpaper, spare parts. Each thing you stock is an **item**, and every item belongs to a **category**.

![The Inventory screen, by category](images/inventory.png)

## Categories and their fields

A category (filament, endmill, sheet stock and so on) decides which details you record for its items. Filament might have material, colour and diameter; an endmill has flutes, diameter and coating. Templates set up sensible categories for you. To add or change one, go to **Settings**, **Lists**. See [Catalogue and settings](Catalogue-and-settings.md#categories).

## Add an item

Press **Add item**, then choose:

- **From the catalogue**: pick a real product (a filament line, an endmill size, a sheet thickness) from the built-in catalogue. Its details are filled in for you. See [Catalogue and settings](Catalogue-and-settings.md#the-built-in-catalogue).
- **From a spool tag**: scan an OpenSpool NFC sticker, or paste what it holds, to add the spool it describes. See [Spool tags](Spool-tags.md#add-a-spool-from-someone-elses-tag).
- **From scratch**: type everything in yourself.

The fields that matter most:

| Field | What it does |
| --- | --- |
| **Quantity in stock** and **Unit** | How much you have, in grams, metres, sheets, pieces and so on |
| **Minimum stock level** | Below this the item counts as **low stock** and joins the reorder list |
| **Full / pack size** | Optional. Shows a fill gauge and sets how much to reorder |
| **Price** | Used to work out stock value and job costs |
| **Supplier** and **Location** | Where you buy it and where it lives |
| **Fits these machines** | Which machines it can be used in |
| **Expected life** | For tooling that wears. See [Tool life](#tool-life) |

## Ways to look at your stock

Switch between views at the top of the screen. Wrkbench remembers your choice on each device.

- **By category**: one column per category.
- **By machine**: one column per machine, showing what is loaded in it first, then what fits it.
- **By location**: one column per storage place. Locations also have their own page: see [Locations](Locations.md).
- **List**: everything in one table.

Use the search box to find items by name, material, size or location. The **Category** and **Status** chips (low stock, worn, offcuts, loaded in a machine) narrow the list, and **Filters** adds **Location**, **Supplier** and **Sort by**: by name, lowest quantity first, or most recently changed.

While any spool is **on the move**, the status filters gain **On the move**. A spool is on the move after it was taken out, at a [location display](Location-displays.md#on-the-move) or with **Take out** on the spool, and before it is put away or loaded into a machine.

With a barcode scanner, scan an item's label or barcode on any screen to open it, ready for the amount you used. See [Use a barcode scanner](Labels-and-scanning.md#use-a-barcode-scanner).

## Spools tapped on a display

When a Bambu Lab spool that is not in stock is tapped on a location display, a notice appears at the top of **Inventory**. Press **Sort it out** to choose the spool the tag is on, add it as a new spool filled in from the tag, or forget the read. See [Tags Wrkbench does not know](Location-displays.md#tags-wrkbench-does-not-know).

## Change how much is in stock

Open an item to see its details and history.

![An item opened, with quick stock buttons and its history](images/item-sheet.png)

- The **plus and minus** buttons add or take away common amounts.
- **Counted or weighed? Set the exact amount** replaces the figure with what you measured.
- **History** lists the latest changes: when, by whom, and why.
- **Delete** (admins) removes the item from inventory straight away, without asking first. A message with **Undo** stays on screen for a few seconds; press it and the item is back as if nothing happened. Past jobs keep their record of a deleted item.

**Print label** prints a QR label for the item; scanning it opens this sheet on any phone. See [Labels and scanning](Labels-and-scanning.md). For filament, **Spool tag** writes an NFC sticker and **Load into…** puts the spool in a machine's slot: see [Spool tags](Spool-tags.md).

Every change is recorded. After an admin changes a stock level, the message that confirms it carries an **Undo** button for a few seconds. Later on, an admin can still undo a mistaken change from [Activity](Dashboard-and-reports.md#activity). Operators can take stock away but not add it. See [Members and roles](Members-and-roles.md).

Finishing a job also takes its materials out of stock. See [Jobs and the queue](Jobs-and-queue.md#finish-a-job).

## Offcuts

An **offcut** (also called a remnant) is a usable leftover piece, such as half a sheet of plywood. Open the original item and press **Add offcut** to record it with its own size. (The button appears for categories that record a size, such as sheet stock.) Offcuts are kept off the reorder list.

To find a piece big enough for a job, use **Find a piece that fits** and enter the size you need. Pieces are matched in any orientation, offcuts first. This works for categories that have a size, set up under **Settings**, **Lists**.

## Tool life

For tooling that wears out, such as endmills, saw blades or nozzles, turn on **Track tool life** for the category. Then give each item an **Expected life** in hours. Finishing a job adds its cutting time to the tool, and the tool is flagged as **Worn** when it reaches its expected life. You can also flag a tool as worn by hand.

## Reordering

The **Reorder** screen lists everything below its minimum, plus tooling that has reached its expected life, grouped by supplier.

![The Reorder screen, grouped by supplier](images/reorder.png)

- When a pack size is set, the suggested amount is rounded up to whole packs.
- **Copy list** and **Download CSV** give you the list to send to a supplier.
- **Received** adds the suggested amount to stock when the order arrives.

## Bring in a spreadsheet

You can import items from a CSV file, or export them to one, under **Settings**, **Import / export**. See [Backups, import and export](Backups-and-data.md).
