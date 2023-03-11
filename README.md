# AppWrite DB Tweaker

This tool provides a way for people who, like me, are missing a feature to rename, reorder or resize attributes in AppWrite collections.
Hopefully AppWrite team will provide one soon... Until then this little script can help.

## Sample usage on collection attributes
- Renaming
- Resizing
- Cloning
- Reordering

## Environment vars
Either pass some or all of `API_KEY`, `PROJECT ID` and `DATABASE ID` values as `--arguments` or use a `.env` file

## TLDR;
- Help : `node aw-dbtweaker.js --help`
- Rename an attribute : `node aw-dbtweaker.js old new`
- Rename and Resize an attribute : `node aw-dbtweaker.js old new 50`
- Clone an attribute : `node aw-dbtweaker.js orig new`
- Reorder attributes : `node aw-dbtweaker.js first second...`

## 🔥 Warning 🔥
Make a backup before processing!
