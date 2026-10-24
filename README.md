# GBA Player

A Game Boy Advance emulator that runs in Safari, built for an iPad 3 on iOS 9.3.5. It is a plain static website, so it can be hosted free on GitHub Pages.

- Import `.gba` games, or `.zip` files with a game inside
- Imported games stay on the iPad, so next time they're one tap away
- Touch controls with multi-touch (hold a direction and press A at the same time)
- In-game saves are kept automatically, plus one save state per game
- Automatic frame skip to keep games at full speed on slow hardware
- Bluetooth keyboard works too

No BIOS file is needed: it uses the open-source replacement BIOS that comes with GBA.js.

## Put it on GitHub Pages (one time, about 10 minutes)

Do this on a computer or a newer phone. The GitHub website doesn't work well in iOS 9 Safari.

1. Sign in at https://github.com (create a free account if you don't have one).
2. Click **+** (top right), then **New repository**. Name it `gba-player`, set it to **Public**, and click **Create repository**.
3. On the next page click **uploading an existing file**.
4. Unzip `gba-player.zip` on your computer. Open the `gba-player` folder, select **everything inside it** (the `index.html` file and the `core`, `css`, `js`, `roms` folders, and the rest) and drag it into the GitHub page. Wait for all files to upload, then click **Commit changes**.
   - `index.html` must be at the top level of the repository, not inside another folder.
5. Go to **Settings**, then **Pages** (left side). Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose branch **main** and folder **/ (root)**, and click **Save**.
6. Wait a minute or two. Your site will be at `https://YOUR-USERNAME.github.io/gba-player/`.

## Use it on the iPad

1. Open the site address in Safari.
2. Tap the **Share** button, then **Add to Home Screen**. Opening it from that icon gives you full screen with no address bar.
   - The home-screen icon keeps its own storage, separate from Safari. Pick one way to open it and import your games there, or your games and saves will seem to be missing in the other.
3. Tap **Test screen** under "On this site" to check it works. You should see "Hello world!".

If Safari says it **cannot verify the server identity**, the iPad's certificate list is too old for the site's security certificate. Tap **Continue** (or **Details**, then **Trust**) to open it anyway. (iOS 9 hasn't had certificate updates since 2016.)

## Getting games onto the iPad

iOS 9 has no Files app, so the easiest routes are:

- **iCloud Drive** (recommended): on a computer, go to https://www.icloud.com, open iCloud Drive, and upload your `.gba` or `.zip` files. On the iPad, make sure iCloud Drive is turned on in Settings, then in the player tap **Import game** and choose **iCloud Drive**. The game is copied into the player, so it stays even if you delete it from iCloud later.
- **Open from a link**: paste a direct download link to a `.gba` or `.zip`. The site hosting the file has to allow it; files in a GitHub repository usually work.
- **On this site**: put files in the `roms` folder of your repository and list them in `roms/games.js`. A GitHub Pages site is public, so only do this with games you're allowed to share (homebrew, your own games). Keep your own cartridge backups private by importing them instead.

Only play games you own.

## Saves

- **In-game saves** (the game's own Save menu) are stored in Safari automatically, the same way the cartridge battery would.
- **Save state** (in Menu) captures exactly where you are, one slot per game. Load state jumps back to it.
- **Back up or restore saves** on the home screen gives you your in-game saves as text you can copy into a note, and paste back later.
- Clearing Safari's website data (Settings > Safari > Clear History and Website Data) erases imported games and saves. Back up first.
- Private Browsing mode can't keep anything. Use normal browsing.

## Speed on the iPad 3

The iPad 3's processor is at the edge of what a JavaScript GBA emulator needs. Simpler games run well; big 3D-ish or effects-heavy games will slow down. To get the most speed:

- In **Menu**, turn **Sound** off (sound costs a lot of CPU) and set **Frame skip** to **Up to 3** or **Up to 5**.
- Turn on **Show speed** to see how it's doing (100% is full speed).
- Close other Safari tabs. Restart the iPad if it has been on for a long time.

The emulator core is GBA.js, an older emulator. It runs many commercial games but not all of them; if a game crashes, the player tells you and you can restart or go back.

## Keyboard (Bluetooth)

Arrows = D-pad, Z = A, X = B, A = L, S = R, Enter = Start, \ = Select.

## Files

- `index.html`, `css/`, `js/app.js`: the player interface, written in plain older JavaScript so iOS 9 can run it
- `js/savestate.js`: complete save states (fills in parts GBA.js left unfinished)
- `js/storage.js`: keeps games and save states in the browser's database
- `js/zip.js`: opens `.zip` files
- `core/`: the GBA.js emulator
- `roms/games.js`: the "On this site" list

## Credits and licenses

- Emulator core: [GBA.js](https://github.com/endrift/gbajs) by Jeffrey Pfau, 2-clause BSD license (`core/LICENSE-gbajs.txt`)
- Unzip: [pako](https://github.com/nodeca/pako), MIT license (`js/LICENSE-pako.txt`)
- Test screen ROM: from [gba-tests](https://github.com/jsmolka/gba-tests) by Julian Smolka, MIT license (`roms/LICENSE-test-rom.txt`)
