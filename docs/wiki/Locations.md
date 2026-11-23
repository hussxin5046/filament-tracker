# Locations

**Locations** are the places you keep things: rooms, shelves, cabinets, drawers and bins, one inside another as deep as you like. Each item and each machine can be given a location, so you can see where anything lives and what belongs in any one place.

![A location: what is inside it, what is stored there, and its actions](images/locations.png)

## The Locations page

**Locations** in the main menu shows every location as a tree, with how many items are in each (counting everything inside it). Items that have no location yet are listed underneath as **Not put away**.

Spools loaded in an AMS (or any other unit on a machine) count as put away, so they are not listed there. Each AMS shows under **In machines** with how many of its slots are loaded. Open one to see the spools in it in the inventory.

Open a location to see:

- **Inside it**: the locations nested in it.
- **Stored here**: the items kept directly in it. A link below opens the inventory filtered to everything in this location and inside it.
- **Machines here**: machines whose location this is.

The line at the top shows where it sits (for example **Locations › Workshop › Parts cabinet**); each step is a link.

## Add, rename, nest and delete

Admins manage locations on this page.

- **Add location** (on the main page) or **Add a location inside** (on a location) makes a new one. Give it a **Name**, and optionally a **Kind** (room, shelf, bin…) and a **Label code**.
- **Edit** changes any of those, and **Inside** moves it under a different location, taking everything in it along.
- **Delete** removes it. The locations inside it move up one level. Items and machines that were directly in it are left with no location, and labels printed for it stop working.

The **Label code** is a short code of your own, such as `LOC-014`. It is printed on the location's label and can be typed into the scanner to open the location. It is optional: the QR code on the label works without it.

## Put things away

Operators and admins can move items into a location, from the location's page:

- **Move items here** opens a list of everything not already there. Tick as many as you like, then **Move … here**. Each row says where the item is now.
- **Scan items here** opens the camera: every item label you scan is moved here straight away, one after another. Press **Done** when the shelf is full. See [Labels and scanning](Labels-and-scanning.md).

A move is written to **Activity** as one line ("Moved 4 items to Shelf B"). Moving never changes how much is in stock.

An admin can also set one item's location on its **Edit** form.

## See where something is

- An item's sheet shows its full location, for example **Workshop › Parts cabinet › Drawer 2**.
- In **Inventory**, the **By location** view has a column per location, and **Filters**, **Location** narrows the list to one location and everything inside it. That choice is part of the page's address, so it can be bookmarked or shared.
- Searching the inventory also matches location names.

## Labels

**Print label** on a location prints a QR label for it; **Print all … labels here** prints one for it and for every location inside it, and **Print all … labels** on the main page prints the lot. Scanning a location's label opens its page, ready to see what belongs there or to put things away.

How labels are printed, and what scanning does, is on [Labels and scanning](Labels-and-scanning.md).

## A screen on the shelf

A [location display](Location-displays.md) is a small touch screen fixed to a location that shows what is stored there and how much is left, and updates by itself.
