# Grocery Buddy

A simple Android app for grocery lists, store deals and a monthly grocery
budget, set up for **Columbia, AL 36319**. Big text, big buttons, four screens.

| Screen | What it does |
|---|---|
| **List** | Type an item and press **Add**. Tap the box when it's in your cart. **Change** sets how many, the price and which store. Shows the estimated total. **Done shopping** saves the receipt to Money. **Send this list to someone** texts or emails it. |
| **Deals** | **See weekly ad** opens Piggly Wiggly's or Dollar General's ad in the web browser. **Save a deal I saw** keeps the sale price, usual price and last day, and **Add to my list** puts it on the list. |
| **Money** | Monthly budget, how much is spent and how much is left, money saved with deals, every receipt, spending by store and the last six months. |
| **Stores** | Address, hours, **Call**, **Directions** and the weekly ad for each store. Anything can be changed, and more stores can be added. |

**A− / A+** at the top changes the text size. The phone's **Back** button closes a box or goes back to the list.

The app remembers what you buy. **Pick from things I usually buy** lists your
regular items, and a typed item gets its last price and store filled in.

## Stores included

| Store | Address | Phone | Weekly ad |
|---|---|---|---|
| Piggly Wiggly | 119 E Church St | (334) 696-2070 | [wallstreetmarketsllc.com/sale-ads](https://www.wallstreetmarketsllc.com/sale-ads) |
| Dollar General | 211 W Church St | (334) 403-5275 | [dollargeneral.com/weekly-ads](https://www.dollargeneral.com/weekly-ads) |
| Dollar General | 100 Green Dr | (334) 696-4220 | same |

These came from store listings online. Check them once on the Stores screen and
fix or remove anything that's out of date.

## Why deals aren't filled in automatically

Dollar General and Piggly Wiggly don't offer a public feed of their weekly
ads. Copying them off their websites would break whenever the sites change
and goes against their terms of use. So the app opens the real ad in one tap,
and you save the deals you want, which takes a few seconds each.

## Privacy

The app asks for **no permissions** and has no internet access. Nothing can
connect to it, and it sends nothing anywhere. Your list, deals and receipts
stay on the phone. Links (ads, maps, phone calls) open in the phone's own apps.
For a copy of your data, use **Stores → Send myself a backup copy**.

## Getting the APK

GitHub builds it every time something under `grocery-app/` changes:

1. Open the repository's **Actions** tab and choose the latest **Grocery Buddy APK** run.
2. Under **Artifacts**, download **GroceryBuddy-apk** and unzip it to get `GroceryBuddy.apk`.
3. Put it on the phone (email it, or copy it with a USB cable) and tap it.
4. If Android asks, allow installing apps from that source (Files, Gmail, Chrome).

To build it yourself, install Android Studio (or the Android SDK and JDK 17) and run:

```bash
cd grocery-app
./gradlew assembleRelease
# app/build/outputs/apk/release/app-release.apk
```

Needs Android 8.0 or newer.

### Updating

Every build is signed with the same key (`app/signing.keystore`), so a new APK
installs over the old one and keeps everything you saved. That key is for
installing it yourself only. It isn't private, so make a separate key for a
Play Store release.

## How it's built

A small Java activity (`MainActivity.java`) shows the screens in
`app/src/main/assets/www/` in a WebView and saves data to the phone's app
storage. You can also open `index.html` in a desktop browser to try the
screens, where data is saved in the browser instead.
